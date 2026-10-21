import { sanitizeFileName, splitName } from "./batch/naming";
import { prepareImage } from "./prep-image";
import { getFormat, type SourceFormat } from "./registry";
import { DEFAULT_PARSE_OPTIONS } from "./style";
import { checkImageBytes, decodeText, validateFileMeta, type ImageType } from "./validate";
import { renderJob } from "./worker-client";
import { FileForgeError, type ConversionWarning, type NormalizedDoc, type OutputFormat, type PageSettings, type ParseOptions, type Processing, type QualityCheck, type SourceKind, type Stage } from "./types";

const PREVIEW_CHARS = 20000;

export interface Inspection {
  /** The original File handle (a reference, not a copy), kept so the file can move into a batch. */
  file: File;
  name: string;
  sizeBytes: number;
  format: SourceFormat;
  kind: SourceKind;
  extension: string;
  doc?: NormalizedDoc;
  /** Decoded source text, kept so options (CSV delimiter, Markdown mode) can re-parse without re-reading the file. */
  text?: string;
  /** Warnings about decoding, kept separate so a re-parse can rebuild the full list. */
  decodeWarnings?: ConversionWarning[];
  options: ParseOptions;
  rawText?: string;
  rawTruncated?: boolean;
  image?: { bytes: Uint8Array; type: ImageType; width: number; height: number };
  warnings: ConversionWarning[];
}

/** Parsers are loaded on demand so the first paint only pays for the format actually used. */
async function parseText(kind: Exclude<SourceKind, "image">, text: string, processing: Processing, options: ParseOptions): Promise<NormalizedDoc> {
  switch (kind) {
    case "txt":
      return (await import("./parsers/txt")).parseTxt(text);
    case "md":
      return (await import("./parsers/markdown")).parseMarkdown(text, options, processing);
    case "html":
      return (await import("./parsers/html")).parseHtml(text, processing);
    case "csv":
      return (await import("./parsers/csv")).parseCsv(text, processing, options);
  }
}

/** Rough page estimate: ~3,000 characters per page, a table row ~1/40 page, an image ~1/3 page. Used only for warnings. */
export function estimatePages(doc: NormalizedDoc): number {
  let rows = 0;
  const walk = (blocks: NormalizedDoc["blocks"]) => {
    for (const b of blocks) {
      if (b.type === "table") rows += b.rows.length + (b.header ? 1 : 0);
      else if (b.type === "quote") walk(b.blocks);
      else if (b.type === "list") for (const it of b.items) if (it.children) walk(it.children);
    }
  };
  walk(doc.blocks);
  return Math.max(1, Math.round(doc.charCount / 3000 + rows / 40 + (doc.imageCount ?? 0) / 3));
}

export function complexityNote(doc: NormalizedDoc, size: number, kind: SourceKind): ConversionWarning | null {
  const pages = estimatePages(doc);
  if (pages >= 400) {
    return { code: "large", level: "warn", message: `This document is roughly ${pages.toLocaleString()} pages long. A PDF can take a minute or more and uses a lot of memory; you can cancel at any time. DOCX is much faster for very long documents.` };
  }
  if (pages >= 100 || (size > 1024 * 1024 && (kind === "txt" || kind === "md"))) {
    return { code: "large", level: "info", message: `This is a large document (about ${pages.toLocaleString()} pages). Conversion may take a while; you can cancel at any time.` };
  }
  if ((doc.imageCount ?? 0) >= 30) {
    return { code: "many-images", level: "info", message: `${doc.imageCount} embedded images make this conversion heavier than usual.` };
  }
  return null;
}

function finishDoc(doc: NormalizedDoc, decodeWarnings: ConversionWarning[], kind: SourceKind, size: number): NormalizedDoc {
  if (!doc.blocks.length) throw new FileForgeError("no-content", "No convertible content was found in this file.");
  doc.warnings = [...decodeWarnings, ...doc.warnings];
  const note = complexityNote(doc, size, kind);
  if (note) doc.warnings.push(note);
  return doc;
}

export async function inspectFile(file: File, processing: Processing, onStep?: (s: "reading" | "parsing") => void, options: ParseOptions = DEFAULT_PARSE_OPTIONS): Promise<Inspection> {
  onStep?.("reading");
  const { format, extension } = validateFileMeta(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  onStep?.("parsing");
  const base = { file, name: file.name, sizeBytes: file.size, format, kind: format.id, extension, options };

  if (format.id === "image") {
    const info = checkImageBytes(bytes, extension, processing);
    return { ...base, image: { bytes, type: info.type, width: info.width, height: info.height }, warnings: [] };
  }

  const { text, replacementCount } = decodeText(bytes);
  const decodeWarnings: ConversionWarning[] = [];
  if (replacementCount > 0) {
    decodeWarnings.push({
      code: "encoding",
      level: "warn",
      message: `${replacementCount.toLocaleString()} character${replacementCount > 1 ? "s" : ""} couldn't be decoded as UTF-8. The file may use another encoding; those characters appear as �.`,
    });
  }
  if (!text.trim()) throw new FileForgeError("empty-file", "This file contains no text.");

  const doc = finishDoc(await parseText(format.id, text, processing, options), decodeWarnings, format.id, file.size);
  const rawTruncated = text.length > PREVIEW_CHARS;
  return { ...base, doc, text, decodeWarnings, rawText: rawTruncated ? text.slice(0, PREVIEW_CHARS) : text, rawTruncated, warnings: doc.warnings };
}

/** Re-parses the already-decoded text with new options. Reads nothing from disk. */
export async function reparseInspection(insp: Inspection, processing: Processing, options: ParseOptions): Promise<Inspection> {
  if (insp.kind === "image" || insp.text === undefined) return { ...insp, options };
  const doc = finishDoc(await parseText(insp.kind, insp.text, processing, options), insp.decodeWarnings ?? [], insp.kind, insp.sizeBytes);
  return { ...insp, doc, options, warnings: doc.warnings };
}

export function outputsFor(insp: Pick<Inspection, "format">): OutputFormat[] {
  return insp.format.outputs;
}

export function safeBaseName(name: string): string {
  const { stem } = splitName(name);
  return sanitizeFileName(stem, "converted");
}

export interface ConversionOutput {
  blob: Blob;
  filename: string;
  mime: string;
  extension: "pdf" | "docx";
  sizeBytes: number;
  pageCount?: number;
  checks: QualityCheck[];
  warnings: ConversionWarning[];
  fidelity: "high" | "approximate";
}

export interface ConversionOptions {
  output: OutputFormat;
  settings: PageSettings;
  suffix: string;
  signal?: AbortSignal;
  onStage?: (s: Stage) => void;
}

export async function runConversion(insp: Inspection, opts: ConversionOptions): Promise<ConversionOutput> {
  const { output, settings, suffix, signal, onStage } = opts;
  const fmt = getFormat(insp.kind);
  if (!fmt.outputs.includes(output)) throw new FileForgeError("unsupported-output", `${fmt.label} can't be converted to ${output.toUpperCase()}.`);
  const title = safeBaseName(insp.name);
  onStage?.("reading");

  let result;
  if (insp.kind === "image") {
    if (!insp.image) throw new FileForgeError("state", "Image data is missing; please select the file again.");
    const image = await prepareImage(insp.image.bytes, insp.image.type, settings.imageQuality, signal);
    result = await renderJob({ kind: "image", image, settings, title }, { signal, onStage });
  } else {
    if (!insp.doc) throw new FileForgeError("state", "Document data is missing; please select the file again.");
    result = await renderJob({ kind: "doc", doc: insp.doc, output, settings, title }, { signal, onStage });
  }

  const blob = new Blob([result.bytes as BlobPart], { type: result.mime });
  const filename = sanitizeFileName(`${title}${suffix}.${result.extension}`, "converted");
  return {
    blob,
    filename,
    mime: result.mime,
    extension: result.extension,
    sizeBytes: blob.size,
    pageCount: result.pageCount,
    checks: result.checks,
    warnings: insp.warnings,
    fidelity: fmt.fidelity[output] ?? "approximate",
  };
}
