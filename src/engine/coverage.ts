import { FONT_RANGES } from "./font-coverage";
import { hardenBlocks } from "./layout-safe";
import type { Block, ConversionWarning, Inline, NormalizedDoc } from "./types";

function supported(cp: number): boolean {
  let lo = 0;
  let hi = FONT_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = FONT_RANGES[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Whitespace, tabs and zero-width characters never need a glyph. */
function needsGlyph(cp: number): boolean {
  return !(cp === 0x0a || cp === 0x0d || cp === 0x09 || cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff || cp === 0xad);
}

export interface CoverageReport {
  total: number;
  unsupported: number;
  samples: string[];
}

export function replaceUnsupported(text: string, report?: CoverageReport): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!needsGlyph(cp)) {
      out += ch;
      continue;
    }
    if (report && !/\s/.test(ch)) report.total++;
    if (supported(cp)) out += ch;
    else {
      out += "?";
      if (report) {
        report.unsupported++;
        if (report.samples.length < 6 && !report.samples.includes(ch)) report.samples.push(ch);
      }
    }
  }
  return out;
}

function mapRuns(runs: Inline[], report: CoverageReport): Inline[] {
  return runs.map((r) => ({ ...r, text: replaceUnsupported(r.text, report) }));
}

function mapBlock(b: Block, report: CoverageReport): Block {
  switch (b.type) {
    case "heading":
    case "paragraph":
      return { ...b, runs: mapRuns(b.runs, report) };
    case "code":
      return { ...b, text: replaceUnsupported(b.text, report) };
    case "quote":
      return { ...b, blocks: b.blocks.map((x) => mapBlock(x, report)) };
    case "list":
      return {
        ...b,
        items: b.items.map((it) => ({ runs: mapRuns(it.runs, report), children: it.children?.map((x) => mapBlock(x, report)) })),
      };
    case "table":
      return {
        ...b,
        header: b.header ? b.header.map((c) => mapRuns(c, report)) : null,
        rows: b.rows.map((r) => r.map((c) => mapRuns(c, report))),
      };
    default:
      return b;
  }
}

/** Fraction of visible characters the PDF font cannot draw; above this the PDF is refused. */
export const MAX_UNSUPPORTED_RATIO = 0.3;

/** Counts characters the bundled PDF font lacks without modifying the document. */
export function measureCoverage(doc: NormalizedDoc): CoverageReport {
  const report: CoverageReport = { total: 0, unsupported: 0, samples: [] };
  doc.blocks.forEach((b) => mapBlock(b, report));
  return report;
}

/** Returns a PDF-safe copy of the document plus a warning describing any replacements. */
export function prepareForPdf(doc: NormalizedDoc): { doc: NormalizedDoc; report: CoverageReport; warning?: ConversionWarning } {
  const report: CoverageReport = { total: 0, unsupported: 0, samples: [] };
  const blocks = hardenBlocks(doc.blocks.map((b) => mapBlock(b, report)));
  const warning = report.unsupported
    ? {
        code: "pdf-glyphs",
        level: "warn" as const,
        message: `${report.unsupported.toLocaleString()} character${report.unsupported > 1 ? "s" : ""} (${report.samples.join(" ")}) can't be drawn by the PDF font and are shown as "?". DOCX keeps every character.`,
      }
    : undefined;
  return { doc: { ...doc, blocks }, report, warning };
}
