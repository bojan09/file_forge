import type { Block, ConversionWarning, Inline, NormalizedDoc } from "../types";

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Returns the URL only when it is an absolute http(s)/mailto link. */
export function safeLink(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  try {
    const u = new URL(trimmed);
    return SAFE_PROTOCOLS.has(u.protocol) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function stripControl(s: string): string {
  return s.replace(CONTROL_CHARS, "");
}

export function runsText(runs: Inline[]): string {
  let s = "";
  for (const r of runs) s += r.text;
  return s;
}

function inlineKey(r: Inline): string {
  return `${r.bold ? 1 : 0}${r.italic ? 1 : 0}${r.strike ? 1 : 0}${r.code ? 1 : 0}${r.link ?? ""}`;
}

/** Merges neighbouring runs that share formatting. */
export function mergeRuns(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && inlineKey(last) === inlineKey(r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export function trimRuns(runs: Inline[]): Inline[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length) {
    const first = out[0]!;
    first.text = first.text.replace(/^[ \t\n]+/, "");
    if (first.text) break;
    out.shift();
  }
  while (out.length) {
    const last = out[out.length - 1]!;
    last.text = last.text.replace(/[ \t\n]+$/, "");
    if (last.text) break;
    out.pop();
  }
  return out;
}

function walkBlocks(blocks: Block[], visit: (b: Block) => void) {
  for (const b of blocks) {
    visit(b);
    if (b.type === "quote") walkBlocks(b.blocks, visit);
    if (b.type === "list") for (const it of b.items) if (it.children) walkBlocks(it.children, visit);
  }
}

function blockChars(b: Block): number {
  switch (b.type) {
    case "heading":
    case "paragraph":
      return runsText(b.runs).length;
    case "code":
      return b.text.length;
    case "list":
      return b.items.reduce((n, it) => n + runsText(it.runs).length, 0);
    case "table": {
      let n = 0;
      for (const row of [...(b.header ? [b.header] : []), ...b.rows]) for (const cell of row) n += runsText(cell).length;
      return n;
    }
    default:
      return 0;
  }
}

export function finalizeDoc(blocks: Block[], warnings: ConversionWarning[], title?: string): NormalizedDoc {
  let charCount = 0;
  let hasTables = false;
  let hasLists = false;
  let hasHeadings = false;
  walkBlocks(blocks, (b) => {
    charCount += blockChars(b);
    if (b.type === "table") hasTables = true;
    if (b.type === "list") hasLists = true;
    if (b.type === "heading") hasHeadings = true;
  });
  return { title, blocks, warnings, charCount, hasTables, hasLists, hasHeadings };
}

export function warn(code: string, message: string, level: "info" | "warn" = "warn"): ConversionWarning {
  return { code, level, message };
}
