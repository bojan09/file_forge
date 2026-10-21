import type { Block, MarginName, Orientation, PageSettings, PageSizeName, Inline } from "./types";

/** Portrait sizes in PDF points (1/72 in). */
export const PAGE_POINTS: Record<PageSizeName, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  LETTER: { width: 612, height: 792 },
  LEGAL: { width: 612, height: 1008 },
};

export const MARGIN_POINTS: Record<MarginName, number> = { narrow: 36, normal: 72, wide: 108 };

export function pageDims(settings: Pick<PageSettings, "pageSize" | "margins">, orientation: Orientation) {
  const base = PAGE_POINTS[settings.pageSize];
  const width = orientation === "landscape" ? base.height : base.width;
  const height = orientation === "landscape" ? base.width : base.height;
  const margin = MARGIN_POINTS[settings.margins];
  return { width, height, margin, contentWidth: width - margin * 2, contentHeight: height - margin * 2 };
}

export function textOf(runs: Inline[]): string {
  let s = "";
  for (const r of runs) s += r.text;
  return s;
}

/** Relative column weights for tables, derived from content when the parser gave none. */
export function columnWeights(table: Extract<Block, { type: "table" }>): number[] {
  if (table.widths && table.widths.length) return table.widths;
  const cols = Math.max(table.header?.length ?? 0, ...table.rows.map((r) => r.length), 1);
  const weights: number[] = [];
  const sampleRows = table.rows.slice(0, 300);
  for (let c = 0; c < cols; c++) {
    let max = table.header?.[c] ? textOf(table.header[c]!).length : 0;
    for (const r of sampleRows) max = Math.max(max, r[c] ? textOf(r[c]!).length : 0);
    weights.push(Math.min(Math.max(max, 4), 40));
  }
  return weights;
}

/** Font size in points for a table with the given column count. */
export function tableFontSize(cols: number): number {
  if (cols <= 4) return 10;
  if (cols <= 6) return 9;
  if (cols <= 9) return 8;
  if (cols <= 14) return 7;
  if (cols <= 24) return 6;
  return 5.5;
}

/** Splits weights into absolute widths summing to `total`, enforcing a minimum per column. */
export function absoluteWidths(weights: number[], total: number, min: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let widths = weights.map((w) => (w / sum) * total);
  for (let pass = 0; pass < 3; pass++) {
    const fixed = widths.map((w) => w < min);
    if (!fixed.some(Boolean)) break;
    const fixedTotal = fixed.filter(Boolean).length * min;
    const flexSum = widths.reduce((a, w, i) => a + (fixed[i] ? 0 : w), 0) || 1;
    widths = widths.map((w, i) => (fixed[i] ? min : (w / flexSum) * (total - fixedTotal)));
  }
  return widths;
}
