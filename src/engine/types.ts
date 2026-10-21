/** Normalized document model shared by every parser and renderer. */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean;
  /** Text color as "#rrggbb". Only validated colors reach the model. */
  color?: string;
  /** Only http(s) and mailto links survive normalisation. */
  link?: string;
}

export interface ListItem {
  runs: Inline[];
  /** Nested blocks (usually a nested list). */
  children?: Block[];
}

export type Align = "left" | "center" | "right" | "justify";

/** Raster image embedded in a document. Only JPEG and PNG whose bytes were sniffed and measured. */
export interface ImageData {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
  alt?: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Inline[]; align?: Align }
  /** `cont` marks a paragraph continued from the previous block (used when long paragraphs are split for layout). */
  | { type: "paragraph"; runs: Inline[]; cont?: boolean; align?: Align }
  | { type: "pagebreak" }
  | { type: "image"; image: ImageData; align?: Align }
  /** `plain` lists draw no bullet or number of their own (task lists carry their own ○ / ● markers). */
  | { type: "list"; ordered: boolean; items: ListItem[]; plain?: boolean }
  | { type: "code"; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "rule" }
  | { type: "table"; header: Inline[][] | null; rows: Inline[][][]; align?: Align[]; widths?: number[]; /** Alignment of numeric columns may be inferred (CSV and HTML, where the source gives none). */ autoAlign?: boolean };

export type WarningLevel = "info" | "warn";

export interface ConversionWarning {
  code: string;
  level: WarningLevel;
  message: string;
}

export interface DocMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
}

export interface NormalizedDoc {
  title?: string;
  /** Core properties found in the source (HTML meta tags, Markdown front matter). */
  meta?: DocMeta;
  blocks: Block[];
  warnings: ConversionWarning[];
  /** Characters of visible text, used for sanity checks. */
  charCount: number;
  hasTables: boolean;
  hasLists: boolean;
  hasHeadings: boolean;
  imageCount?: number;
}

export type SourceKind = "txt" | "md" | "html" | "csv" | "image";
export type OutputFormat = "pdf" | "docx";
export type Fidelity = "high" | "approximate";

export type PageSizeName = "A4" | "LETTER" | "LEGAL";
export type Orientation = "portrait" | "landscape";
export type MarginName = "narrow" | "normal" | "wide";
export type ImageQuality = "high" | "balanced" | "small";
export type ImageFit = "fit" | "match";
export type Processing = "conservative" | "balanced";

export type FontFamilyName = "sans" | "serif" | "mono";
export type PageNumberStyle = "none" | "n" | "n-of-N" | "page-n-of-N";
export type TableBorders = "grid" | "horizontal" | "none";
export type ColumnSizing = "content" | "equal";
export type NumberAlign = "left" | "auto";

/** Typography and table styling shared by the PDF and DOCX renderers. All fields optional; see resolveStyle. */
export interface StyleSettings {
  fontFamily: FontFamilyName;
  /** Body size in points (9–16). */
  fontSize: number;
  /** Line height multiplier (1–2). */
  lineSpacing: number;
  pageNumbers: PageNumberStyle;
  headerText: string;
  footerText: string;
  tableZebra: boolean;
  tableBorders: TableBorders;
  tableHeaderFill: boolean;
  columnSizing: ColumnSizing;
  numberAlign: NumberAlign;
  /** 0.8–1.4; scales table text. */
  tableFontScale: number;
}

export interface ParseOptions {
  csvDelimiter: "auto" | "," | ";" | "\t" | "|";
  csvHeader: "first" | "none";
  /** "source" keeps Markdown syntax as monospace text instead of formatting it. */
  markdown: "formatted" | "source";
}

export interface PageSettings {
  pageSize: PageSizeName;
  /** "auto" is only meaningful for image PDFs. */
  orientation: Orientation | "auto";
  margins: MarginName;
  imageQuality: ImageQuality;
  imageFit: ImageFit;
  style?: Partial<StyleSettings>;
}

export interface PreparedImage {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

export type RenderJob =
  | { kind: "doc"; doc: NormalizedDoc; output: OutputFormat; settings: PageSettings; title: string }
  | { kind: "image"; image: PreparedImage; settings: PageSettings; title: string }
  | { kind: "images"; images: PreparedImage[]; settings: PageSettings; title: string };

export type Stage = "reading" | "rendering" | "verifying";

export interface QualityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface RenderResult {
  bytes: Uint8Array;
  mime: string;
  extension: "pdf" | "docx";
  pageCount?: number;
  checks: QualityCheck[];
}

export class FileForgeError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "FileForgeError";
    this.code = code;
    this.retryable = retryable;
  }
}
