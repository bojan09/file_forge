import type { Fidelity, OutputFormat, Processing, SourceKind } from "./types";

const MB = 1024 * 1024;

export interface SourceFormat {
  id: SourceKind;
  label: string;
  /** Lower-case extensions without the dot. */
  extensions: string[];
  /** MIME types browsers commonly report; an empty or unknown type is tolerated. */
  mimeTypes: string[];
  maxBytes: number;
  outputs: OutputFormat[];
  fidelity: Record<OutputFormat, Fidelity | undefined>;
  summary: string;
  notes: string[];
}

export const SOURCE_FORMATS: SourceFormat[] = [
  {
    id: "txt",
    label: "Plain text",
    extensions: ["txt"],
    mimeTypes: ["text/plain"],
    maxBytes: 5 * MB,
    outputs: ["pdf", "docx"],
    fidelity: { pdf: "high", docx: "high" },
    summary: "Line breaks and paragraphs are preserved. Output uses a proportional font.",
    notes: ["Tabs become four spaces.", "Fixed-width alignment (ASCII tables) is not preserved."],
  },
  {
    id: "md",
    label: "Markdown",
    extensions: ["md", "markdown"],
    mimeTypes: ["text/markdown", "text/x-markdown"],
    maxBytes: 5 * MB,
    outputs: ["pdf", "docx"],
    fidelity: { pdf: "high", docx: "high" },
    summary: "Headings, paragraphs, lists, emphasis, links, code blocks, quotes and simple tables.",
    notes: ["Raw HTML inside Markdown is shown as plain text, never executed.", "Images are not fetched; alt text is kept as a placeholder."],
  },
  {
    id: "html",
    label: "HTML",
    extensions: ["html", "htm"],
    mimeTypes: ["text/html", "application/xhtml+xml"],
    maxBytes: 2 * MB,
    outputs: ["pdf", "docx"],
    fidelity: { pdf: "approximate", docx: "approximate" },
    summary: "A sanitized subset of document HTML: headings, paragraphs, lists, tables, links, emphasis, code.",
    notes: [
      "CSS, scripts, forms, frames and media are ignored.",
      "Remote images, stylesheets, scripts and fonts are never loaded.",
      "Complex layouts (columns, floats, positioning) are flattened into reading order.",
    ],
  },
  {
    id: "csv",
    label: "CSV",
    extensions: ["csv"],
    mimeTypes: ["text/csv", "application/csv", "application/vnd.ms-excel"],
    maxBytes: 5 * MB,
    outputs: ["pdf", "docx"],
    fidelity: { pdf: "approximate", docx: "approximate" },
    summary: "Rendered as a table. The first row is treated as the header.",
    notes: ["Very wide tables shrink text or wrap; landscape is recommended.", "Number and date formatting is kept exactly as written."],
  },
  {
    id: "image",
    label: "Images",
    extensions: ["jpg", "jpeg", "png", "webp"],
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 15 * MB,
    outputs: ["pdf"],
    fidelity: { pdf: "high", docx: undefined },
    summary: "One image per PDF page, with orientation and aspect ratio preserved.",
    notes: ["The PDF contains a picture. Text in the image is not selectable (no OCR).", "Images to DOCX is not supported."],
  },
];

export interface ProcessingLimits {
  csvMaxRows: number;
  csvMaxCols: number;
  htmlMaxNodes: number;
  imageMaxMegapixels: number;
}

export const PROCESSING_LIMITS: Record<Processing, ProcessingLimits> = {
  balanced: { csvMaxRows: 20000, csvMaxCols: 40, htmlMaxNodes: 100000, imageMaxMegapixels: 25 },
  conservative: { csvMaxRows: 5000, csvMaxCols: 30, htmlMaxNodes: 30000, imageMaxMegapixels: 12 },
};

export const ACCEPT_ATTR = SOURCE_FORMATS.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");

export function getExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function findFormatByExtension(ext: string): SourceFormat | undefined {
  return SOURCE_FORMATS.find((f) => f.extensions.includes(ext));
}

export function getFormat(id: SourceKind): SourceFormat {
  const f = SOURCE_FORMATS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown format ${id}`);
  return f;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}
