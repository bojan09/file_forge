import { PDFDocument, PDFHexString, PDFName, type PDFDict, degrees } from "pdf-lib";
import { FileForgeError } from "../types";

export interface PdfMeta {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}
export interface PdfInfo extends PdfMeta {
  pageCount: number;
  bytes: number;
}
export interface PlanItem {
  /** Index into the input list. */
  file: number;
  /** Zero-based page. */
  page: number;
  /** Extra clockwise rotation: 0, 90, 180 or 270. */
  rotate: number;
}
export interface ToolOutput {
  name: string;
  bytes: Uint8Array;
  pages: number;
}

export const PDF_TOOL_LIMITS = {
  fileBytes: 100 * 1024 * 1024,
  totalBytes: 300 * 1024 * 1024,
  totalPages: 3000,
  files: 30,
} as const;

const PRODUCER = "FileForge";
/** pdf-lib exposes the Info dictionary only as a private method, which is the one way to keep Keywords verbatim. */
const infoDict = (doc: PDFDocument) => (doc as unknown as { getInfoDict(): PDFDict }).getInfoDict();

async function load(bytes: Uint8Array, name = "This file"): Promise<PDFDocument> {
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
    // Allow leading junk (some producers prepend bytes) within the first KB, as readers do.
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
    if (!head.includes("%PDF-")) throw new FileForgeError("not-pdf", `${name} is not a PDF file.`);
  }
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) throw new FileForgeError("pdf-encrypted", `${name} is password-protected. FileForge cannot open protected PDFs; remove the password in the program that created it first.`);
    throw new FileForgeError("pdf-damaged", `${name} could not be read; it may be damaged or truncated.`);
  }
}

export async function inspectPdf(bytes: Uint8Array, name?: string): Promise<PdfInfo> {
  const doc = await load(bytes, name);
  return {
    pageCount: doc.getPageCount(),
    bytes: bytes.length,
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: doc.getKeywords() ?? "",
  };
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}

/** Merge, extract, reorder, rotate and delete are all "build a new document from this page plan". */
export async function buildFromPlan(inputs: Uint8Array[], plan: PlanItem[], names: string[] = [], meta?: Partial<PdfMeta>): Promise<{ bytes: Uint8Array; pages: number }> {
  if (!plan.length) throw new FileForgeError("empty-plan", "Keep at least one page.");
  if (plan.length > PDF_TOOL_LIMITS.totalPages) throw new FileForgeError("too-many-pages", `That would produce ${plan.length} pages; the limit is ${PDF_TOOL_LIMITS.totalPages}.`);
  const out = await PDFDocument.create({ updateMetadata: false });
  const sources = new Map<number, PDFDocument>();
  const queues = new Map<number, number[]>();
  plan.forEach((p) => queues.set(p.file, [...(queues.get(p.file) ?? []), p.page]));
  const copied = new Map<number, ReturnType<PDFDocument["getPage"]>[]>();
  for (const [file, pages] of queues) {
    const src = await load(inputs[file]!, names[file]);
    sources.set(file, src);
    const count = src.getPageCount();
    if (pages.some((i) => i < 0 || i >= count)) throw new FileForgeError("bad-page", `${names[file] ?? "A file"} has ${count} pages; the selection is out of range.`);
    // One copy call per file keeps shared fonts and images stored once.
    copied.set(file, await out.copyPages(src, pages));
  }
  const cursor = new Map<number, number>();
  for (const p of plan) {
    const i = cursor.get(p.file) ?? 0;
    cursor.set(p.file, i + 1);
    const page = copied.get(p.file)![i]!;
    if (p.rotate) page.setRotation(degrees((((page.getRotation().angle + p.rotate) % 360) + 360) % 360));
    out.addPage(page);
  }
  const first = sources.get(plan[0]!.file)!;
  out.setTitle(meta?.title ?? first.getTitle() ?? "");
  if (meta?.author ?? first.getAuthor()) out.setAuthor(meta?.author ?? first.getAuthor() ?? "");
  out.setProducer(PRODUCER);
  out.setCreator(PRODUCER);
  const bytes = await save(out);
  const check = await PDFDocument.load(bytes, { updateMetadata: false });
  if (check.getPageCount() !== plan.length) throw new FileForgeError("verify-failed", `The result has ${check.getPageCount()} pages instead of ${plan.length}; it was discarded.`);
  return { bytes, pages: plan.length };
}

export async function setMetadata(bytes: Uint8Array, meta: PdfMeta, clearAll: boolean, name?: string): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await load(bytes, name);
  if (clearAll) {
    doc.setTitle("");
    doc.setAuthor("");
    doc.setSubject("");
    infoDict(doc).delete(PDFName.of("Keywords"));
    doc.setCreator("");
  } else {
    doc.setTitle(meta.title);
    doc.setAuthor(meta.author);
    doc.setSubject(meta.subject);
    // Stored verbatim (pdf-lib's setKeywords would join with spaces).
    if (meta.keywords.trim()) infoDict(doc).set(PDFName.of("Keywords"), PDFHexString.fromText(meta.keywords.trim()));
    else infoDict(doc).delete(PDFName.of("Keywords"));
  }
  doc.setProducer(PRODUCER);
  const out = await save(doc);
  const check = await PDFDocument.load(out, { updateMetadata: false });
  if (check.getPageCount() !== doc.getPageCount()) throw new FileForgeError("verify-failed", "The result lost pages; it was discarded.");
  return { bytes: out, pages: check.getPageCount() };
}

/**
 * Experimental: lossless structural compression only (object and cross-reference streams, unused objects dropped).
 * Images are never re-encoded, so already-compressed scans will not shrink. A result that is not smaller is not returned.
 */
export async function compressPdf(bytes: Uint8Array, name?: string): Promise<{ bytes: Uint8Array; pages: number; smaller: boolean }> {
  const doc = await load(bytes, name);
  const pages = doc.getPageCount();
  const out = await save(doc);
  if (out.length >= bytes.length) return { bytes, pages, smaller: false };
  const check = await PDFDocument.load(out, { updateMetadata: false });
  if (check.getPageCount() !== pages) throw new FileForgeError("verify-failed", "The compressed file lost pages; it was discarded.");
  return { bytes: out, pages, smaller: true };
}
