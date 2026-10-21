import type { FontFamilyName, NormalizedDoc, ParseOptions, StyleSettings } from "./types";

export const DEFAULT_STYLE: StyleSettings = {
  fontFamily: "sans",
  fontSize: 11,
  lineSpacing: 1.3,
  pageNumbers: "n-of-N",
  headerText: "",
  footerText: "",
  tableZebra: true,
  tableBorders: "grid",
  tableHeaderFill: true,
  columnSizing: "content",
  numberAlign: "auto",
  tableFontScale: 1,
};

export const DEFAULT_PARSE_OPTIONS: ParseOptions = { csvDelimiter: "auto", csvHeader: "first", markdown: "formatted" };

export const FONT_SIZE_RANGE = { min: 9, max: 16 } as const;
export const LINE_SPACING_RANGE = { min: 1, max: 2 } as const;
export const TABLE_SCALE_RANGE = { min: 0.8, max: 1.4 } as const;
export const MAX_HEADER_FOOTER_CHARS = 120;

const FAMILIES: readonly FontFamilyName[] = ["sans", "serif", "mono"];
const NUMBERS = ["none", "n", "n-of-N", "page-n-of-N"] as const;
const BORDERS = ["grid", "horizontal", "none"] as const;
const clamp = (n: unknown, min: number, max: number, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback);
const NO_CONTROL = /[\u0000-\u001f\u007f]+/g;
const text = (v: unknown) => (typeof v === "string" ? v.replace(NO_CONTROL, " ").trim().slice(0, MAX_HEADER_FOOTER_CHARS) : "");

/** Fills defaults and clamps every field, so renderers never see out-of-range or tampered values. */
export function resolveStyle(input?: Partial<StyleSettings> | null): StyleSettings {
  const s = input ?? {};
  const d = DEFAULT_STYLE;
  return {
    fontFamily: FAMILIES.includes(s.fontFamily as FontFamilyName) ? (s.fontFamily as FontFamilyName) : d.fontFamily,
    fontSize: clamp(s.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, d.fontSize),
    lineSpacing: clamp(s.lineSpacing, LINE_SPACING_RANGE.min, LINE_SPACING_RANGE.max, d.lineSpacing),
    pageNumbers: (NUMBERS as readonly unknown[]).includes(s.pageNumbers) ? (s.pageNumbers as StyleSettings["pageNumbers"]) : d.pageNumbers,
    headerText: text(s.headerText),
    footerText: text(s.footerText),
    tableZebra: typeof s.tableZebra === "boolean" ? s.tableZebra : d.tableZebra,
    tableBorders: (BORDERS as readonly unknown[]).includes(s.tableBorders) ? (s.tableBorders as StyleSettings["tableBorders"]) : d.tableBorders,
    tableHeaderFill: typeof s.tableHeaderFill === "boolean" ? s.tableHeaderFill : d.tableHeaderFill,
    columnSizing: s.columnSizing === "equal" ? "equal" : "content",
    numberAlign: s.numberAlign === "left" ? "left" : "auto",
    tableFontScale: clamp(s.tableFontScale, TABLE_SCALE_RANGE.min, TABLE_SCALE_RANGE.max, d.tableFontScale),
  };
}

/** Text for a page-number label; `null` when numbering is off. */
export function pageNumberLabel(style: StyleSettings["pageNumbers"], current: number, total: number): string | null {
  switch (style) {
    case "n":
      return String(current);
    case "n-of-N":
      return `${current} / ${total}`;
    case "page-n-of-N":
      return `Page ${current} of ${total}`;
    default:
      return null;
  }
}

/** Columns in the widest table anywhere at the top level of the document. */
export function widestTable(doc: Pick<NormalizedDoc, "blocks">): number {
  let max = 0;
  for (const b of doc.blocks) if (b.type === "table") max = Math.max(max, b.header?.length ?? b.rows[0]?.length ?? 0);
  return max;
}

/** Wide tables (more than 7 columns) read better in landscape; "auto" picks it. */
export function autoOrientation(doc: Pick<NormalizedDoc, "blocks">): "portrait" | "landscape" {
  return widestTable(doc) > 7 ? "landscape" : "portrait";
}
