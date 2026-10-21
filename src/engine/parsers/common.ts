import { readImageSize, sniffImage } from "../validate";
import type { Align, Block, ConversionWarning, DocMeta, ImageData, Inline, NormalizedDoc } from "../types";

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
  return `${r.bold ? 1 : 0}${r.italic ? 1 : 0}${r.strike ? 1 : 0}${r.underline ? 1 : 0}${r.code ? 1 : 0}${r.color ?? ""}|${r.link ?? ""}`;
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

export function finalizeDoc(blocks: Block[], warnings: ConversionWarning[], title?: string, meta?: DocMeta): NormalizedDoc {
  let imageCount = 0;
  let charCount = 0;
  let hasTables = false;
  let hasLists = false;
  let hasHeadings = false;
  walkBlocks(blocks, (b) => {
    charCount += blockChars(b);
    if (b.type === "table") hasTables = true;
    if (b.type === "list" && !b.plain) hasLists = true;
    if (b.type === "heading") hasHeadings = true;
    if (b.type === "image") imageCount++;
  });
  return { title, meta, blocks, warnings, charCount, hasTables, hasLists, hasHeadings, imageCount };
}

export function warn(code: string, message: string, level: "info" | "warn" = "warn"): ConversionWarning {
  return { code, level, message };
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", gray: "#808080", grey: "#808080", silver: "#a0a0a0", red: "#c00000", maroon: "#800000", orange: "#d97706", olive: "#808000",
  green: "#15803d", lime: "#16a34a", teal: "#0f766e", aqua: "#0891b2", cyan: "#0891b2", blue: "#1d4ed8", navy: "#1e3a8a", purple: "#7e22ce", fuchsia: "#a21caf", magenta: "#a21caf", pink: "#db2777", brown: "#92400e",
};

/** Luminance 0..1 (sRGB, approximate). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Parses a CSS color into "#rrggbb". Returns undefined for anything unparseable, and for near-white colors
 * (white text on a white page would vanish, because backgrounds are not reproduced).
 */
export function normalizeColor(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  let hex: string | undefined;
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) hex = "#" + m[1]!.split("").map((c) => c + c).join("");
  else if ((m = /^#([0-9a-f]{6})$/.exec(v))) hex = "#" + m[1];
  else if ((m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.%]+\s*)?\)$/.exec(v))) {
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)));
    hex = "#" + [r, g, b].map((x) => x!.toString(16).padStart(2, "0")).join("");
  } else hex = NAMED_COLORS[v];
  if (!hex) return undefined;
  return luminance(hex) > 0.93 ? undefined : hex;
}

export function parseAlign(value: string | null | undefined): Align | undefined {
  const v = (value ?? "").trim().toLowerCase();
  return v === "center" || v === "right" || v === "justify" ? v : v === "left" ? "left" : undefined;
}

export interface ImageBudget {
  maxImages: number;
  maxBytesEach: number;
  maxBytesTotal: number;
  maxMegapixels: number;
  count: number;
  bytes: number;
}

/** Walks the PNG chunk list: IHDR first, at least one IDAT, IEND reached, no chunk running past the end. */
export function pngStructureOk(b: Uint8Array): boolean {
  let i = 8;
  let first = true;
  let idat = false;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const name = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (first && name !== "IHDR") return false;
    first = false;
    if (i + 12 + len > b.length) return false;
    if (name === "IDAT") idat = true;
    if (name === "IEND") return idat;
    i += 12 + len;
  }
  return false;
}

export const newImageBudget = (maxMegapixels: number): ImageBudget => ({ maxImages: 100, maxBytesEach: 4 * 1024 * 1024, maxBytesTotal: 20 * 1024 * 1024, maxMegapixels, count: 0, bytes: 0 });

export type ImageRejection = "not-data" | "format" | "size" | "count" | "decode";

/** Validates raw PNG/JPEG bytes (sniffed, structure-checked, size-budgeted) and records them against the budget. */
export function embedDataUriBytes(bytes: Uint8Array, alt: string | undefined, budget: ImageBudget): { image: ImageData } | { rejected: ImageRejection } {
  if (budget.count >= budget.maxImages) return { rejected: "count" };
  if (bytes.length > budget.maxBytesEach || budget.bytes + bytes.length > budget.maxBytesTotal) return { rejected: "size" };
  const type = sniffImage(bytes);
  if (type !== "png" && type !== "jpeg") return { rejected: "format" };
  if (type === "png" && !pngStructureOk(bytes)) return { rejected: "decode" };
  const size = readImageSize(bytes, type);
  if (!size || size.width < 1 || size.height < 1 || (size.width * size.height) / 1e6 > budget.maxMegapixels) return { rejected: "size" };
  budget.count++;
  budget.bytes += bytes.length;
  return { image: { bytes, mime: type === "png" ? "image/png" : "image/jpeg", width: size.width, height: size.height, alt: alt?.trim() || undefined } };
}

/** Decodes a base64 `data:image/png|jpeg` URI. Only JPEG and PNG are embedded; the bytes are sniffed, never trusted. */
export function embedDataUri(src: string, alt: string | undefined, budget: ImageBudget): { image: ImageData } | { rejected: ImageRejection } {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src.trim());
  if (!m) return { rejected: /^data:/i.test(src.trim()) ? "format" : "not-data" };
  const b64 = m[2]!.replace(/\s+/g, "");
  if (b64.length * 0.75 > budget.maxBytesEach || budget.bytes + b64.length * 0.75 > budget.maxBytesTotal) return { rejected: "size" };
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { rejected: "decode" };
  }
  return embedDataUriBytes(bytes, alt, budget);
}

export function describeRejected(reasons: Map<ImageRejection, number>, total: number): string[] {
  const out: string[] = [];
  const n = (k: ImageRejection) => reasons.get(k) ?? 0;
  if (n("not-data")) out.push(`${n("not-data")} linked image${n("not-data") > 1 ? "s were" : " was"} not loaded: FileForge never fetches anything referenced by your file. Embed the image as a data: URI to include it.`);
  if (n("format")) out.push(`${n("format")} embedded image${n("format") > 1 ? "s use" : " uses"} a format other than PNG or JPEG and ${n("format") > 1 ? "were" : "was"} left out.`);
  if (n("size") || n("count")) out.push(`${n("size") + n("count")} image${n("size") + n("count") > 1 ? "s" : ""} exceeded the size or count limits (4 MB each, 20 MB total, 100 images) and ${n("size") + n("count") > 1 ? "were" : "was"} left out.`);
  if (n("decode")) out.push(`${n("decode")} image${n("decode") > 1 ? "s" : ""} could not be decoded and ${n("decode") > 1 ? "were" : "was"} left out.`);
  void total;
  return out;
}
