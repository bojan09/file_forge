import MarkdownIt, { type Token } from "markdown-it";
import type { Align, Block, ConversionWarning, Inline, ListItem } from "../types";
import { finalizeDoc, mergeRuns, safeLink, stripControl, trimRuns, warn } from "./common";

// html:false means raw HTML in the source is escaped to text, never interpreted.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false }).enable(["table", "strikethrough"]);

interface Ctx {
  warnings: ConversionWarning[];
  imageCount: number;
  droppedLinks: number;
}

function inlineRuns(token: Token, ctx: Ctx): Inline[] {
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
      case "text":
        out.push(fmt(t.content));
        break;
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
        out.push(fmt(alt ? `[image: ${alt}]` : "[image]", { italic: true }));
        break;
      }
      default:
        if (t.content) out.push(fmt(t.content));
    }
  }
  return mergeRuns(out).map((r) => ({ ...r, text: stripControl(r.text) }));
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
        blocks.push({ type: "heading", level, runs: trimRuns(inlineRuns(inline, ctx)) });
        i += 3;
        break;
      }
      case "paragraph_open": {
        const inline = tokens[i + 1]!;
        const runs = trimRuns(inlineRuns(inline, ctx));
        if (runs.length) blocks.push({ type: "paragraph", runs });
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
              runs = first.runs;
              children = children.slice(1);
            }
            items.push({ runs, children: children.length ? children : undefined });
          } else i++;
        }
        i++;
        blocks.push({ type: "list", ordered, items });
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

export function parseMarkdown(text: string) {
  const ctx: Ctx = { warnings: [], imageCount: 0, droppedLinks: 0 };
  const tokens = md.parse(text.replace(/\r\n?/g, "\n"), {});
  const { blocks } = parseBlocks(tokens, 0, null, ctx);
  if (ctx.imageCount) ctx.warnings.push(warn("images-skipped", `${ctx.imageCount} image${ctx.imageCount > 1 ? "s were" : " was"} not included. Images are never fetched; the alt text is kept as a placeholder.`));
  if (ctx.droppedLinks) ctx.warnings.push(warn("links-dropped", `${ctx.droppedLinks} link${ctx.droppedLinks > 1 ? "s" : ""} with relative or unsafe addresses kept as plain text.`, "info"));
  const heading = blocks.find((b) => b.type === "heading");
  const title = heading && heading.type === "heading" ? heading.runs.map((r) => r.text).join("") : undefined;
  return finalizeDoc(blocks, ctx.warnings, title);
}
