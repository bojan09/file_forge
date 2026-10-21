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
  /** Binary packages are validated by signature instead of being read as text. */
  binary?: boolean;
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
    summary: "Headings, paragraphs, lists, task lists, emphasis, links, code blocks, quotes, tables and embedded images.",
    notes: [
      "Raw HTML inside Markdown is shown as plain text, never executed (<br> is honoured).",
      "Only images embedded as data: URIs (PNG or JPEG) are included; linked images are never fetched and show their alt text.",
      "Front matter (title, author, description, keywords) becomes document properties. A source-text mode keeps the Markdown unformatted.",
    ],
  },
  {
    id: "html",
    label: "HTML",
    extensions: ["html", "htm"],
    mimeTypes: ["text/html", "application/xhtml+xml"],
    maxBytes: 2 * MB,
    outputs: ["pdf", "docx"],
    fidelity: { pdf: "approximate", docx: "approximate" },
    summary: "A sanitized subset of document HTML: headings, paragraphs, lists, tables, links, emphasis, code, basic inline styles and embedded images.",
    notes: [
      "Inline color, text-align, bold, italic, underline, strike-through and page breaks are applied. Other CSS, stylesheets, scripts, forms, frames and media are ignored and listed in the warnings.",
      "Only images embedded as data: URIs (PNG or JPEG) are included. Remote and relative images, stylesheets, scripts and fonts are never loaded.",
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
    summary: "Rendered as a table. The delimiter is auto-detected and can be overridden; the first row is the header unless you say otherwise.",
    notes: ["Very wide tables shrink text or wrap; Auto orientation picks landscape above 7 columns.", "Number and date formatting is kept exactly as written; numeric columns are right-aligned.", "Nothing is dropped silently: files above the limits are refused, blank lines are counted."],
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
  {
    id: "docx",
    label: "Word",
    extensions: ["docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    maxBytes: 25 * MB,
    outputs: ["pdf"],
    fidelity: { pdf: "experimental", docx: undefined },
    binary: true,
    summary: "Experimental. Text, headings, lists, tables, links and pictures become a PDF with searchable text; the original layout, fonts and spacing are not reproduced.",
    notes: [
      "Page size, orientation, margins, the main font style, header, footer and page numbers are read from the document and offered as editable options.",
      "Tracked changes are shown as final text. Comments, footnotes, endnotes, charts, SmartArt and embedded objects are not included, and each is reported.",
      "Macros are ignored and never run. Only .docx is accepted (not .doc or .docm).",
    ],
  },
  {
    id: "xlsx",
    label: "Excel",
    extensions: ["xlsx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    maxBytes: 15 * MB,
    outputs: ["pdf"],
    fidelity: { pdf: "experimental", docx: undefined },
    binary: true,
    summary: "Experimental. One sheet (or all sheets) becomes a table in the PDF, using the values as formatted in the workbook. Formulas show their last saved result and are never recalculated.",
    notes: [
      "Choose the sheet, whether to use the print area, and the page orientation. Wide sheets shrink the text; Auto orientation picks landscape above 7 columns.",
      "Colors, borders, fonts, conditional formatting, charts and pictures are not reproduced. Merged cells show only their top-left value.",
      "Sheets above the row or column limits are refused with a message; nothing is cut off silently. Converting to Word is not offered, because turning cells into a document table has no single correct meaning.",
    ],
  },
  {
    id: "pdf",
    label: "PDF (with text)",
    extensions: ["pdf"],
    mimeTypes: ["application/pdf"],
    maxBytes: 30 * MB,
    outputs: ["docx"],
    fidelity: { pdf: undefined, docx: "experimental" },
    binary: true,
    summary: "Experimental and approximate. Paragraphs, headings, lists and aligned tables are rebuilt from the PDF's text into an editable Word file.",
    notes: [
      "Only PDFs that contain selectable text. Scanned PDFs are refused: they need OCR, which FileForge does not include.",
      "Page layout, columns, fonts and pictures are not kept. Repeated headers, footers and page numbers are removed.",
      "Password-protected PDFs can't be opened. FileForge never removes protection.",
    ],
  },
];

/** Conversions that are deliberately not offered, with the reason. Shown on the Formats page. */
export const UNAVAILABLE_PATHWAYS: { from: string; to: string; reason: string }[] = [
  { from: "Scanned PDF", to: "Word", reason: "Needs OCR. A browser-only OCR engine would add several megabytes of model data, still read tables and layout poorly, and a scanned page that is not recognised would produce a misleading empty or wrong document." },
  { from: "Excel", to: "Word", reason: "A spreadsheet has no single correct document form (which sheet, which range, how wide). Convert to PDF, or export the cells you need as CSV." },
  { from: "PowerPoint", to: "PDF", reason: "Faithful slide rendering needs layout inheritance, charts, SmartArt, embedded fonts and effects that cannot be reproduced locally. A text-only outline would be misleading, so no half measure is offered." },
  { from: "PowerPoint", to: "Word", reason: "Slides have no faithful document equivalent." },
  { from: "EPUB", to: "PDF / Word", reason: "Not investigated: reflowable content with embedded styling needs a layout engine that is out of scope for this release." },
];

export interface ProcessingLimits {
  pdfMaxPages: number;
  csvMaxRows: number;
  csvMaxCols: number;
  htmlMaxNodes: number;
  imageMaxMegapixels: number;
}

export const PROCESSING_LIMITS: Record<Processing, ProcessingLimits> = {
  balanced: { pdfMaxPages: 300, csvMaxRows: 20000, csvMaxCols: 40, htmlMaxNodes: 100000, imageMaxMegapixels: 25 },
  conservative: { pdfMaxPages: 100, csvMaxRows: 5000, csvMaxCols: 30, htmlMaxNodes: 30000, imageMaxMegapixels: 12 },
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
