import { prepareImage } from "./prep-image";
import { getFormat, type SourceFormat } from "./registry";
import { parseCsv } from "./parsers/csv";
import { parseHtml } from "./parsers/html";
import { parseMarkdown } from "./parsers/markdown";
import { parseTxt } from "./parsers/txt";
import { checkImageBytes, decodeText, validateFileMeta, type ImageType } from "./validate";
import { renderJob } from "./worker-client";
import { FileForgeError, type ConversionWarning, type NormalizedDoc, type OutputFormat, type PageSettings, type Processing, type QualityCheck, type SourceKind, type Stage } from "./types";

const PREVIEW_CHARS = 20000;

export interface Inspection {
  name: string;
  sizeBytes: number;
  format: SourceFormat;
  kind: SourceKind;
  extension: string;
  doc?: NormalizedDoc;
  rawText?: string;
  rawTruncated?: boolean;
  image?: { bytes: Uint8Array; type: ImageType; width: number; height: number };
  warnings: ConversionWarning[];
}

export async function inspectFile(file: File, processing: Processing, onStep?: (s: "reading" | "parsing") => void): Promise<Inspection> {
  onStep?.("reading");
  const { format, extension } = validateFileMeta(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  onStep?.("parsing");
  const base = { name: file.name, sizeBytes: file.size, format, kind: format.id, extension };

  if (format.id === "image") {
    const info = checkImageBytes(bytes, extension, processing);
    return { ...base, image: { bytes, type: info.type, width: info.width, height: info.height }, warnings: [] };
  }

  const { text, replacementCount } = decodeText(bytes);
  const warnings: ConversionWarning[] = [];
  if (replacementCount > 0) {
    warnings.push({
      code: "encoding",
      level: "warn",
      message: `${replacementCount.toLocaleString()} character${replacementCount > 1 ? "s" : ""} couldn't be decoded as UTF-8. The file may use another encoding; those characters appear as �.`,
    });
  }
  if (!text.trim()) throw new FileForgeError("empty-file", "This file contains no text.");

  let doc: NormalizedDoc;
  switch (format.id) {
    case "txt":
      doc = parseTxt(text);
      break;
    case "md":
      doc = parseMarkdown(text);
      break;
    case "html":
      doc = parseHtml(text, processing);
      break;
    case "csv":
      doc = parseCsv(text, processing);
      break;
  }
  if (!doc.blocks.length) throw new FileForgeError("no-content", "No convertible content was found in this file.");
  doc.warnings = [...warnings, ...doc.warnings];
  if (format.id === "txt" || format.id === "md") {
    if (file.size > 1024 * 1024) {
      doc.warnings.push({ code: "large", level: "info", message: "This is a large file. Conversion may take a while; you can cancel at any time." });
    }
  }
  const rawTruncated = text.length > PREVIEW_CHARS;
  return { ...base, doc, rawText: rawTruncated ? text.slice(0, PREVIEW_CHARS) : text, rawTruncated, warnings: doc.warnings };
}

export function outputsFor(insp: Pick<Inspection, "format">): OutputFormat[] {
  return insp.format.outputs;
}

export function safeBaseName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  return base || "converted";
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
  const filename = `${title}${suffix.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "")}.${result.extension}`;
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
