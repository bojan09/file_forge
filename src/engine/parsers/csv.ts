import Papa from "papaparse";
import { PROCESSING_LIMITS } from "../registry";
import { DEFAULT_PARSE_OPTIONS } from "../style";
import { FileForgeError, type ConversionWarning, type Inline, type NormalizedDoc, type ParseOptions, type Processing } from "../types";
import { finalizeDoc, stripControl, warn } from "./common";

const cell = (s: string): Inline[] => {
  const text = stripControl(s.replace(/\r\n?/g, "\n"));
  return text ? [{ text }] : [];
};

const DELIMITER_NAMES: Record<string, string> = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };

export function parseCsv(text: string, processing: Processing, options: Pick<ParseOptions, "csvDelimiter" | "csvHeader"> = DEFAULT_PARSE_OPTIONS): NormalizedDoc {
  const limits = PROCESSING_LIMITS[processing];
  // Delimiter detection ignores blank lines (they would skew the field counts it compares).
  const detected = options.csvDelimiter === "auto" ? Papa.parse<string[]>(text, { skipEmptyLines: "greedy", preview: 50 }).meta.delimiter : options.csvDelimiter;
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: detected || "," });
  // Only completely blank lines are separators. Rows such as ",,," are real rows (all cells empty) and are kept.
  const all = res.data.filter((r) => Array.isArray(r));
  let end = all.length;
  while (end > 0 && all[end - 1]!.length === 1 && all[end - 1]![0] === "") end--;
  const trimmed = all.slice(0, end);
  const data = trimmed.filter((r) => !(r.length === 1 && r[0] === ""));
  const blankLines = trimmed.length - data.length;
  if (!data.length) throw new FileForgeError("no-content", "This CSV file contains no rows.");
  if (data.length > limits.csvMaxRows) {
    throw new FileForgeError(
      "csv-too-long",
      `This CSV has ${data.length.toLocaleString()} rows, above the ${limits.csvMaxRows.toLocaleString()}-row limit${processing === "conservative" ? " for conservative mode (balanced allows 20,000)" : ""}. Split the file and convert the parts.`,
    );
  }
  const cols = Math.max(...data.map((r) => r.length));
  if (cols > limits.csvMaxCols) {
    throw new FileForgeError("csv-too-wide", `This CSV has ${cols} columns, above the ${limits.csvMaxCols}-column limit. A page can't show that many columns legibly.`);
  }

  const delimiter = res.meta.delimiter ?? ",";
  const warnings: ConversionWarning[] = [
    warn("approximate", "CSV tables are approximate. Values are shown exactly as written; no number or date formatting is applied.", "info"),
    warn("csv-delimiter", `${options.csvDelimiter === "auto" ? "Detected" : "Using"} ${DELIMITER_NAMES[delimiter] ?? `"${delimiter}"`} as the delimiter, ${cols} column${cols === 1 ? "" : "s"}, ${data.length.toLocaleString()} row${data.length === 1 ? "" : "s"}${options.csvHeader === "first" ? " (first row is the header)" : " (no header row)"}.`, "info"),
  ];
  if (blankLines) warnings.push(warn("blank-lines", `${blankLines.toLocaleString()} blank line${blankLines > 1 ? "s" : ""} between rows ${blankLines > 1 ? "were" : "was"} skipped. Rows with empty cells are kept.`, "info"));
  const ragged = data.filter((r) => r.length !== cols).length;
  if (ragged) warnings.push(warn("ragged-rows", `${ragged} row${ragged > 1 ? "s have" : " has"} a different number of columns than the widest row; missing cells are left blank.`));
  if (options.csvDelimiter === "auto" && cols === 1) warnings.push(warn("delimiter", "No delimiter was detected, so the file is shown as a single column."));
  const quoteIssues = res.errors.filter((e) => e.type === "Quotes").length;
  if (quoteIssues) warnings.push(warn("quotes", "Some quoted values are malformed (unbalanced quotes); they were read as best as possible. Check the output."));
  if (cols > 15) warnings.push(warn("wide-table", `${cols} columns is very wide. Text will be small in the PDF; consider DOCX or landscape.`));
  else if (cols > 7) warnings.push(warn("wide-table", `${cols} columns: landscape orientation is recommended for PDF.`, "info"));
  let longCell = false;
  for (const r of data) if (r.some((c) => c.length > 1500)) longCell = true;
  if (longCell) warnings.push(warn("long-cells", "Some cells contain very long text; they will wrap over many lines."));
  if (data.length === 1 && options.csvHeader === "first") warnings.push(warn("header-only", "Only one row was found; it is shown as the table header.", "info"));

  const pad = (r: string[]) => {
    const out = r.map(cell);
    while (out.length < cols) out.push([]);
    return out;
  };
  const useHeader = options.csvHeader === "first";
  const header = useHeader ? pad(data[0]!) : null;
  const rows = (useHeader ? data.slice(1) : data).map(pad);

  const weights: number[] = [];
  for (let c = 0; c < cols; c++) {
    let max = header ? header[c]!.reduce((n, r) => n + r.text.length, 0) : 0;
    const sample = Math.min(rows.length, 500);
    for (let r = 0; r < sample; r++) max = Math.max(max, rows[r]![c]!.reduce((n, x) => n + x.text.length, 0));
    weights.push(Math.min(Math.max(max, 4), 40));
  }
  return finalizeDoc([{ type: "table", header, rows, align: Array(cols).fill("left"), widths: weights, autoAlign: true }], warnings);
}
