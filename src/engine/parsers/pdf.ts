import { loadPdfjs } from "../pdfjs";
import { PROCESSING_LIMITS } from "../registry";
import { FileForgeError, type Block, type ConversionWarning, type DocMeta, type Inline, type ListItem, type Processing } from "../types";
import type { ParsedBinary } from "./binary";
import { finalizeDoc, mergeRuns, safeLink, stripControl, trimRuns, warn } from "./common";

const MAX_CHARS = 6_000_000;
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const BULLET = /^([•▪●○◦‣⁃∙·■□–—\uE000-\uF8FF-]|\*)\s+/;
const NUMBERED = /^(\d{1,3}|[a-zA-Z])[.)]\s+/;
const SENTENCE_END = /[.!?:;”")\]]\s*$/;

interface Piece {
  str: string;
  x: number;
  w: number;
  bold: boolean;
  italic: boolean;
  link?: string;
}

interface Line {
  y: number;
  x0: number;
  x1: number;
  size: number;
  pieces: Piece[];
  /** Pieces split where the horizontal gap is large (table-like columns). */
  segments: Piece[][];
  text: string;
  rtl: boolean;
}

interface PageInfo {
  width: number;
  height: number;
  lines: Line[];
  columns: boolean;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

function lineText(pieces: Piece[], size: number): string {
  let out = "";
  let end = -Infinity;
  for (const p of pieces) {
    if (out && p.x - end > size * 0.18 && !/\s$/.test(out) && !/^\s/.test(p.str)) out += " ";
    out += p.str;
    end = p.x + p.w;
  }
  return out.replace(/[ \t]+/g, " ").trim();
}

function toLine(pieces: Piece[], y: number, size: number): Line {
  const rtlChars = pieces.reduce((n, p) => n + (p.str.match(RTL)?.length ?? 0), 0);
  const total = pieces.reduce((n, p) => n + p.str.length, 0) || 1;
  const rtl = rtlChars / total > 0.3;
  const sorted = [...pieces].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
  const segments: Piece[][] = [];
  let cur: Piece[] = [];
  let end = -Infinity;
  for (const p of [...pieces].sort((a, b) => a.x - b.x)) {
    if (cur.length && p.x - end > size * 2.6) {
      segments.push(cur);
      cur = [];
    }
    cur.push(p);
    end = p.x + p.w;
  }
  if (cur.length) segments.push(cur);
  const xs = pieces.map((p) => p.x);
  return { y, x0: Math.min(...xs), x1: Math.max(...pieces.map((p) => p.x + p.w)), size, pieces: sorted, segments, text: lineText(sorted, size), rtl };
}

const runsOf = (pieces: Piece[], size: number, stripBold = false): Inline[] => {
  const runs: Inline[] = [];
  let end = -Infinity;
  for (const p of pieces) {
    let text = stripControl(p.str);
    if (runs.length && p.x - end > size * 0.18 && !/\s$/.test(runs[runs.length - 1]!.text) && !/^\s/.test(text)) text = " " + text;
    end = p.x + p.w;
    if (!text) continue;
    const r: Inline = { text };
    if (p.bold && !stripBold) r.bold = true;
    if (p.italic) r.italic = true;
    if (p.link) r.link = p.link;
    runs.push(r);
  }
  return trimRuns(mergeRuns(runs)).map((r) => ({ ...r, text: r.text.replace(/[ \t]+/g, " ") }));
};

/** Groups text items into lines by baseline, then orders pieces within each line. */
function buildLines(pieces: (Piece & { y: number; size: number })[]): Line[] {
  const sorted = [...pieces].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  let cur: typeof sorted = [];
  let curY = 0;
  let curSize = 0;
  const flush = () => {
    if (!cur.length) return;
    const size = median(cur.map((p) => p.size)) || curSize;
    lines.push(toLine(cur, curY, size));
    cur = [];
  };
  for (const p of sorted) {
    if (!cur.length) {
      cur = [p];
      curY = p.y;
      curSize = p.size;
    } else if (Math.abs(p.y - curY) <= Math.min(curSize, p.size) * 0.4) {
      cur.push(p);
      curSize = Math.max(curSize, p.size);
    } else {
      flush();
      cur = [p];
      curY = p.y;
      curSize = p.size;
    }
  }
  flush();
  return lines.filter((l) => l.text);
}

/** Largest horizontal gap of a line that sits in the middle band of the page; used to find a column gutter. */
function middleGap(line: Line, width: number): { center: number; left: Piece[]; right: Piece[] } | null {
  const ps = [...line.pieces].sort((a, b) => a.x - b.x);
  let best: { center: number; at: number; gap: number } | null = null;
  for (let i = 1; i < ps.length; i++) {
    const end = ps[i - 1]!.x + ps[i - 1]!.w;
    const gap = ps[i]!.x - end;
    const center = end + gap / 2;
    if (gap >= Math.max(10, line.size * 0.9) && center > width * 0.3 && center < width * 0.7 && (!best || gap > best.gap)) best = { center, at: i, gap };
  }
  return best ? { center: best.center, left: ps.slice(0, best.at), right: ps.slice(best.at) } : null;
}

/**
 * Two newspaper-style text columns: most wide lines have a gap at the same x in the middle of the page and both sides hold
 * running text (not short table cells). Lines are split at the gutter and read left column first, then right, with full-width
 * lines (titles) acting as separators.
 */
function orderColumns(lines: Line[], width: number): { ordered: Line[]; columns: boolean } {
  const wide = lines.filter((l) => l.x1 - l.x0 > width * 0.4);
  const cand = wide.map((l) => ({ l, g: middleGap(l, width) })).filter((c): c is { l: Line; g: NonNullable<ReturnType<typeof middleGap>> } => !!c.g);
  if (wide.length < 6 || cand.length < 6 || cand.length < wide.length * 0.6) return { ordered: lines, columns: false };
  const gutter = median(cand.map((c) => c.g.center));
  const crosses = (l: Line) => l.pieces.some((p) => p.x < gutter - 3 && p.x + p.w > gutter + 3);
  if (wide.filter((l) => !crosses(l)).length < wide.length * 0.7) return { ordered: lines, columns: false };
  const chunkLen = median(cand.filter((c) => !crosses(c.l)).flatMap((c) => [lineText(c.g.left, c.l.size).length, lineText(c.g.right, c.l.size).length]));
  if (chunkLen < 28) return { ordered: lines, columns: false };

  const ordered: Line[] = [];
  let l: Line[] = [];
  let r: Line[] = [];
  const flush = () => {
    ordered.push(...l, ...r);
    l = [];
    r = [];
  };
  for (const line of lines) {
    if (crosses(line)) {
      flush();
      ordered.push(line);
      continue;
    }
    const left = line.pieces.filter((p) => p.x + p.w / 2 < gutter);
    const right = line.pieces.filter((p) => p.x + p.w / 2 >= gutter);
    if (left.length) l.push(left.length === line.pieces.length ? line : toLine(left, line.y, line.size));
    if (right.length) r.push(right.length === line.pieces.length ? line : toLine(right, line.y, line.size));
  }
  flush();
  return { ordered, columns: true };
}

function isPageNumber(t: string): boolean {
  return /^(page\s+)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(t) || /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(t);
}

const normKey = (t: string) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

interface TableRun {
  from: number;
  to: number;
  cols: number[];
}

/** Finds runs of lines whose big-gap segments align in stable columns. */
function findTables(lines: Line[]): TableRun[] {
  const runs: TableRun[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.segments.length < 2) {
      i++;
      continue;
    }
    let j = i;
    let cols = lines[i]!.segments.map((s) => s[0]!.x);
    const tol = Math.max(4, lines[i]!.size * 0.9);
    while (j + 1 < lines.length) {
      const next = lines[j + 1]!;
      if (next.segments.length < 2 && next.segments.length !== 0) break;
      if (next.segments.length < 2) break;
      const starts = next.segments.map((s) => s[0]!.x);
      const fits = starts.every((x) => cols.some((c) => Math.abs(c - x) <= tol));
      if (!fits) {
        // Allow a line that introduces extra columns only if the existing columns still match.
        const matches = cols.filter((c) => starts.some((x) => Math.abs(c - x) <= tol)).length;
        if (matches < Math.min(cols.length, starts.length) || starts.length < cols.length) break;
        cols = starts;
      } else if (starts.length > cols.length) cols = starts;
      // Vertical gap sanity: rows of a table are close together.
      if (lines[j]!.y - next.y > next.size * 3.2) break;
      j++;
    }
    if (j - i + 1 >= 3) runs.push({ from: i, to: j, cols });
    i = j + 1;
  }
  return runs;
}

function tableBlock(lines: Line[], run: TableRun, bodySize: number): Block {
  const cols = run.cols.length;
  const toCells = (line: Line): Inline[][] => {
    const cells: Inline[][] = Array.from({ length: cols }, () => []);
    for (const seg of line.segments) {
      const x = seg[0]!.x;
      let best = 0;
      for (let c = 1; c < cols; c++) if (Math.abs(run.cols[c]! - x) < Math.abs(run.cols[best]! - x)) best = c;
      cells[best] = [...cells[best]!, ...runsOf(seg, line.size)];
    }
    return cells;
  };
  const rows = lines.slice(run.from, run.to + 1).map(toCells);
  const firstBold = lines[run.from]!.pieces.every((p) => p.bold) || lines[run.from]!.size > bodySize * 1.1;
  const align = run.cols.map(() => "left" as const);
  return { type: "table", header: firstBold ? rows[0]! : null, rows: firstBold ? rows.slice(1) : rows, align, autoAlign: true };
}

type PItem = { kind: "block"; block: Block; line?: Line; page: number } | { kind: "item"; level: number; ordered: boolean; item: ListItem; line: Line; page: number };

export async function parsePdf(bytes: Uint8Array, processing: Processing, signal?: AbortSignal): Promise<ParsedBinary> {
  const pdfjs = await loadPdfjs();
  const limits = PROCESSING_LIMITS[processing];
  const check = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, enableXfa: false, useSystemFonts: false, fontExtraProperties: true });
  const onAbort = () => void task.destroy();
  signal?.addEventListener("abort", onAbort);
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (e) {
      check();
      const name = e instanceof Error ? e.name : "";
      if (name === "PasswordException") throw new FileForgeError("pdf-encrypted", "This PDF is password protected. FileForge can't open it. Remove the protection in the app that created it, then try again.");
      if (name === "InvalidPDFException" || name === "FormatError") throw new FileForgeError("pdf-invalid", "This file isn't a valid PDF, or it is damaged.");
      throw new FileForgeError("pdf-failed", "This PDF couldn't be opened.");
    }
    const n = doc.numPages;
    if (n > limits.pdfMaxPages) {
      throw new FileForgeError("pdf-too-long", `This PDF has ${n.toLocaleString()} pages, above the ${limits.pdfMaxPages.toLocaleString()}-page limit${processing === "conservative" ? ` for conservative mode (balanced allows ${PROCESSING_LIMITS.balanced.pdfMaxPages.toLocaleString()})` : ""}. Split it and convert the parts.`);
    }

    const pages: PageInfo[] = [];
    let chars = 0;
    let images = 0;
    let rotated = 0;
    let emptyPages = 0;
    let linkCount = 0;
    for (let p = 1; p <= n; p++) {
      check();
      const page = await doc.getPage(p);
      const [x0, y0, x1, y1] = page.view;
      const width = x1! - x0!;
      const height = y1! - y0!;
      const [tc, ops, annots] = await Promise.all([page.getTextContent(), page.getOperatorList(), page.getAnnotations({ intent: "display" }).catch(() => [])]);
      images += ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject || f === pdfjs.OPS.paintImageMaskXObject).length;
      const links = (annots as { subtype?: string; url?: string; rect?: number[] }[]).filter((a) => a.subtype === "Link" && a.url && a.rect).map((a) => ({ url: safeLink(a.url), rect: a.rect! })).filter((a) => a.url);
      const fontFlags = new Map<string, { bold: boolean; italic: boolean }>();
      const flags = (name: string) => {
        let f = fontFlags.get(name);
        if (!f) {
          try {
            const font = page.commonObjs.get(name) as { bold?: boolean; italic?: boolean; black?: boolean; name?: string } | undefined;
            const nm = font?.name ?? "";
            f = { bold: !!(font?.bold || font?.black) || /bold|black|heavy|semibold|demi/i.test(nm), italic: !!font?.italic || /italic|oblique/i.test(nm) };
          } catch {
            f = { bold: false, italic: false };
          }
          fontFlags.set(name, f);
        }
        return f;
      };
      const pieces: (Piece & { y: number; size: number })[] = [];
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [a, b, , , e, f] = it.transform as number[];
        const size = Math.hypot(a!, b!);
        if (size < 1) continue;
        if (Math.abs(b!) > Math.abs(a!) * 0.3) {
          rotated++;
          continue;
        }
        const fl = flags(it.fontName);
        const cx = e! + it.width / 2;
        const cy = f! + size * 0.3;
        const link = links.find((l) => cx >= Math.min(l.rect[0]!, l.rect[2]!) && cx <= Math.max(l.rect[0]!, l.rect[2]!) && cy >= Math.min(l.rect[1]!, l.rect[3]!) && cy <= Math.max(l.rect[1]!, l.rect[3]!))?.url;
        if (link) linkCount++;
        chars += it.str.length;
        pieces.push({ str: it.str, x: e! - x0!, w: it.width, y: f! - y0!, size, bold: fl.bold, italic: fl.italic, link });
      }
      if (chars > MAX_CHARS) throw new FileForgeError("pdf-too-much-text", "This PDF contains more text than can be processed safely in the browser. Split it and convert the parts.");
      const lines = buildLines(pieces);
      if (!lines.length) emptyPages++;
      const { ordered, columns } = orderColumns(lines, width);
      pages.push({ width, height, lines: ordered, columns });
      page.cleanup();
    }
    check();

    if (emptyPages === n || (emptyPages / n > 0.7 && chars < 150 * n)) {
      throw new FileForgeError(
        "pdf-scanned",
        images > 0
          ? "This PDF has no selectable text: it looks like scanned pages (pictures of text). Turning it into an editable Word file needs OCR (text recognition), which FileForge doesn't include. Use a PDF that was exported from a word processor."
          : "No text could be found in this PDF.",
      );
    }

    // Repeated headers, footers and page numbers.
    const removed = new Map<string, number>();
    if (n >= 3) {
      const keyCount = new Map<string, number>();
      for (const pg of pages) {
        const seen = new Set<string>();
        for (const l of pg.lines) {
          const edge = l.y > pg.height * 0.92 || l.y < pg.height * 0.08;
          if (!edge) continue;
          const k = normKey(l.text);
          if (!seen.has(k)) {
            seen.add(k);
            keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
          }
        }
      }
      for (const pg of pages) {
        pg.lines = pg.lines.filter((l) => {
          const edge = l.y > pg.height * 0.92 || l.y < pg.height * 0.08;
          if (!edge) return true;
          const k = normKey(l.text);
          const cnt = keyCount.get(k) ?? 0;
          if (cnt >= Math.max(3, Math.ceil(n * 0.6)) || (isPageNumber(l.text) && cnt >= Math.max(2, Math.ceil(n * 0.4)))) {
            removed.set(l.text.length > 40 ? l.text.slice(0, 40) + "…" : l.text, (removed.get(l.text) ?? 0) + 1);
            return false;
          }
          return true;
        });
      }
    }

    // Body text size: the most common line size, weighted by characters.
    const sizeWeight = new Map<number, number>();
    for (const pg of pages) for (const l of pg.lines) sizeWeight.set(Math.round(l.size * 2) / 2, (sizeWeight.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length);
    const body = [...sizeWeight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
    const headingSizes = [...new Set([...sizeWeight.keys()].filter((s) => s >= body * 1.25))].sort((a, b) => b - a);
    const headingLevel = (size: number) => Math.min(6, headingSizes.findIndex((s) => Math.abs(s - Math.round(size * 2) / 2) < 0.26) + 1 || 1) as 1 | 2 | 3 | 4 | 5 | 6;

    const items: PItem[] = [];
    let tablesFound = 0;
    let rtlLines = 0;
    pages.forEach((pg, pi) => {
      const tables = pg.columns ? [] : findTables(pg.lines);
      const tableAt = new Map(tables.map((t) => [t.from, t]));
      const lines = pg.lines;
      const left = median(lines.filter((l) => Math.abs(l.size - body) < 1).map((l) => l.x0));
      const right = Math.max(0, ...lines.map((l) => l.x1));
      const alignOf = (l: Line): "left" | "center" | "right" => {
        if (pg.columns || right - left < body * 8) return "left";
        const midOff = Math.abs((l.x0 + l.x1) / 2 - (left + right) / 2);
        if (l.x0 - left > body * 2 && right - l.x1 > body * 2 && midOff < body) return "center";
        if (right - l.x1 < body * 0.4 && l.x0 - left > body * 6) return "right";
        return "left";
      };
      const pitch = median(lines.slice(1).map((l, i) => lines[i]!.y - l.y).filter((d) => d > 0 && d < body * 2.5)) || body * 1.2;
      let i = 0;
      let open: { runs: Inline[]; lines: Line[]; align: "left" | "center" | "right" } | null = null;
      const closeParagraph = () => {
        if (!open) return;
        const runs = trimRuns(mergeRuns(open.runs));
        if (runs.length) items.push({ kind: "block", block: { type: "paragraph", runs, ...(open.align !== "left" ? { align: open.align } : {}) }, line: open.lines[0], page: pi });
        open = null;
      };
      while (i < lines.length) {
        const t = tableAt.get(i);
        if (t) {
          closeParagraph();
          items.push({ kind: "block", block: tableBlock(lines, t, body), page: pi });
          tablesFound++;
          i = t.to + 1;
          continue;
        }
        const line = lines[i]!;
        const prev = lines[i - 1];
        if (line.rtl) rtlLines++;
        const gap = prev ? prev.y - line.y : 0;
        const bullet = BULLET.exec(line.text);
        const numbered = !bullet && NUMBERED.exec(line.text);
        const isHeading = line.size >= body * 1.25 && line.text.length <= 160 && !bullet;
        const boldOnly = !isHeading && line.pieces.every((p) => p.bold) && line.text.length <= 70 && !SENTENCE_END.test(line.text) && !bullet && !numbered && (i + 1 >= lines.length || lines[i + 1]!.y - line.y < 0) && !line.segments[1];
        if (isHeading || boldOnly) {
          closeParagraph();
          const level = isHeading ? headingLevel(line.size) : 4;
          // Wrapped headings: join following lines of the same size.
          const parts = [line];
          while (isHeading && i + 1 < lines.length && Math.abs(lines[i + 1]!.size - line.size) < 0.6 && parts[parts.length - 1]!.y - lines[i + 1]!.y < line.size * 1.6 && !tableAt.has(i + 1)) {
            parts.push(lines[i + 1]!);
            i++;
          }
          const runs = trimRuns(mergeRuns(parts.flatMap((l, k) => (k ? [{ text: " " }, ...runsOf(l.pieces, l.size, true)] : runsOf(l.pieces, l.size, true)))));
          if (runs.length) items.push({ kind: "block", block: { type: "heading", level, runs }, page: pi });
          i++;
          continue;
        }
        if (bullet || numbered) {
          closeParagraph();
          const mk = bullet ?? numbered;
          const marker = mk ? mk[0]! : "";
          const runs = runsOf(line.pieces, line.size);
          if (runs.length) runs[0] = { ...runs[0]!, text: runs[0]!.text.slice(marker.length) };
          items.push({ kind: "item", level: 0, ordered: !!numbered, item: { runs: trimRuns(runs) }, line, page: pi });
          i++;
          // Continuation lines of the same item: indented at the text start, close below.
          while (i < lines.length) {
            const nx = lines[i]!;
            const pv = lines[i - 1]!;
            if (tableAt.has(i) || BULLET.test(nx.text) || NUMBERED.test(nx.text) || nx.size >= body * 1.25) break;
            if (pv.y - nx.y > pitch * 1.45 || nx.x0 < line.x0 + line.size * 0.4) break;
            const li = items[items.length - 1] as Extract<PItem, { kind: "item" }>;
            li.item.runs = trimRuns(mergeRuns([...li.item.runs, { text: " " }, ...runsOf(nx.pieces, nx.size)]));
            i++;
          }
          continue;
        }
        const lineRuns = runsOf(line.pieces, line.size);
        if (!open) {
          // A paragraph can continue from the previous page.
          const last = items[items.length - 1];
          const lastPara = last && last.kind === "block" && last.block.type === "paragraph" && last.page === pi - 1 && !prev ? last.block : null;
          const prevText = lastPara ? lastPara.runs.map((r) => r.text).join("") : "";
          if (lastPara && (!SENTENCE_END.test(prevText) && /^[a-z(“"'‘]/.test(line.text) || /[A-Za-z]-$/.test(prevText))) {
            items.pop();
            open = { runs: [...lastPara.runs], lines: [line], align: lastPara.align === "center" || lastPara.align === "right" ? lastPara.align : "left" };
            if (/[A-Za-z]-$/.test(prevText) && /^[a-z]/.test(line.text)) {
              const lr = open.runs[open.runs.length - 1]!;
              open.runs[open.runs.length - 1] = { ...lr, text: lr.text.slice(0, -1) };
              open.runs.push(...lineRuns);
            } else open.runs.push({ text: " " }, ...lineRuns);
          } else open = { runs: [...lineRuns], lines: [line], align: alignOf(line) };
        } else {
          const pl = open.lines[open.lines.length - 1]!;
          // The right margin of this line's own column or indent group, so a narrow column is not mistaken for ragged text.
          const rightEdge = Math.max(...lines.filter((l) => Math.abs(l.x0 - pl.x0) < body * 4 || l.x0 < pl.x1).map((l) => l.x1));
          const shortPrev = pl.x1 < rightEdge - body * 3 && SENTENCE_END.test(pl.text);
          const indent = line.x0 - pl.x0 > body * 1.2 && SENTENCE_END.test(pl.text);
          const breakHere = gap > pitch * 1.55 || shortPrev || indent || Math.abs(line.size - pl.size) > pl.size * 0.18 || alignOf(line) !== open.align;
          if (breakHere) {
            closeParagraph();
            open = { runs: [...lineRuns], lines: [line], align: alignOf(line) };
          } else {
            const lastRun = open.runs[open.runs.length - 1]!;
            if (/[A-Za-z]-$/.test(pl.text) && /^[a-z]/.test(line.text)) {
              open.runs[open.runs.length - 1] = { ...lastRun, text: lastRun.text.slice(0, -1) };
              open.runs.push(...lineRuns);
            } else open.runs.push({ text: " " }, ...lineRuns);
            open.lines.push(line);
          }
        }
        i++;
      }
      closeParagraph();
    });

    // Group list items into nested lists by indentation.
    const blocks: Block[] = [];
    let stack: { x: number; ordered: boolean; list: Extract<Block, { type: "list" }> }[] = [];
    for (const it of items) {
      if (it.kind === "block") {
        stack = [];
        blocks.push(it.block);
        continue;
      }
      const x = it.line.x0;
      while (stack.length && x < stack[stack.length - 1]!.x - it.line.size * 0.6) stack.pop();
      let top = stack[stack.length - 1];
      if (top && Math.abs(top.x - x) <= it.line.size * 0.6 && top.ordered === it.ordered) {
        top.list.items.push(it.item);
        continue;
      }
      if (top && Math.abs(top.x - x) <= it.line.size * 0.6) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      const list: Extract<Block, { type: "list" }> = { type: "list", ordered: it.ordered, items: [it.item] };
      if (top && x > top.x) {
        const parentItem = top.list.items[top.list.items.length - 1];
        if (parentItem) (parentItem.children ??= []).push(list);
        else blocks.push(list);
      } else blocks.push(list);
      stack.push({ x, ordered: it.ordered, list });
    }

    const info = (await doc.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined;
    const clean = (v: unknown) => (typeof v === "string" ? stripControl(v).trim().slice(0, 300) || undefined : undefined);
    const keywords = clean(info?.Keywords)?.split(/[,;]/).map((k) => k.trim()).filter(Boolean).slice(0, 20);
    const meta: DocMeta = { title: clean(info?.Title), author: clean(info?.Author), subject: clean(info?.Subject), keywords: keywords?.length ? keywords : undefined };

    const plural = (x: number, w: string) => `${x.toLocaleString()} ${w}${x === 1 ? "" : "s"}`;
    const warnings: ConversionWarning[] = [
      warn("experimental", "PDF to Word is experimental and approximate. FileForge rebuilds paragraphs, headings, lists and simple tables from the text in the PDF. The original page layout, fonts, columns and spacing are not kept, so check the result before you rely on it.", "info"),
    ];
    if (tablesFound) warnings.push(warn("tables-detected", `${plural(tablesFound, "table")} rebuilt from aligned text. Merged cells and borders are not recovered; check the columns.`, "info"));
    else warnings.push(warn("tables", "Tables in a PDF are only recognised when their columns line up clearly. Other tables appear as ordinary text.", "info"));
    const colPages = pages.filter((pg) => pg.columns).length;
    if (colPages) warnings.push(warn("columns", `${plural(colPages, "page")} use two text columns. The reading order is rebuilt column by column, so check it.`));
    if (images) warnings.push(warn("images", `${plural(images, "picture")} in the PDF can't be extracted and ${images === 1 ? "is" : "are"} not included.`));
    if (emptyPages) warnings.push(warn("empty-pages", `${plural(emptyPages, "page")} contain no selectable text (blank or scanned) and ${emptyPages === 1 ? "is" : "are"} skipped.`));
    if (rotated) warnings.push(warn("rotated", `${plural(rotated, "piece")} of rotated or vertical text not included.`));
    if (removed.size) {
      const sample = [...removed.keys()].slice(0, 3).map((k) => `"${k}"`).join(", ");
      warnings.push(warn("headers-removed", `Repeated headers, footers and page numbers (${sample}) were removed from the text. Use the Advanced options to add page numbers and a header.`, "info"));
    }
    if (rtlLines) warnings.push(warn("rtl", "Right-to-left text was detected. Its order is rebuilt from the page positions and may be wrong.", "info"));
    if (linkCount) warnings.push(warn("links", `${plural(linkCount, "linked word")} kept as hyperlinks.`, "info"));
    warnings.push(warn("page-breaks", "Page breaks are not kept; text flows continuously and Word will paginate it.", "info"));

    const first = blocks.find((b) => b.type === "heading");
    const title = meta.title ?? (first && first.type === "heading" ? first.runs.map((r) => r.text).join("") : undefined);
    const out = finalizeDoc(blocks, warnings, title, meta);
    if (!out.charCount) throw new FileForgeError("no-content", "No text could be extracted from this PDF.");
    return { doc: out, suggested: { page: { orientation: pages[0] && pages[0].width > pages[0].height ? "landscape" : "portrait" } } };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    void task.destroy();
  }
}
