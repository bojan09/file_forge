import { PROCESSING_LIMITS } from "../registry";
import { FileForgeError, type Align, type Block, type ConversionWarning, type DocMeta, type FontFamilyName, type Inline, type ListItem, type PageSettings, type Processing, type StyleSettings } from "../types";
import { embedDataUriBytes, finalizeDoc, mergeRuns, newImageBudget, normalizeColor, safeLink, stripControl, trimRuns, warn, type ImageBudget } from "./common";
import { OfficeZip, decodeXml, parseRels, resolveTarget, type Relationship } from "./zip-safe";
import type { ParsedBinary } from "./binary";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAX_BLOCKS = 300_000;
const MAX_DEPTH = 60;

const isEl = (n: Node): n is Element => n.nodeType === 1;
const kids = (e: Element, local?: string): Element[] => {
  const out: Element[] = [];
  for (let c = e.firstChild; c; c = c.nextSibling) if (isEl(c) && (!local || c.localName === local)) out.push(c);
  return out;
};
const child = (e: Element | undefined | null, local: string): Element | undefined => (e ? kids(e, local)[0] : undefined);
const wattr = (e: Element | undefined | null, name = "val"): string | undefined => (e ? e.getAttributeNS(W, name) ?? e.getAttribute(`w:${name}`) ?? undefined : undefined);
const rattr = (e: Element, name: string): string | undefined => e.getAttributeNS(R, name) ?? e.getAttribute(`r:${name}`) ?? undefined;
/** `<w:b/>` is on; `<w:b w:val="0|false|off"/>` is off; absent is undefined. */
function onOff(e: Element | undefined): boolean | undefined {
  if (!e) return undefined;
  const v = wattr(e);
  return !(v === "0" || v === "false" || v === "off");
}

interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  caps?: boolean;
}

interface StyleDef {
  id: string;
  name: string;
  basedOn?: string;
  type: string;
  run: RunProps;
  jc?: Align;
  numId?: string;
  ilvl?: number;
  outline?: number;
  pageBreakBefore?: boolean;
}

function readRunProps(rPr: Element | undefined): RunProps {
  const out: RunProps = {};
  if (!rPr) return out;
  const b = onOff(child(rPr, "b"));
  if (b !== undefined) out.bold = b;
  const i = onOff(child(rPr, "i"));
  if (i !== undefined) out.italic = i;
  const u = child(rPr, "u");
  if (u) out.underline = wattr(u) !== "none";
  const s = onOff(child(rPr, "strike")) ?? onOff(child(rPr, "dstrike"));
  if (s !== undefined) out.strike = s;
  const c = child(rPr, "color");
  const cv = wattr(c);
  if (cv && cv !== "auto") out.color = normalizeColor(`#${cv}`);
  const caps = onOff(child(rPr, "caps")) ?? onOff(child(rPr, "smallCaps"));
  if (caps !== undefined) out.caps = caps;
  return out;
}

const mergeProps = (...list: RunProps[]): RunProps => Object.assign({}, ...list.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))));

function jcToAlign(v: string | undefined): Align | undefined {
  switch (v) {
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    case "both":
    case "distribute":
      return "justify";
    case "left":
    case "start":
      return "left";
    default:
      return undefined;
  }
}

interface NumLevel {
  ordered: boolean;
}

interface Ctx {
  zip: OfficeZip;
  rels: Relationship[];
  styles: Map<string, StyleDef>;
  defaults: RunProps;
  numbering: Map<string, NumLevel[]>;
  budget: ImageBudget;
  limits: { maxBlocks: number };
  counts: Record<string, number>;
  notes: Set<string>;
  depth: number;
  blockCount: number;
}

const bump = (ctx: Ctx, key: string, n = 1) => void (ctx.counts[key] = (ctx.counts[key] ?? 0) + n);

function parseXml(xml: string, what: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new FileForgeError("corrupt-docx", `The ${what} part of this document is damaged and couldn't be read.`);
  return doc;
}

function readStyles(xml: string | undefined): { styles: Map<string, StyleDef>; defaults: RunProps; defaultFont?: string; defaultSize?: number; defaultLine?: number } {
  const styles = new Map<string, StyleDef>();
  let defaults: RunProps = {};
  let defaultFont: string | undefined;
  let defaultSize: number | undefined;
  let defaultLine: number | undefined;
  if (!xml) return { styles, defaults };
  const lineOf = (spacing: Element | undefined) => {
    const line = Number(wattr(spacing, "line"));
    const rule = wattr(spacing, "lineRule");
    return line > 0 && (!rule || rule === "auto") ? line / 240 : undefined;
  };
  const root = parseXml(xml, "styles").documentElement;
  const dd = child(child(child(root, "docDefaults"), "rPrDefault"), "rPr");
  defaults = readRunProps(dd);
  const rf = child(dd, "rFonts");
  defaultFont = rf?.getAttributeNS(W, "ascii") ?? rf?.getAttribute("w:ascii") ?? undefined;
  const sz = Number(wattr(child(dd, "sz")));
  if (sz) defaultSize = sz / 2;
  defaultLine = lineOf(child(child(child(child(root, "docDefaults"), "pPrDefault"), "pPr"), "spacing"));
  for (const s of kids(root, "style")) {
    const id = wattr(s, "styleId");
    if (!id) continue;
    const pPr = child(s, "pPr");
    const numPr = child(pPr, "numPr");
    styles.set(id, {
      id,
      name: (wattr(child(s, "name")) ?? id).toLowerCase(),
      basedOn: wattr(child(s, "basedOn")),
      type: wattr(s, "type") ?? "paragraph",
      run: readRunProps(child(s, "rPr")),
      jc: jcToAlign(wattr(child(pPr, "jc"))),
      numId: wattr(child(numPr, "numId")),
      ilvl: wattr(child(numPr, "ilvl")) !== undefined ? Number(wattr(child(numPr, "ilvl"))) : undefined,
      outline: wattr(child(pPr, "outlineLvl")) !== undefined ? Number(wattr(child(pPr, "outlineLvl"))) : undefined,
      pageBreakBefore: onOff(child(pPr, "pageBreakBefore")),
    });
    const f = child(child(s, "rPr"), "rFonts");
    if (id === "Normal" && f) defaultFont = f.getAttributeNS(W, "ascii") ?? f.getAttribute("w:ascii") ?? defaultFont;
    if (id === "Normal") {
      const nsz = Number(wattr(child(child(s, "rPr"), "sz")));
      if (nsz) defaultSize = nsz / 2;
      defaultLine = lineOf(child(pPr, "spacing")) ?? defaultLine;
    }
  }
  return { styles, defaults, defaultFont, defaultSize, defaultLine };
}

/** Walks a style and its ancestors (base first). Guards against cycles. */
function chain(ctx: Ctx, id: string | undefined): StyleDef[] {
  const out: StyleDef[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = ctx.styles.get(id);
    if (!s) break;
    out.unshift(s);
    id = s.basedOn;
  }
  return out;
}

function readNumbering(xml: string | undefined): Map<string, NumLevel[]> {
  const out = new Map<string, NumLevel[]>();
  if (!xml) return out;
  const root = parseXml(xml, "numbering").documentElement;
  const abstract = new Map<string, NumLevel[]>();
  for (const a of kids(root, "abstractNum")) {
    const levels: NumLevel[] = [];
    for (const l of kids(a, "lvl")) {
      const idx = Number(wattr(l, "ilvl") ?? levels.length);
      const fmt = wattr(child(l, "numFmt")) ?? "decimal";
      levels[idx] = { ordered: fmt !== "bullet" && fmt !== "none" };
    }
    abstract.set(wattr(a, "abstractNumId") ?? "", levels);
  }
  for (const n of kids(root, "num")) {
    const absId = wattr(child(n, "abstractNumId"));
    const id = wattr(n, "numId");
    if (id && absId && abstract.has(absId)) out.set(id, abstract.get(absId)!);
  }
  return out;
}

/** Pieces of a paragraph produced while walking its children. */
interface ParaBuilder {
  runs: Inline[];
  /** Blocks that must follow the paragraph (images, text-box content). */
  after: Block[];
  /** A `page` break was found inside the paragraph: the runs so far end one paragraph and a new page starts. */
  split: { runs: Inline[]; }[];
}

type Item = { kind: "block"; block: Block } | { kind: "item"; level: number; ordered: boolean; item: ListItem };

function textOfRuns(runs: Inline[]): string {
  return runs.map((r) => r.text).join("");
}

function processDrawing(d: Element, ctx: Ctx, out: ParaBuilder) {
  const graphicData = d.getElementsByTagNameNS("*", "graphicData")[0];
  const uri = graphicData?.getAttribute("uri") ?? "";
  const docPr = d.getElementsByTagNameNS("*", "docPr")[0];
  const alt = (docPr?.getAttribute("descr") || docPr?.getAttribute("title") || docPr?.getAttribute("name") || "").trim();
  if (/chart/i.test(uri)) {
    bump(ctx, "charts");
    out.after.push({ type: "paragraph", runs: [{ text: alt ? `[chart not included: ${alt}]` : "[chart not included]", italic: true }] });
    return;
  }
  if (/diagram/i.test(uri)) {
    bump(ctx, "smartart");
    out.after.push({ type: "paragraph", runs: [{ text: "[SmartArt diagram not included]", italic: true }] });
    return;
  }
  const blip = d.getElementsByTagNameNS("*", "blip")[0];
  if (blip) {
    const embed = rattr(blip, "embed");
    const rel = ctx.rels.find((r) => r.id === embed);
    if (!rel || rel.external) {
      bump(ctx, "linkedImages");
      out.after.push({ type: "paragraph", runs: [{ text: alt ? `[image: ${alt}]` : "[image]", italic: true }] });
      return;
    }
    const bytes = ctx.zip.bytes(resolveTarget("word/document.xml", rel.target));
    const res = bytes ? embedDataUriBytes(bytes, alt, ctx.budget) : { rejected: "decode" as const };
    if ("image" in res) {
      bump(ctx, "images");
      out.after.push({ type: "image", image: res.image });
    } else {
      bump(ctx, res.rejected === "format" ? "unsupportedImages" : "skippedImages");
      out.after.push({ type: "paragraph", runs: [{ text: alt ? `[image: ${alt}]` : "[image]", italic: true }] });
    }
    return;
  }
  // wps shapes: only their text boxes carry content, handled by the caller.
  if (!d.getElementsByTagNameNS(W, "txbxContent").length) bump(ctx, "shapes");
}

function processRun(r: Element, link: string | undefined, ctx: Ctx, out: ParaBuilder, paraStyleRun: RunProps) {
  const rStyle = wattr(child(child(r, "rPr"), "rStyle"));
  const charRun = mergeProps(...chain(ctx, rStyle).map((s) => s.run));
  const props = mergeProps(ctx.defaults, paraStyleRun, charRun, readRunProps(child(r, "rPr")));
  const emit = (text: string) => {
    if (!text) return;
    const t = stripControl(props.caps ? text.toUpperCase() : text);
    const run: Inline = { text: t };
    if (props.bold) run.bold = true;
    if (props.italic) run.italic = true;
    if (props.underline && !link) run.underline = true;
    if (props.strike) run.strike = true;
    if (props.color) run.color = props.color;
    if (link) run.link = link;
    out.runs.push(run);
  };
  const walk = (parent: Element) => {
    for (const c of kids(parent)) {
      switch (c.localName) {
        case "t":
          emit(c.textContent ?? "");
          break;
        case "tab":
        case "ptab":
          emit("    ");
          break;
        case "br": {
          const type = wattr(c, "type");
          if (type === "page") {
            out.split.push({ runs: out.runs });
            out.runs = [];
          } else emit("\n");
          break;
        }
        case "cr":
          emit("\n");
          break;
        case "noBreakHyphen":
          emit("-");
          break;
        case "softHyphen":
          break;
        case "footnoteReference":
        case "endnoteReference":
          bump(ctx, "noteRefs");
          break;
        case "commentReference":
          break;
        case "drawing":
          processDrawing(c, ctx, out);
          for (const tb of Array.from(c.getElementsByTagNameNS(W, "txbxContent"))) collectTextbox(tb, ctx, out);
          break;
        case "pict":
        case "object": {
          if (c.localName === "object") {
            bump(ctx, "ole");
            out.after.push({ type: "paragraph", runs: [{ text: "[embedded object not included]", italic: true }] });
          } else {
            const imgdata = c.getElementsByTagName("v:imagedata")[0];
            if (imgdata) {
              const rel = ctx.rels.find((x) => x.id === (imgdata.getAttributeNS(R, "id") ?? imgdata.getAttribute("r:id")));
              const bytes = rel && !rel.external ? ctx.zip.bytes(resolveTarget("word/document.xml", rel.target)) : undefined;
              const res = bytes ? embedDataUriBytes(bytes, undefined, ctx.budget) : { rejected: "decode" as const };
              if ("image" in res) out.after.push({ type: "image", image: res.image }), bump(ctx, "images");
              else bump(ctx, "unsupportedImages");
            }
            for (const tb of Array.from(c.getElementsByTagNameNS(W, "txbxContent"))) collectTextbox(tb, ctx, out);
          }
          break;
        }
        case "AlternateContent": {
          const choice = kids(c, "Choice")[0] ?? kids(c, "Fallback")[0];
          if (choice) walk(choice);
          break;
        }
        case "Choice":
        case "Fallback":
          walk(c);
          break;
        default:
          break;
      }
    }
  };
  walk(r);
}

function collectTextbox(tb: Element, ctx: Ctx, out: ParaBuilder) {
  bump(ctx, "textboxes");
  const inner: Item[] = [];
  for (const p of kids(tb, "p")) inner.push(...parseParagraph(p, ctx));
  out.after.push(...buildLists(inner));
}

function hyperlinkTarget(h: Element, ctx: Ctx): string | undefined {
  const id = rattr(h, "id");
  if (!id) return undefined;
  const rel = ctx.rels.find((r) => r.id === id && r.external);
  return rel ? safeLink(rel.target) : undefined;
}

function walkParagraphChildren(parent: Element, ctx: Ctx, out: ParaBuilder, paraRun: RunProps, link: string | undefined, depth: number) {
  if (depth > MAX_DEPTH) return;
  for (const c of kids(parent)) {
    switch (c.localName) {
      case "r":
        processRun(c, link, ctx, out, paraRun);
        break;
      case "hyperlink": {
        const target = hyperlinkTarget(c, ctx);
        walkParagraphChildren(c, ctx, out, paraRun, target ?? link, depth + 1);
        break;
      }
      case "ins":
        bump(ctx, "inserted");
        walkParagraphChildren(c, ctx, out, paraRun, link, depth + 1);
        break;
      case "del":
        bump(ctx, "deleted");
        break;
      case "moveFrom":
        bump(ctx, "deleted");
        break;
      case "moveTo":
      case "smartTag":
      case "fldSimple":
      case "customXml":
      case "sdt":
      case "sdtContent":
      case "bdo":
      case "dir":
        walkParagraphChildren(c.localName === "sdt" ? (child(c, "sdtContent") ?? c) : c, ctx, out, paraRun, link, depth + 1);
        break;
      default:
        break;
    }
  }
}

function headingLevel(ctx: Ctx, styleId: string | undefined, directOutline: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 | undefined {
  for (const s of [...chain(ctx, styleId)].reverse()) {
    const m = /^heading ?([1-9])$/.exec(s.name);
    if (m) return Math.min(6, Number(m[1])) as 1 | 2 | 3 | 4 | 5 | 6;
    if (s.name === "title") return 1;
  }
  const outline = directOutline ?? [...chain(ctx, styleId)].reverse().find((s) => s.outline !== undefined)?.outline;
  if (outline !== undefined && outline >= 0 && outline <= 5) return (outline + 1) as 1 | 2 | 3 | 4 | 5 | 6;
  return undefined;
}

function parseParagraph(p: Element, ctx: Ctx): Item[] {
  if (++ctx.blockCount > ctx.limits.maxBlocks) throw new FileForgeError("docx-too-complex", "This document has too many paragraphs to convert safely in the browser. Split it into parts.");
  const pPr = child(p, "pPr");
  const styleId = wattr(child(pPr, "pStyle"));
  const styleChain = chain(ctx, styleId);
  const paraRun = mergeProps(...styleChain.map((s) => s.run));
  const out: ParaBuilder = { runs: [], after: [], split: [] };
  walkParagraphChildren(p, ctx, out, paraRun, undefined, 0);

  const items: Item[] = [];
  const jc = jcToAlign(wattr(child(pPr, "jc"))) ?? [...styleChain].reverse().find((s) => s.jc)?.jc;
  const align = jc && jc !== "left" ? jc : undefined;
  const pbBefore = onOff(child(pPr, "pageBreakBefore")) ?? [...styleChain].reverse().find((s) => s.pageBreakBefore !== undefined)?.pageBreakBefore;
  if (pbBefore) items.push({ kind: "block", block: { type: "pagebreak" } });

  const numPr = child(pPr, "numPr");
  const numStyle = [...styleChain].reverse().find((s) => s.numId !== undefined);
  const numId = wattr(child(numPr, "numId")) ?? numStyle?.numId;
  const ilvlRaw = wattr(child(numPr, "ilvl")) ?? (numStyle?.ilvl !== undefined ? String(numStyle.ilvl) : undefined);
  const level = ilvlRaw !== undefined ? Math.max(0, Math.min(8, Number(ilvlRaw) || 0)) : 0;
  const heading = headingLevel(ctx, styleId, wattr(child(pPr, "outlineLvl")) !== undefined ? Number(wattr(child(pPr, "outlineLvl"))) : undefined);

  const segments = [...out.split.map((s) => s.runs), out.runs];
  segments.forEach((segRuns, si) => {
    const runs = trimRuns(mergeRuns(segRuns));
    if (runs.length) {
      if (heading) items.push({ kind: "block", block: { type: "heading", level: heading, runs, align } });
      else if (numId && numId !== "0" && si === 0) {
        const lv = ctx.numbering.get(numId)?.[level];
        items.push({ kind: "item", level, ordered: lv ? lv.ordered : false, item: { runs } });
      } else items.push({ kind: "block", block: { type: "paragraph", runs, align } });
    }
    if (si < segments.length - 1) items.push({ kind: "block", block: { type: "pagebreak" } });
  });
  for (const b of out.after) items.push({ kind: "block", block: b });

  // A section break that starts a new page ends this paragraph.
  const sect = child(pPr, "sectPr");
  if (sect && wattr(child(sect, "type")) !== "continuous") items.push({ kind: "block", block: { type: "pagebreak" } });
  if (sect) bump(ctx, "sections");
  return items;
}

/** Groups consecutive list items into nested list blocks. */
function buildLists(items: Item[]): Block[] {
  const out: Block[] = [];
  let stack: { level: number; ordered: boolean; list: Extract<Block, { type: "list" }> }[] = [];
  const attach = (list: Extract<Block, { type: "list" }>, level: number) => {
    const parent = stack[stack.length - 1];
    if (parent && level > parent.level) {
      const last = parent.list.items[parent.list.items.length - 1];
      if (last) (last.children ??= []).push(list);
      else out.push(list);
    } else out.push(list);
  };
  for (const it of items) {
    if (it.kind === "block") {
      stack = [];
      out.push(it.block);
      continue;
    }
    while (stack.length && stack[stack.length - 1]!.level > it.level) stack.pop();
    let top = stack[stack.length - 1];
    if (top && top.level === it.level && top.ordered !== it.ordered) {
      stack.pop();
      top = undefined;
    }
    if (!top || top.level < it.level) {
      const list: Extract<Block, { type: "list" }> = { type: "list", ordered: it.ordered, items: [] };
      attach(list, it.level);
      top = { level: it.level, ordered: it.ordered, list };
      stack.push(top);
    }
    top.list.items.push(it.item);
  }
  return out;
}

function cellRuns(tc: Element, ctx: Ctx): Inline[] {
  const runs: Inline[] = [];
  for (const el of kids(tc)) {
    if (el.localName === "p") {
      const items = parseParagraph(el, ctx);
      const paraRuns: Inline[] = [];
      for (const it of items) {
        if (it.kind === "item") paraRuns.push({ text: "• " }, ...it.item.runs);
        else if (it.block.type === "paragraph" || it.block.type === "heading") paraRuns.push(...it.block.runs);
        else if (it.block.type === "image") bump(ctx, "tableImages");
      }
      if (paraRuns.length) {
        if (runs.length) runs.push({ text: "\n" });
        runs.push(...paraRuns);
      }
    } else if (el.localName === "tbl") {
      bump(ctx, "nestedTables");
      for (const t of Array.from(el.getElementsByTagNameNS(W, "t"))) runs.push({ text: (t.textContent ?? "") + " " });
    }
  }
  return trimRuns(mergeRuns(runs));
}

function parseTable(tbl: Element, ctx: Ctx): Block | null {
  const grid = kids(child(tbl, "tblGrid") ?? tbl, "gridCol").map((g) => Number(wattr(g, "w")) || 0);
  const rows: Inline[][][] = [];
  const headerFlags: boolean[] = [];
  const boldFirst: boolean[] = [];
  let merged = false;
  const alignSource: (Align | undefined)[] = [];
  for (const tr of kids(tbl, "tr")) {
    const row: Inline[][] = [];
    for (const tc of kids(tr, "tc")) {
      const tcPr = child(tc, "tcPr");
      const span = Number(wattr(child(tcPr, "gridSpan")) ?? 1) || 1;
      const vm = child(tcPr, "vMerge");
      if (span > 1 || vm) merged = true;
      const runs = cellRuns(tc, ctx);
      row.push(vm && wattr(vm) !== "restart" ? [] : runs);
      for (let k = 1; k < Math.min(span, 40); k++) row.push([]);
      if (rows.length === 1) {
        const firstP = child(tc, "p");
        alignSource[row.length - 1] = jcToAlign(wattr(child(child(firstP, "pPr"), "jc")));
      }
    }
    if (!row.length) continue;
    rows.push(row);
    headerFlags.push(!!child(child(tr, "trPr"), "tblHeader"));
    boldFirst.push(row.every((c) => c.length > 0 && c.every((r) => r.bold)));
  }
  if (!rows.length) return null;
  if (merged) bump(ctx, "mergedTables");
  const cols = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < cols) r.push([]);
  const hasHeader = rows.length > 1 && (headerFlags[0] || boldFirst[0]);
  const header = hasHeader ? rows[0]! : null;
  const body = hasHeader ? rows.slice(1) : rows;
  const widths = grid.length === cols && grid.every((g) => g > 0) ? grid : undefined;
  const align: Align[] = Array.from({ length: cols }, (_, i) => alignSource[i] ?? "left");
  return { type: "table", header, rows: body, align, widths, autoAlign: false };
}

function parseBody(container: Element, ctx: Ctx, items: Item[], depth = 0) {
  if (depth > MAX_DEPTH) return;
  for (const el of kids(container)) {
    switch (el.localName) {
      case "p":
        items.push(...parseParagraph(el, ctx));
        break;
      case "tbl": {
        const t = parseTable(el, ctx);
        if (t) items.push({ kind: "block", block: t });
        break;
      }
      case "sdt":
        parseBody(child(el, "sdtContent") ?? el, ctx, items, depth + 1);
        break;
      case "sdtContent":
      case "customXml":
      case "ins":
        parseBody(el, ctx, items, depth + 1);
        break;
      case "AlternateContent": {
        const c = kids(el, "Choice")[0];
        if (c) parseBody(c, ctx, items, depth + 1);
        break;
      }
      default:
        break;
    }
  }
}

const SERIF = /\b(times|georgia|cambria|garamond|palatino|book antiqua|baskerville|constantia|century|minion|serif|didot|bodoni|liberation serif)\b/i;
const MONO = /\b(courier|consolas|monaco|menlo|lucida console|mono|cousine|source code|fira code|jetbrains)\b/i;
const SANS_KNOWN = /\b(calibri|arial|helvetica|verdana|tahoma|segoe|aptos|roboto|open sans|trebuchet|liberation sans|carlito|noto sans|lato|source sans)\b/i;

function familyOf(font: string | undefined): FontFamilyName {
  if (!font) return "sans";
  if (MONO.test(font)) return "mono";
  if (SERIF.test(font)) return "serif";
  return "sans";
}

function headerFooterText(zip: OfficeZip, sectPrs: Element[], rels: Relationship[], kind: "header" | "footer"): { text: string; hasPage: boolean; hasTotal: boolean } {
  // A section without its own header or footer inherits the previous section's, so look back from the last one.
  let ref: Element | undefined;
  for (let i = sectPrs.length - 1; i >= 0 && !ref; i--) ref = kids(sectPrs[i]!, `${kind}Reference`).find((r) => (wattr(r, "type") ?? "default") === "default");
  const rel = ref && rels.find((r) => r.id === rattr(ref, "id"));
  const xml = rel ? zip.text(resolveTarget("word/document.xml", rel.target)) : undefined;
  if (!xml) return { text: "", hasPage: false, hasTotal: false };
  const hasPage = /\bPAGE\b/.test(xml) && /instrText|fldSimple/.test(xml);
  const hasTotal = /\bNUMPAGES\b/.test(xml);
  // Field results (the cached page number, date, ...) are not text the user typed: drop them, keep the surrounding words.
  const typed = xml.replace(/<w:fldSimple\b[\s\S]*?<\/w:fldSimple>/g, "").replace(/<w:fldChar[^>]*w:fldCharType="separate"[^>]*\/>[\s\S]*?<w:fldChar[^>]*w:fldCharType="end"[^>]*\/>/g, "");
  const text = Array.from(typed.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)).map((m) => decodeXml(m[1]!)).join("").replace(/\s+/g, " ").trim();
  return { text: text.slice(0, 120), hasPage, hasTotal };
}

const PAPERS: { name: PageSettings["pageSize"]; w: number; h: number }[] = [
  { name: "A4", w: 11906, h: 16838 },
  { name: "LETTER", w: 12240, h: 15840 },
  { name: "LEGAL", w: 12240, h: 20160 },
];

export function parseDocx(bytes: Uint8Array, processing: Processing): ParsedBinary {
  const zip = OfficeZip.open(bytes, (n) => /^word\/(document|styles|numbering|settings|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(n) || /^word\/_rels\/document\.xml\.rels$/.test(n) || /^word\/media\//.test(n) || n === "docProps/core.xml" || n === "word/vbaProject.bin" || /^word\/embeddings\//.test(n) || /^word\/fonts\//.test(n));
  const docXml = zip.text("word/document.xml");
  if (!docXml) throw new FileForgeError("not-docx", "This ZIP file isn't a Word document: word/document.xml is missing.");
  const limits = PROCESSING_LIMITS[processing];
  const rels = parseRels(zip.text("word/_rels/document.xml.rels"));
  const st = readStyles(zip.text("word/styles.xml"));
  const ctx: Ctx = {
    zip,
    rels,
    styles: st.styles,
    defaults: st.defaults,
    numbering: readNumbering(zip.text("word/numbering.xml")),
    budget: { ...newImageBudget(limits.imageMaxMegapixels), maxBytesEach: 12 * 1024 * 1024, maxBytesTotal: 60 * 1024 * 1024 },
    limits: { maxBlocks: MAX_BLOCKS },
    counts: {},
    notes: new Set(),
    depth: 0,
    blockCount: 0,
  };

  const body = child(parseXml(docXml, "document").documentElement, "body");
  if (!body) throw new FileForgeError("not-docx", "This Word document has no body.");
  const items: Item[] = [];
  parseBody(body, ctx, items);
  const blocks = buildLists(items);
  // Trailing and leading page breaks do nothing; consecutive ones collapse.
  const cleaned: Block[] = [];
  for (const b of blocks) {
    if (b.type === "pagebreak" && (!cleaned.length || cleaned[cleaned.length - 1]!.type === "pagebreak")) continue;
    cleaned.push(b);
  }
  while (cleaned.length && cleaned[cleaned.length - 1]!.type === "pagebreak") cleaned.pop();

  const warnings: ConversionWarning[] = [warn("experimental", "Word to PDF is experimental. Text, headings, lists, tables, links and pictures are converted; the original page layout, fonts and spacing are not reproduced. Review the result.", "info")];
  const c = ctx.counts;
  const n = (k: string) => c[k] ?? 0;
  const plural = (x: number, w: string) => `${x.toLocaleString()} ${w}${x === 1 ? "" : "s"}`;
  if (n("inserted") || n("deleted")) warnings.push(warn("tracked-changes", `Tracked changes: the final text is shown (${plural(n("inserted"), "insertion")} accepted, ${plural(n("deleted"), "deletion")} removed). Comments and revision marks are not included.`));
  const comments = zip.text("word/comments.xml");
  if (comments && /<w:comment\b/.test(comments)) warnings.push(warn("comments", "Comments in the document are not included.", "info"));
  for (const part of ["footnotes", "endnotes"] as const) {
    const x = zip.text(`word/${part}.xml`);
    const real = x ? (x.match(/<w:(?:footnote|endnote)\b[^>]*w:id="(\d+)"/g) ?? []).filter((m) => Number(/"(\d+)"/.exec(m)![1]) > 0).length : 0;
    if (real) warnings.push(warn(part, `${plural(real, part === "footnotes" ? "footnote" : "endnote")} not included; the reference marks were removed from the text.`));
  }
  if (n("textboxes")) warnings.push(warn("textboxes", `${plural(n("textboxes"), "text box")} moved into the normal text flow.`));
  if (n("charts")) warnings.push(warn("charts", `${plural(n("charts"), "chart")} can't be reproduced and ${n("charts") === 1 ? "is" : "are"} replaced by a note.`));
  if (n("smartart")) warnings.push(warn("smartart", `${plural(n("smartart"), "SmartArt diagram")} can't be reproduced and ${n("smartart") === 1 ? "is" : "are"} replaced by a note.`));
  if (n("ole")) warnings.push(warn("ole", `${plural(n("ole"), "embedded object")} (for example an Excel sheet) not included.`));
  if (n("shapes")) warnings.push(warn("shapes", `${plural(n("shapes"), "drawing shape")} without text not included.`, "info"));
  if (n("images")) warnings.push(warn("images-embedded", `${plural(n("images"), "picture")} included.`, "info"));
  const lost = n("unsupportedImages") + n("skippedImages") + n("linkedImages");
  if (lost) warnings.push(warn("images-skipped", `${plural(lost, "picture")} left out (unsupported format such as EMF, WMF, GIF or SVG, linked, damaged or over the size limits). A note marks each place.`));
  if (n("tableImages")) warnings.push(warn("table-images", `${plural(n("tableImages"), "picture")} inside tables not included.`));
  if (n("mergedTables")) warnings.push(warn("merged-cells", `${plural(n("mergedTables"), "table")} use merged cells; they are shown as separate cells.`));
  if (n("nestedTables")) warnings.push(warn("nested-tables", `${plural(n("nestedTables"), "nested table")} flattened to text.`));
  if (zip.has("word/vbaProject.bin")) warnings.push(warn("macros", "This file contains macros. They are ignored and never run.", "info"));
  if (zip.names.some((x) => x.startsWith("word/fonts/"))) warnings.push(warn("embedded-fonts", "Embedded fonts are not reproduced; a bundled font is used instead.", "info"));
  if (n("noteRefs")) {
    /* covered by footnotes/endnotes warnings */
  }

  // Page setup, fonts, header and footer suggested from the document, applied as editable defaults.
  const sectPrs = Array.from(body.getElementsByTagNameNS(W, "sectPr"));
  const last = child(body, "sectPr") ?? sectPrs[sectPrs.length - 1];
  const suggestion: ParsedBinary["suggested"] = {};
  const pgSz = child(last, "pgSz");
  if (pgSz) {
    const w = Number(wattr(pgSz, "w")) || 0;
    const h = Number(wattr(pgSz, "h")) || 0;
    const landscape = wattr(pgSz, "orient") === "landscape" || w > h;
    const [short, long] = [Math.min(w, h), Math.max(w, h)];
    const paper = PAPERS.find((p) => Math.abs(p.w - short) < 120 && Math.abs(p.h - long) < 120);
    const page: Partial<PageSettings> = { orientation: landscape ? "landscape" : "portrait" };
    if (paper) page.pageSize = paper.name;
    else if (w && h) warnings.push(warn("paper", `The document's page size (${(short / 1440).toFixed(1)} × ${(long / 1440).toFixed(1)} in) isn't offered here; A4 is used unless you change it.`, "info"));
    const pgMar = child(last, "pgMar");
    const side = ((Number(wattr(pgMar, "left")) || 1440) + (Number(wattr(pgMar, "right")) || 1440)) / 2;
    page.margins = side <= 1080 ? "narrow" : side >= 1800 ? "wide" : "normal";
    suggestion.page = page;
    if (sectPrs.length > 1) {
      const distinct = new Set(sectPrs.map((s) => `${wattr(child(s, "pgSz"), "w")}x${wattr(child(s, "pgSz"), "h")}x${wattr(child(s, "pgSz"), "orient")}`));
      if (distinct.size > 1) warnings.push(warn("sections", "The document mixes page sizes or orientations; the last section's page setup is used for all pages."));
    }
    if (child(last, "cols") && Number(wattr(child(last, "cols"), "num")) > 1) warnings.push(warn("columns", "The document uses multiple text columns; they are converted to a single column."));
  }
  const style: Partial<StyleSettings> = {};
  const font = st.defaultFont;
  style.fontFamily = familyOf(font);
  if (font && !SANS_KNOWN.test(font) && !SERIF.test(font) && !MONO.test(font)) warnings.push(warn("font", `The document's font (${font}) isn't bundled; ${style.fontFamily === "sans" ? "a sans" : style.fontFamily} font is used instead.`, "info"));
  if (st.defaultSize) style.fontSize = Math.min(16, Math.max(9, Math.round(st.defaultSize)));
  if (st.defaultLine) style.lineSpacing = Math.min(2, Math.max(1, Math.round(st.defaultLine * 20) / 20));
  const ordered = child(body, "sectPr") && !sectPrs.includes(child(body, "sectPr")!) ? [...sectPrs, child(body, "sectPr")!] : sectPrs;
  const head = headerFooterText(zip, ordered, rels, "header");
  const foot = headerFooterText(zip, ordered, rels, "footer");
  style.headerText = head.text;
  style.footerText = foot.text;
  style.pageNumbers = foot.hasPage || head.hasPage ? (foot.hasTotal || head.hasTotal ? "n-of-N" : "n") : "none";
  suggestion.style = style;
  if (head.text || foot.text || style.pageNumbers !== "none") warnings.push(warn("header-footer", "Header, footer and page-number text was carried over as editable options (see Advanced options).", "info"));

  const coreXml = zip.text("docProps/core.xml") ?? "";
  const tag = (name: string) => decodeXml(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(coreXml)?.[1] ?? "").trim() || undefined;
  const kw = tag("cp:keywords")?.split(/[,;]/).map((k) => k.trim()).filter(Boolean).slice(0, 20);
  const meta: DocMeta = { title: tag("dc:title"), author: tag("dc:creator"), subject: tag("dc:subject"), keywords: kw?.length ? kw : undefined };

  const firstHeading = cleaned.find((b) => b.type === "heading");
  const title = meta.title ?? (firstHeading && firstHeading.type === "heading" ? textOfRuns(firstHeading.runs) : undefined);
  const doc = finalizeDoc(cleaned, warnings, title, meta);
  if (!doc.charCount && !doc.imageCount) throw new FileForgeError("no-content", "No text or pictures were found in this Word document.");
  return { doc, suggested: suggestion };
}
