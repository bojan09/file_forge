import { DEFAULT_PARSE_OPTIONS } from "../style";
import { PROCESSING_LIMITS } from "../registry";
import { FileForgeError, type Block, type ConversionWarning, type Inline, type ParseOptions, type Processing } from "../types";
import type { ParsedBinary, SheetInfo } from "./binary";
import { finalizeDoc, stripControl, warn } from "./common";
import { OfficeZip, decodeXml, parseRels, resolveTarget } from "./zip-safe";
import { builtinFormat, formatNumber } from "./xlsx-format";

/** Cells scanned per workbook. A sheet beyond this is refused instead of exhausting memory. */
const MAX_CELLS = 1_500_000;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]!] = decodeXml(m[2]!);
  return out;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colLetters(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

function parseRange(ref: string): CellRange | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(ref.trim());
  if (!m) return null;
  const c1 = colIndex(m[1]!);
  const r1 = Number(m[2]) - 1;
  return { r1, c1, r2: m[4] ? Number(m[4]) - 1 : r1, c2: m[3] ? colIndex(m[3]) : c1 };
}

interface SheetDef {
  name: string;
  rid: string;
  state: string;
  path: string;
  visibleIndex: number;
}

interface ScanResult {
  /** Non-empty cells keyed by row, then column. */
  rows: Map<number, Map<number, string>>;
  colWidths: Map<number, number>;
  hiddenCols: Set<number>;
  hiddenRows: number;
  formulas: number;
  noCache: number;
  merges: number;
  conditional: boolean;
  unsupportedFormats: number;
  cells: number;
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    const body = (m[1] ?? "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    let text = "";
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += t[1]!;
    out.push(decodeXml(text));
  }
  return out;
}

function readStyles(xml: string | undefined): { xfFormat: (string | undefined)[] } {
  const custom = new Map<number, string>();
  const xfFormat: (string | undefined)[] = [];
  if (!xml) return { xfFormat };
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]!);
    if (a.numFmtId && a.formatCode !== undefined) custom.set(Number(a.numFmtId), a.formatCode);
  }
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  for (const m of block.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(attrs(m[1]!).numFmtId ?? 0);
    xfFormat.push(custom.get(id) ?? builtinFormat(id));
  }
  return { xfFormat };
}

function scanSheet(xml: string, shared: string[], xfFormat: (string | undefined)[], date1904: boolean, budget: { cells: number }): ScanResult {
  const res: ScanResult = { rows: new Map(), colWidths: new Map(), hiddenCols: new Set(), hiddenRows: 0, formulas: 0, noCache: 0, merges: 0, conditional: false, unsupportedFormats: 0, cells: 0 };
  for (const m of xml.matchAll(/<col\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]!);
    const min = Number(a.min) - 1;
    const max = Math.min(Number(a.max) - 1, min + 200);
    for (let c = min; c <= max; c++) {
      if (a.width) res.colWidths.set(c, Number(a.width));
      if (a.hidden === "1" || a.hidden === "true") res.hiddenCols.add(c);
    }
  }
  res.merges = (xml.match(/<mergeCell\b/g) ?? []).length;
  res.conditional = /<conditionalFormatting\b/.test(xml);
  const dataStart = xml.indexOf("<sheetData");
  const dataEnd = xml.indexOf("</sheetData>");
  if (dataStart < 0) return res;
  const data = xml.slice(dataStart, dataEnd < 0 ? undefined : dataEnd);
  let rowCounter = -1;
  for (const rm of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1]!);
    rowCounter = ra.r ? Number(ra.r) - 1 : rowCounter + 1;
    if (ra.hidden === "1" || ra.hidden === "true") {
      res.hiddenRows++;
      continue;
    }
    const body = rm[2];
    if (!body) continue;
    let colCounter = -1;
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1]!);
      const ref = ca.r ? /^([A-Za-z]+)/.exec(ca.r) : null;
      colCounter = ref ? colIndex(ref[1]!) : colCounter + 1;
      if (++budget.cells > MAX_CELLS) throw new FileForgeError("xlsx-too-large", "This workbook has more cells than can be processed safely in the browser. Export the sheet you need as CSV or split the workbook.");
      const inner = cm[2] ?? "";
      const hasF = /<f\b/.test(inner);
      if (hasF) res.formulas++;
      const rawV = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const v = rawV === "" ? undefined : rawV;
      let text = "";
      const type = ca.t ?? "n";
      if (type === "inlineStr") {
        for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(t[1]!);
      } else if (v === undefined) {
        if (hasF) res.noCache++;
      } else if (type === "s") text = shared[Number(v)] ?? "";
      else if (type === "str" || type === "e" || type === "d") text = decodeXml(v);
      else if (type === "b") text = v === "1" ? "TRUE" : "FALSE";
      else {
        const n = Number(decodeXml(v));
        if (Number.isFinite(n)) {
          const f = formatNumber(n, xfFormat[Number(ca.s ?? 0)], date1904);
          if (f.unsupported) res.unsupportedFormats++;
          text = f.text;
        } else text = decodeXml(v);
      }
      text = stripControl(text.replace(/\r\n?/g, "\n"));
      if (!text) continue;
      let row = res.rows.get(rowCounter);
      if (!row) res.rows.set(rowCounter, (row = new Map()));
      row.set(colCounter, text);
      res.cells++;
    }
  }
  return res;
}

function sheetDimension(xml: string): { rows: number; cols: number } {
  const ref = /<dimension\b[^>]*\bref="([^"]+)"/.exec(xml)?.[1];
  const r = ref ? parseRange(ref) : null;
  return r ? { rows: r.r2 - r.r1 + 1, cols: r.c2 - r.c1 + 1 } : { rows: 0, cols: 0 };
}

export interface XlsxPlan {
  sheets: SheetDef[];
  hidden: number;
}

export function parseXlsx(bytes: Uint8Array, processing: Processing, options: Pick<ParseOptions, "xlsxSheet" | "xlsxPrintArea" | "csvHeader"> = DEFAULT_PARSE_OPTIONS): ParsedBinary {
  const zip = OfficeZip.open(bytes, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || n === "xl/styles.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const wbXml = zip.text("xl/workbook.xml");
  if (!wbXml) throw new FileForgeError("not-xlsx", "This ZIP file isn't an Excel workbook: xl/workbook.xml is missing.");
  const rels = parseRels(zip.text("xl/_rels/workbook.xml.rels"));
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(wbXml);

  const defs: SheetDef[] = [];
  let visible = 0;
  let hiddenSheets = 0;
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]!);
    const rid = a["r:id"] ?? "";
    const rel = rels.find((r) => r.id === rid);
    if (!a.name || !rel) continue;
    const state = a.state ?? "visible";
    if (state !== "visible") hiddenSheets++;
    defs.push({ name: a.name, rid, state, path: resolveTarget("xl/workbook.xml", rel.target), visibleIndex: state === "visible" ? visible++ : -1 });
  }
  const visibleDefs = defs.filter((d) => d.state === "visible" && zip.has(d.path));
  if (!visibleDefs.length) throw new FileForgeError("no-content", "This workbook has no visible worksheets to convert.");

  // Print areas: definedName _xlnm.Print_Area with localSheetId = index in the sheet list.
  const printAreas = new Map<number, string>();
  for (const m of wbXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const a = attrs(m[1]!);
    if (a.name === "_xlnm.Print_Area" && a.localSheetId !== undefined) printAreas.set(Number(a.localSheetId), decodeXml(m[2]!));
  }
  const printFor = (d: SheetDef): { area?: CellRange; raw?: string; extra: number } => {
    const raw = printAreas.get(defs.indexOf(d));
    if (!raw) return { extra: 0 };
    const parts = raw.split(",");
    const first = parts[0]!.replace(/^'?[^!]*'?!/, "");
    const range = parseRange(first);
    return { area: range ?? undefined, raw: first.replace(/\$/g, ""), extra: parts.length - 1 };
  };

  const infos: SheetInfo[] = visibleDefs.map((d) => {
    const dim = sheetDimension(zip.text(d.path)?.slice(0, 4000) ?? "");
    return { name: d.name, index: d.visibleIndex, rows: dim.rows, cols: dim.cols, printArea: printFor(d).raw };
  });

  const shared = readSharedStrings(zip.text("xl/sharedStrings.xml"));
  const { xfFormat } = readStyles(zip.text("xl/styles.xml"));
  const limits = PROCESSING_LIMITS[processing];
  const selected = options.xlsxSheet === "all" ? visibleDefs : [visibleDefs[Math.min(Math.max(0, Number(options.xlsxSheet) || 0), visibleDefs.length - 1)]!];

  const blocks: Block[] = [];
  const budget = { cells: 0 };
  const totals = { formulas: 0, noCache: 0, merges: 0, conditional: 0, unsupportedFormats: 0, hiddenRows: 0, hiddenCols: 0, cropped: 0, extraPrint: 0, usedPrint: 0 };
  selected.forEach((d, si) => {
    const xml = zip.text(d.path)!;
    const scan = scanSheet(xml, shared, xfFormat, date1904, budget);
    totals.formulas += scan.formulas;
    totals.noCache += scan.noCache;
    totals.merges += scan.merges;
    totals.conditional += scan.conditional ? 1 : 0;
    totals.unsupportedFormats += scan.unsupportedFormats;
    totals.hiddenRows += scan.hiddenRows;

    // Bounding box of real content.
    let r1 = Infinity;
    let r2 = -1;
    let c1 = Infinity;
    let c2 = -1;
    for (const [r, row] of scan.rows) {
      if (r < r1) r1 = r;
      if (r > r2) r2 = r;
      for (const c of row.keys()) {
        if (scan.hiddenCols.has(c)) continue;
        if (c < c1) c1 = c;
        if (c > c2) c2 = c;
      }
    }
    if (si > 0) blocks.push({ type: "pagebreak" });
    if (selected.length > 1) blocks.push({ type: "heading", level: 2, runs: [{ text: d.name }] });
    if (r2 < 0 || c2 < 0) {
      blocks.push({ type: "paragraph", runs: [{ text: "(This sheet has no data.)", italic: true }] });
      return;
    }
    const pa = options.xlsxPrintArea ? printFor(d) : { extra: 0 };
    if (pa.area) {
      totals.usedPrint++;
      totals.extraPrint += pa.extra;
      r1 = Math.max(Math.min(r1, pa.area.r1), 0);
      const nr1 = pa.area.r1;
      const nr2 = pa.area.r2;
      const nc1 = pa.area.c1;
      const nc2 = pa.area.c2;
      // The print area wins, but never extends beyond the declared range into rows with no content.
      r1 = nr1;
      r2 = Math.min(nr2, Math.max(r2, nr1));
      c1 = nc1;
      c2 = Math.min(nc2, Math.max(c2, nc1));
    }
    const colsList: number[] = [];
    for (let c = c1; c <= c2; c++) {
      if (scan.hiddenCols.has(c)) totals.hiddenCols++;
      else colsList.push(c);
    }
    const rowCount = r2 - r1 + 1;
    if (rowCount > limits.csvMaxRows) {
      throw new FileForgeError("xlsx-too-long", `Sheet "${d.name}" has ${rowCount.toLocaleString()} rows in its used range, above the ${limits.csvMaxRows.toLocaleString()}-row limit${processing === "conservative" ? " for conservative mode (balanced allows 20,000)" : ""}. Set a print area, or split the sheet.`);
    }
    if (colsList.length > limits.csvMaxCols) {
      throw new FileForgeError("xlsx-too-wide", `Sheet "${d.name}" has ${colsList.length} columns, above the ${limits.csvMaxCols}-column limit. A page can't show that many columns legibly. Set a print area covering fewer columns.`);
    }
    const cell = (text: string | undefined): Inline[] => (text ? [{ text }] : []);
    const grid: Inline[][][] = [];
    for (let r = r1; r <= r2; r++) {
      const row = scan.rows.get(r);
      grid.push(colsList.map((c) => cell(row?.get(c))));
    }
    // Skip fully blank rows that Excel would also print as blank space only when they lead the range.
    const useHeader = options.csvHeader === "first" && grid.length > 1;
    const weights = colsList.map((c, i) => {
      const w = scan.colWidths.get(c);
      if (w) return Math.min(Math.max(w, 4), 40);
      let max = 4;
      for (const row of grid.slice(0, 300)) max = Math.max(max, row[i]!.reduce((n, x) => n + x.text.length, 0));
      return Math.min(max, 40);
    });
    blocks.push({ type: "table", header: useHeader ? grid[0]! : null, rows: useHeader ? grid.slice(1) : grid, align: colsList.map(() => "left" as const), widths: weights, autoAlign: true });
    if (r1 > 0 && !pa.area) totals.cropped++;
  });

  const plural = (x: number, w: string) => `${x.toLocaleString()} ${w}${x === 1 ? "" : "s"}`;
  const warnings: ConversionWarning[] = [warn("experimental", "Excel to PDF is experimental. Cell values are shown as formatted in the workbook; the sheet's visual styling (colors, borders, fonts) is not reproduced, and formulas are not recalculated. Review the result.", "info")];
  if (visibleDefs.length > 1 && options.xlsxSheet !== "all") warnings.push(warn("other-sheets", `This workbook has ${visibleDefs.length} visible sheets; only "${selected[0]!.name}" is converted. Pick another sheet, or all sheets, under Advanced options.`, "info"));
  if (hiddenSheets) warnings.push(warn("hidden-sheets", `${plural(hiddenSheets, "hidden sheet")} not converted.`, "info"));
  if (totals.usedPrint) warnings.push(warn("print-area", "The sheet's print area was used. Turn it off under Advanced options to convert the whole used range.", "info"));
  if (totals.extraPrint) warnings.push(warn("print-areas", `${plural(totals.extraPrint, "additional print range")} ignored; only the first range of each sheet is converted.`));
  if (totals.formulas) warnings.push(warn("formulas", `${plural(totals.formulas, "formula")} shown with the last result saved in the file. Nothing is recalculated.`, "info"));
  if (totals.noCache) warnings.push(warn("formula-no-cache", `${plural(totals.noCache, "formula")} had no saved result (the file was written without calculating) and appear${totals.noCache === 1 ? "s" : ""} empty. Open and save the workbook in a spreadsheet app first.`));
  if (totals.merges) warnings.push(warn("merged-cells", `${plural(totals.merges, "merged cell range")}: only the top-left value is shown, in a single cell.`));
  if (totals.hiddenRows || totals.hiddenCols) warnings.push(warn("hidden-rows", `Hidden rows and columns are left out, as when printing (${plural(totals.hiddenRows, "row")}, ${plural(totals.hiddenCols, "column")}).`, "info"));
  if (totals.conditional) warnings.push(warn("conditional-formatting", "Conditional formatting (color scales, icons, highlights) is not reproduced.", "info"));
  if (totals.unsupportedFormats) warnings.push(warn("number-formats", `${plural(totals.unsupportedFormats, "cell")} use a number format that isn't supported (fractions, elapsed time or conditions); they are shown unformatted.`));
  const charts = zip.allNames.filter((n) => /^xl\/charts\/chart[^/]*\.xml$/.test(n)).length;
  const pivots = zip.allNames.filter((n) => /^xl\/pivotTables\//.test(n)).length;
  const media = zip.allNames.filter((n) => /^xl\/media\//.test(n)).length;
  if (charts) warnings.push(warn("charts", `${plural(charts, "chart")} in the workbook can't be reproduced and ${charts === 1 ? "is" : "are"} not included.`));
  if (media) warnings.push(warn("pictures", `${plural(media, "picture")} in the workbook ${media === 1 ? "is" : "are"} not included.`));
  if (pivots) warnings.push(warn("pivots", `${plural(pivots, "pivot table part")} found; pivot tables are shown as their current cell values only.`, "info"));
  if (zip.allNames.includes("xl/vbaProject.bin")) warnings.push(warn("macros", "This file contains macros. They are ignored and never run.", "info"));
  if (date1904) warnings.push(warn("date1904", "This workbook uses the 1904 date system; dates were converted accordingly.", "info"));

  const doc = finalizeDoc(blocks, warnings);
  if (!doc.charCount) throw new FileForgeError("no-content", "The selected sheet contains no data.");
  const wide = blocks.some((b) => b.type === "table" && (b.header?.length ?? b.rows[0]?.length ?? 0) > 7);
  return { doc, suggested: wide ? { page: { orientation: "landscape" } } : undefined, workbook: { sheets: infos, hiddenSheets } };
}
