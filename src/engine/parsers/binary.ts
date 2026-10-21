import type { NormalizedDoc, PageSettings, StyleSettings } from "../types";

/** Result of parsing a binary source (DOCX, XLSX, PDF). `suggested` carries settings read from the source itself. */
export interface ParsedBinary {
  doc: NormalizedDoc;
  suggested?: { page?: Partial<PageSettings>; style?: Partial<StyleSettings> };
  /** Workbook details for the sheet picker (XLSX only). */
  workbook?: WorkbookInfo;
}

export interface SheetInfo {
  name: string;
  /** Index among visible sheets, used by the sheet option. */
  index: number;
  rows: number;
  cols: number;
  printArea?: string;
}

export interface WorkbookInfo {
  sheets: SheetInfo[];
  hiddenSheets: number;
}
