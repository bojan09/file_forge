import MarkdownIt, { type Token } from "markdown-it";
import type { Align, Block, ConversionWarning, DocMeta, Inline, ListItem, ParseOptions } from "../types";
import { DEFAULT_PARSE_OPTIONS } from "../style";
import { describeRejected, embedDataUri, finalizeDoc, mergeRuns, newImageBudget, safeLink, stripControl, trimRuns, warn, type ImageBudget, type ImageRejection } from "./common";
import { PROCESSING_LIMITS } from "../registry";
import type { ImageData, Processing } from "../types";

// html:false means raw HTML in the source is escaped to text, never interpreted.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false }).enable(["table", "strikethrough"]);

interface Ctx {
  warnings: ConversionWarning[];
  imageCount: number;
  embedded: number;
  rejected: Map<ImageRejection, number>;
  budget: ImageBudget;
  /** Images found in the paragraph being parsed; emitted as image blocks right after it. */
  lifted: ImageData[];
  rawHtml: number;
  droppedLinks: number;
}

function inlineRuns(token: Token, ctx: Ctx, liftable = false): Inline[] {
  const out: Inline[] = [];
  let bold = 0;
  let italic = 0;
  let strike = 0;
  const links: (string | undefined)[] = [];
  const fmt = (text: string, extra: Partial<Inline> = {}): Inline => {
    const r: Inline = { text, ...extra };
    if (bold) r.bold = true;
    if (italic) r.italic = true;
    if (strike) r.strike = true;
    const link = links[links.length - 1];
    if (link) r.link = link;
    return r;
  };
  for (const t of token.children ?? []) {
    switch (t.type) {
      case "text": {
        // html:false escapes raw HTML into text. <br> is the one tag worth honouring; other tags are counted and left as text.
        const parts = t.content.split(/<br\s*\/?>/i);
        parts.forEach((part, i) => {
          if (i > 0) out.push(fmt("\n"));
          if (part) {
            ctx.rawHtml += (part.match(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g) ?? []).length;
            out.push(fmt(part));
          }
        });
        break;
      }
      case "softbreak":
        out.push(fmt(" "));
        break;
      case "hardbreak":
        out.push(fmt("\n"));
        break;
      case "code_inline":
        out.push(fmt(t.content, { code: true }));
        break;
      case "strong_open":
        bold++;
        break;
      case "strong_close":
        bold--;
        break;
      case "em_open":
        italic++;
        break;
      case "em_close":
        italic--;
        break;
      case "s_open":
        strike++;
        break;
      case "s_close":
        strike--;
        break;
      case "link_open": {
        const href = t.attrGet("href");
        const safe = safeLink(typeof href === "string" ? href : null);
        if (!safe) ctx.droppedLinks++;
        links.push(safe);
        break;
      }
      case "link_close":
        links.pop();
        break;
      case "image": {
        ctx.imageCount++;
        const alt = t.content || (t.children ?? []).map((c) => c.content).join("");
        const res = embedDataUri(String(t.attrGet("src") ?? ""), alt, ctx.budget);
        if (liftable && "image" in res) {
          ctx.embedded++;
          ctx.lifted.push(res.image);
          break;
        }
        if ("rejected" in res) ctx.rejected.set(res.rejected, (ctx.rejected.get(res.rejected) ?? 0) + 1);
        out.push(fmt(alt ? `[image: ${alt}]` : "[image]", { italic: true }));
        break;
      }

      default:
        if (t.content) out.push(fmt(t.content));
    }
  }
  return mergeRuns(out).map((r) => ({ ...r, text: stripControl(r.text) }));
}

const BREAK_MARKERS = [/^<!--\s*(page-?break|new-?page)\s*-->$/i, /^\\(newpage|pagebreak)$/i, /^<div[^>]*page-break-(before|after)\s*:\s*always[^>]*>\s*<\/div>$/i];

function isPageBreak(runs: Inline[]): boolean {
  const text = runs.map((r) => r.text).join("").trim();
  return text.length < 120 && BREAK_MARKERS.some((re) => re.test(text));
}

function flushImages(blocks: Block[], ctx: Ctx) {
  for (const image of ctx.lifted.splice(0)) blocks.push({ type: "image", image });
}

/** GitHub task items ("[ ]" / "[x]") become ○ / ● markers, which every bundled font can draw. */
function taskMarker(runs: Inline[]): Inline[] {
  const first = runs[0];
  const m = first && /^\[([ xX])\]\s+/.exec(first.text);
  if (!first || !m) return runs;
  return [{ ...first, text: (m[1] === " " ? "○ " : "● ") + first.text.slice(m[0].length) }, ...runs.slice(1)];
}

function alignOf(t: Token): Align | undefined {
  const raw = t.attrGet("style");
  const style = typeof raw === "string" ? raw : "";
  const m = /text-align:\s*(left|center|right)/.exec(style);
  return m ? (m[1] as Align) : undefined;
}

function parseTable(tokens: Token[], start: number, ctx: Ctx): { block: Block; next: number } {
  const header: Inline[][] = [];
  const rows: Inline[][][] = [];
  const align: Align[] = [];
  let i = start + 1;
  let inHead = false;
  let row: Inline[][] = [];
  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "table_close") break;
    if (t.type === "thead_open") inHead = true;
    else if (t.type === "thead_close") inHead = false;
    else if (t.type === "tr_open") row = [];
    else if (t.type === "th_open" || t.type === "td_open") {
      const inline = tokens[i + 1];
      row.push(inline && inline.type === "inline" ? trimRuns(inlineRuns(inline, ctx)) : []);
      if (inHead) align.push(alignOf(t) ?? "left");
    } else if (t.type === "tr_close") {
      if (inHead) header.push(...row);
      else rows.push(row);
    }
  }
  return { block: { type: "table", header: header.length ? header : null, rows, align }, next: i + 1 };
}

function parseBlocks(tokens: Token[], start: number, closeType: string | null, ctx: Ctx): { blocks: Block[]; next: number } {
  const blocks: Block[] = [];
  let i = start;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (closeType && t.type === closeType) return { blocks, next: i + 1 };
    switch (t.type) {
      case "heading_open": {
        const inline = tokens[i + 1]!;
        const level = Math.min(6, Math.max(1, Number(t.tag.slice(1)) || 1)) as 1 | 2 | 3 | 4 | 5 | 6;
        blocks.push({ type: "heading", level, runs: trimRuns(inlineRuns(inline, ctx, true)) });
        flushImages(blocks, ctx);
        i += 3;
        break;
      }
      case "paragraph_open": {
        const inline = tokens[i + 1]!;
        const runs = trimRuns(inlineRuns(inline, ctx, true));
        if (runs.length && isPageBreak(runs)) blocks.push({ type: "pagebreak" });
        else if (runs.length) blocks.push({ type: "paragraph", runs });
        flushImages(blocks, ctx);
        i += 3;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const ordered = t.type === "ordered_list_open";
        const items: ListItem[] = [];
        i++;
        while (i < tokens.length && tokens[i]!.type !== (ordered ? "ordered_list_close" : "bullet_list_close")) {
          if (tokens[i]!.type === "list_item_open") {
            const res = parseBlocks(tokens, i + 1, "list_item_close", ctx);
            i = res.next;
            let runs: Inline[] = [];
            let children = res.blocks;
            const first = children[0];
            if (first && first.type === "paragraph") {
              runs = taskMarker(first.runs);
              children = children.slice(1);
            }
            items.push({ runs, children: children.length ? children : undefined });
          } else i++;
        }
        i++;
        const plain = items.length > 0 && items.every((it) => /^[○●] /.test(it.runs[0]?.text ?? ""));
        blocks.push({ type: "list", ordered, items, ...(plain ? { plain: true } : {}) });
        break;
      }
      case "blockquote_open": {
        const res = parseBlocks(tokens, i + 1, "blockquote_close", ctx);
        i = res.next;
        if (res.blocks.length) blocks.push({ type: "quote", blocks: res.blocks });
        break;
      }
      case "fence":
      case "code_block":
        blocks.push({ type: "code", text: stripControl(t.content.replace(/\n$/, "")) });
        i++;
        break;
      case "hr":
        blocks.push({ type: "rule" });
        i++;
        break;
      case "table_open": {
        const res = parseTable(tokens, i, ctx);
        blocks.push(res.block);
        i = res.next;
        break;
      }
      default:
        i++;
    }
  }
  return { blocks, next: i };
}

const FRONT_MATTER = /^---[ \t]*\n([\s\S]{0,4000}?)\n---[ \t]*(?:\n|$)/;

/** Reads a flat `key: value` front matter block (title, author, description, keywords). Nothing else is interpreted. */
function readFrontMatter(text: string): { body: string; meta?: DocMeta } {
  const m = FRONT_MATTER.exec(text);
  if (!m) return { body: text };
  const meta: DocMeta = {};
  let any = false;
  for (const line of m[1]!.split("\n")) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.replace(/^["']|["']$/g, "").trim().slice(0, 300);
    if (!value) continue;
    if (key === "title") (meta.title = value), (any = true);
    else if (key === "author") (meta.author = value), (any = true);
    else if (key === "description" || key === "subject") (meta.subject = value), (any = true);
    else if (key === "keywords" || key === "tags") (meta.keywords = value.replace(/^\[|\]$/g, "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 20)), (any = true);
  }
  return any ? { body: text.slice(m[0].length), meta } : { body: text };
}

export function parseMarkdown(text: string, options: Pick<ParseOptions, "markdown"> = DEFAULT_PARSE_OPTIONS, processing: Processing = "balanced") {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (options.markdown === "source") {
    const body = stripControl(normalized.replace(/\t/g, "    ")).replace(/\n+$/, "");
    const warnings = [warn("markdown-source", "Markdown is kept as source text in a monospaced block, exactly as written. Switch to formatted output to render headings, lists and tables.", "info")];
    return finalizeDoc([{ type: "code", text: body }], warnings);
  }
  const { body, meta } = readFrontMatter(normalized);
  const ctx: Ctx = { warnings: [], imageCount: 0, embedded: 0, rejected: new Map(), budget: newImageBudget(PROCESSING_LIMITS[processing].imageMaxMegapixels), lifted: [], rawHtml: 0, droppedLinks: 0 };
  const tokens = md.parse(body.replace(/<!--(?!\s*(?:page-?break|new-?page)\s*-->)[\s\S]*?-->/gi, ""), {});
  const { blocks } = parseBlocks(tokens, 0, null, ctx);
  if (ctx.embedded) ctx.warnings.push(warn("images-embedded", `${ctx.embedded} embedded image${ctx.embedded > 1 ? "s" : ""} included.`, "info"));
  for (const m of describeRejected(ctx.rejected, ctx.imageCount)) ctx.warnings.push(warn("images-skipped", m));
  if (ctx.rawHtml) ctx.warnings.push(warn("raw-html", `${ctx.rawHtml} raw HTML tag${ctx.rawHtml > 1 ? "s" : ""} in the Markdown ${ctx.rawHtml > 1 ? "are" : "is"} shown as text. HTML inside Markdown is never interpreted; convert an .html file instead.`, "info"));
  if (ctx.droppedLinks) ctx.warnings.push(warn("links-dropped", `${ctx.droppedLinks} link${ctx.droppedLinks > 1 ? "s" : ""} with relative or unsafe addresses kept as plain text.`, "info"));
  const heading = blocks.find((b) => b.type === "heading");
  const title = meta?.title ?? (heading && heading.type === "heading" ? heading.runs.map((r) => r.text).join("") : undefined);
  return finalizeDoc(blocks, ctx.warnings, title, meta ? { ...meta, title } : undefined);
}
