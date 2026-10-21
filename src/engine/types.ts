/** Normalized document model shared by every parser and renderer. */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Only http(s) and mailto links survive normalisation. */
  link?: string;
}

export interface ListItem {
  runs: Inline[];
  /** Nested blocks (usually a nested list). */
  children?: Block[];
}

export type Align = "left" | "center" | "right";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Inline[] }
  | { type: "paragraph"; runs: Inline[] }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "code"; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "rule" }
  | { type: "table"; header: Inline[][] | null; rows: Inline[][][]; align?: Align[]; widths?: number[] };

export type WarningLevel = "info" | "warn";

export interface ConversionWarning {
  code: string;
  level: WarningLevel;
  message: string;
}

export interface NormalizedDoc {
  title?: string;
  blocks: Block[];
  warnings: ConversionWarning[];
  /** Characters of visible text, used for sanity checks. */
  charCount: number;
  hasTables: boolean;
  hasLists: boolean;
  hasHeadings: boolean;
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

export interface PageSettings {
  pageSize: PageSizeName;
  /** "auto" is only meaningful for image PDFs. */
  orientation: Orientation | "auto";
  margins: MarginName;
  imageQuality: ImageQuality;
  imageFit: ImageFit;
}

export interface PreparedImage {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

export type RenderJob =
  | { kind: "doc"; doc: NormalizedDoc; output: OutputFormat; settings: PageSettings; title: string }
  | { kind: "image"; image: PreparedImage; settings: PageSettings; title: string };

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
