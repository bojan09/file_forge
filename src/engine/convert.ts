import { sanitizeFileName, splitName } from "./batch/naming";
import { prepareImage } from "./prep-image";
import { getFormat, type SourceFormat } from "./registry";
import { DEFAULT_PARSE_OPTIONS } from "./style";
import type { ParsedBinary, WorkbookInfo } from "./parsers/binary";
import { isZip } from "./parsers/zip-safe";
import { checkImageBytes, decodeText, validateFileMeta, type ImageType } from "./validate";
import { renderJob } from "./worker-client";
import { FileForgeError, type ConversionWarning, type Fidelity, type NormalizedDoc, type OutputFormat, type PageSettings, type ParseOptions, type Processing, type QualityCheck, type SourceKind, type Stage } from "./types";

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
  /** Original bytes of a binary source (DOCX, XLSX, PDF), kept so options can re-parse without re-reading the file. */
  bytes?: Uint8Array;
  /** Settings read from the source itself (page setup, fonts, header/footer); applied as editable defaults. */
  suggested?: ParsedBinary["suggested"];
  workbook?: WorkbookInfo;
  rawText?: string;
  rawTruncated?: boolean;
  image?: { bytes: Uint8Array; type: ImageType; width: number; height: number };
  warnings: ConversionWarning[];
}

/** Parsers are loaded on demand so the first paint only pays for the format actually used. */
async function parseText(kind: "txt" | "md" | "html" | "csv", text: string, processing: Processing, options: ParseOptions): Promise<NormalizedDoc> {
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

const SIGNATURE_ERRORS: Record<"docx" | "xlsx" | "pdf", string> = {
  docx: "This file isn't a valid .docx document (it is not a ZIP-based Word file). Older .doc files and renamed files can't be converted.",
  xlsx: "This file isn't a valid .xlsx workbook (it is not a ZIP-based Excel file). Older .xls files and renamed files can't be converted.",
  pdf: "This file isn't a valid PDF (it doesn't start with a PDF header).",
};

/** Cheap signature check shared by single-file inspection and batch intake. */
export function checkBinarySignature(kind: "docx" | "xlsx" | "pdf", head: Uint8Array): void {
  const ok = kind === "pdf" ? head.length >= 5 && String.fromCharCode(...head.subarray(0, 5)) === "%PDF-" : isZip(head);
  if (!ok) throw new FileForgeError("bad-signature", SIGNATURE_ERRORS[kind]);
}

async function parseBinary(kind: "docx" | "xlsx" | "pdf", bytes: Uint8Array, processing: Processing, options: ParseOptions, signal?: AbortSignal): Promise<ParsedBinary> {
  switch (kind) {
    case "docx":
      return (await import("./parsers/docx")).parseDocx(bytes, processing);
    case "xlsx":
      return (await import("./parsers/xlsx")).parseXlsx(bytes, processing, options);
    case "pdf":
      return (await import("./parsers/pdf")).parsePdf(bytes, processing, signal);
  }
}

function finishDoc(doc: NormalizedDoc, decodeWarnings: ConversionWarning[], kind: SourceKind, size: number): NormalizedDoc {
  if (!doc.blocks.length) throw new FileForgeError("no-content", "No convertible content was found in this file.");
  doc.warnings = [...decodeWarnings, ...doc.warnings];
  const note = complexityNote(doc, size, kind);
  if (note) doc.warnings.push(note);
  return doc;
}

export async function inspectFile(file: File, processing: Processing, onStep?: (s: "reading" | "parsing") => void, options: ParseOptions = DEFAULT_PARSE_OPTIONS, signal?: AbortSignal): Promise<Inspection> {
  onStep?.("reading");
  const { format, extension } = validateFileMeta(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  onStep?.("parsing");
  const base = { file, name: file.name, sizeBytes: file.size, format, kind: format.id, extension, options };

  if (format.id === "image") {
    const info = checkImageBytes(bytes, extension, processing);
    return { ...base, image: { bytes, type: info.type, width: info.width, height: info.height }, warnings: [] };
  }

  if (format.id === "docx" || format.id === "xlsx" || format.id === "pdf") {
    checkBinarySignature(format.id, bytes);
    const parsed = await parseBinary(format.id, bytes, processing, options, signal);
    const doc = finishDoc(parsed.doc, [], format.id, file.size);
    return { ...base, doc, bytes, suggested: parsed.suggested, workbook: parsed.workbook, warnings: doc.warnings };
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
  if (insp.kind === "image") return { ...insp, options };
  if (insp.kind === "docx" || insp.kind === "xlsx" || insp.kind === "pdf") {
    if (!insp.bytes) return { ...insp, options };
    const parsed = await parseBinary(insp.kind, insp.bytes, processing, options);
    const doc = finishDoc(parsed.doc, [], insp.kind, insp.sizeBytes);
    return { ...insp, doc, options, warnings: doc.warnings, workbook: parsed.workbook ?? insp.workbook };
  }
  if (insp.text === undefined) return { ...insp, options };
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
  fidelity: Fidelity;
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
