// @vitest-environment jsdom
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inspectFile, runConversion, type Inspection } from "@/engine/convert";
import { buildFromPlan } from "@/engine/pdf-tools/ops";
import type { Block, ParseOptions } from "@/engine/types";
import { DEFAULT_PARSE_OPTIONS } from "@/engine/style";
import { defaultSettings, extractPdf, pythonDocx } from "./helpers";
import { bagRecall, corpusBytes, corpusFile, corpusText, orderedRecall, pdfPageCount, pdfWords, words } from "./corpus-metrics";

/**
 * Fidelity criteria for the Phase 4 pathways, measured against independent references:
 *   text   word recall >= 0.99 (every word of the reference appears in the output)
 *   order  in-order word recall >= 0.95
 *   pages  DOCX to PDF page count within 0.7x to 1.6x of LibreOffice's rendering of the same file
 *   safety malformed, protected, scanned and hostile files fail with a specific message, never a crash or hang
 * A pathway may be labeled "Supported" only if every criterion holds on every corpus file of that kind AND no content
 * category (charts, comments, footnotes, text boxes...) is silently dropped. Until then it stays "Experimental".
 */
const TEXT_MIN = 0.99;
const ORDER_MIN = 0.95;
const evidence: Record<string, unknown>[] = [];

const insp = (n: string, opts: Partial<ParseOptions> = {}, processing: "balanced" | "conservative" = "balanced") => inspectFile(corpusFile(n), processing, undefined, { ...DEFAULT_PARSE_OPTIONS, ...opts });
async function convert(i: Inspection, output: "pdf" | "docx") {
  const settings = { ...defaultSettings, ...i.suggested?.page, style: i.suggested?.style } as typeof defaultSettings;
  const t0 = performance.now();
  const out = await runConversion(i, { output, settings, suffix: "" });
  return { out, bytes: new Uint8Array(await out.blob.arrayBuffer()), ms: Math.round(performance.now() - t0) };
}
const blocksOf = (i: Inspection): Block[] => i.doc!.blocks;
const count = (blocks: Block[], type: Block["type"]): number => blocks.reduce((n, b) => n + (b.type === type ? 1 : 0) + (b.type === "quote" ? count(b.blocks, type) : 0), 0);
const listItems = (blocks: Block[]): number => blocks.reduce((n, b) => n + (b.type === "list" ? b.items.reduce((m, it) => m + 1 + (it.children ? listItems(it.children) : 0), 0) : 0), 0);
const failure = async (n: string): Promise<{ code: string; message: string }> => {
  try {
    await insp(n);
  } catch (e) {
    return { code: (e as { code?: string }).code ?? "none", message: (e as Error).message };
  }
  throw new Error(`${n} should have been refused`);
};

afterAll(() => {
  if (process.env.CORPUS_REPORT) {
    mkdirSync(path.dirname(process.env.CORPUS_REPORT), { recursive: true });
    writeFileSync(process.env.CORPUS_REPORT, JSON.stringify(evidence, null, 2) + "\n");
  }
});

describe("DOCX to PDF", () => {
  it.each(["docx-simple", "docx-complex", "docx-long"])("%s: text, order, structure and page count against references", async (n) => {
    const i = await insp(`${n}.docx`);
    const { out, bytes, ms } = await convert(i, "pdf");
    const ref = words(corpusText(`${n}.ref.txt`));
    const got = await pdfWords(bytes);
    const refPages = await pdfPageCount(corpusBytes(`${n}.ref.pdf`));
    const bag = bagRecall(ref, got.words);
    const ord = orderedRecall(ref, got.words);
    evidence.push({ pathway: "docx-pdf", file: `${n}.docx`, bagRecall: +bag.toFixed(4), orderedRecall: +ord.toFixed(4), pages: got.pages, referencePages: refPages, pageRatio: +(got.pages / refPages).toFixed(2), ms, warnings: i.warnings.map((w) => w.code) });
    expect(bag).toBeGreaterThanOrEqual(n === "docx-complex" ? 0.97 : TEXT_MIN); // complex: text-box order differs and VML text sits after its paragraph
    expect(ord).toBeGreaterThanOrEqual(n === "docx-complex" ? 0.95 : ORDER_MIN);
    expect(got.pages / refPages).toBeGreaterThanOrEqual(0.7);
    expect(got.pages / refPages).toBeLessThanOrEqual(1.6);
    expect(out.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([]);
    expect(out.fidelity).toBe("experimental");
  });

  it("keeps headings, lists, tables, links and images that python-docx sees", async () => {
    const i = await insp("docx-simple.docx");
    const j = await pythonDocx(corpusBytes("docx-simple.docx"));
    expect(count(blocksOf(i), "heading")).toBe(j.paras.filter((p: { style: string }) => p.style.startsWith("Heading")).length);
    expect(listItems(blocksOf(i))).toBe(j.paras.filter((p: { style: string }) => p.style.startsWith("List")).length);
    expect(count(blocksOf(i), "table")).toBe(j.tables.length);
    const runs = JSON.stringify(blocksOf(i));
    expect(runs).toContain('"link":"https://example.com/"');
    expect(runs).toContain('"underline":true');
    expect(runs).toContain('"color":"#c00000"');
    expect(i.doc!.meta).toMatchObject({ title: "Simple Report", author: "Corpus Author" });
    const c = await insp("docx-complex.docx");
    expect(count(blocksOf(c), "image")).toBe(2);
    expect(blocksOf(c).some((b) => b.type === "pagebreak")).toBe(true);
    expect(listItems(blocksOf(c))).toBe(6);
  });

  it("reads page setup, font, line spacing, header and footer as editable suggestions", async () => {
    const c = await insp("docx-complex.docx");
    expect(c.suggested?.style).toMatchObject({ fontFamily: "serif", fontSize: 12, headerText: "Complex Document Header", pageNumbers: "n" });
    expect(c.suggested?.style?.footerText).toBe("Confidential - page"); // the cached page number is a field result, not text
    expect(c.suggested?.page).toMatchObject({ pageSize: "LETTER", orientation: "landscape" });
    const s = await insp("docx-simple.docx");
    expect(s.suggested?.page).toMatchObject({ pageSize: "LETTER", orientation: "portrait", margins: "wide" }); // python-docx template: 1.25 in side margins
  });

  it("reports every category it cannot carry over", async () => {
    const c = await insp("docx-complex.docx");
    const codes = c.warnings.map((w) => w.code);
    for (const code of ["experimental", "tracked-changes", "textboxes", "merged-cells", "nested-tables", "sections", "images-embedded", "header-footer"]) expect(codes).toContain(code);
    expect(c.warnings.find((w) => w.code === "tracked-changes")!.message).toMatch(/1 insertion accepted, 1 deletion removed/);
    const text = JSON.stringify(blocksOf(c));
    expect(text).toContain("inserted text");
    expect(text).not.toContain("deleted text");
    expect(text).toContain("Text inside the box");
  });

  it("Unicode: Latin, Cyrillic (Macedonian) and Greek survive; unsupported scripts are reported, not hidden", async () => {
    const i = await insp("docx-unicode.docx");
    const { out, bytes } = await convert(i, "pdf");
    const text = (await extractPdf(bytes)).pages.join(" ");
    for (const w of ["Скопје", "ќе", "ѓубре", "Αθήνα", "Łódź", "café"]) expect(text).toContain(w);
    expect(out.checks.some((c) => c.id === "glyphs" && !c.passed)).toBe(true);
  });

  it.each([
    ["docx-notzip.docx", "bad-signature"],
    ["docx-truncated.docx", "corrupt-zip"],
    ["docx-nodocument.docx", "not-docx"],
    ["docx-badxml.docx", "corrupt-docx"],
    ["docx-bomb.docx", "zip-too-large"],
  ])("refuses %s with %s", async (n, code) => {
    const t0 = performance.now();
    const f = await failure(n);
    expect(f.code).toBe(code);
    expect(f.message.length).toBeGreaterThan(30);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe("XLSX to PDF", () => {
  const tok = (t: string) => t.split(/\s+/).filter(Boolean);
  // LibreOffice prints "###" where its own column is too narrow; charts are drawn, not text. Neither is a cell value.
  const ARTIFACT = /^(###|0|500|1500|2000|2500|3500|4500)$/;

  it.each([
    ["xlsx-simple", {}],
    ["xlsx-multi", { xlsxSheet: "all" as const }],
    ["xlsx-wide", {}],
    ["xlsx-unicode", {}],
  ])("%s: every printed value matches LibreOffice's rendering, including number and date formats", async (n, opts) => {
    const i = await insp(`${n}.xlsx`, opts);
    const { out, bytes, ms } = await convert(i, "pdf");
    const got = tok((await extractPdf(bytes)).pages.join(" "));
    const ref = tok((await extractPdf(corpusBytes(`${n}.ref.pdf`))).pages.join(" ")).filter((t) => !(n === "xlsx-multi" ? ARTIFACT.test(t) : t === "###"));
    // Presence recall: a chart drawn by LibreOffice repeats category labels, which inflates reference counts.
    const have = new Set(got);
    const bag = ref.length ? ref.filter((t) => have.has(t)).length / ref.length : 1;
    evidence.push({ pathway: "xlsx-pdf", file: `${n}.xlsx`, tokenRecall: +bag.toFixed(4), pages: out.pageCount, ms, warnings: i.warnings.map((w) => w.code) });
    expect(bag).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(out.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([]);
  });

  it("formats numbers, percentages, currency and dates as Excel shows them", async () => {
    const i = await insp("xlsx-simple.xlsx");
    const text = JSON.stringify(blocksOf(i));
    for (const v of ["2024-01-15", "1,234.50", "1.0%", "$96,291.00"]) expect(text).toContain(v);
  });

  it("sheet selection, all sheets, print area, hidden sheets and rows, header option", async () => {
    const first = await insp("xlsx-multi.xlsx");
    expect(first.workbook!.sheets.map((s) => s.name)).toEqual(["Overview", "Detail"]);
    expect(first.workbook!.hiddenSheets).toBe(1);
    expect(first.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["other-sheets", "hidden-sheets", "merged-cells", "hidden-rows", "charts", "formulas"]));
    expect(JSON.stringify(blocksOf(first))).not.toContain("Q2"); // hidden row left out and reported
    expect(JSON.stringify(blocksOf(first))).not.toContain("secret");

    const detail = await insp("xlsx-multi.xlsx", { xlsxSheet: 1 });
    const t = blocksOf(detail).find((b) => b.type === "table") as Extract<Block, { type: "table" }>;
    expect(t.header).toHaveLength(3); // print area A1:C10
    expect(t.rows).toHaveLength(9);
    expect(detail.warnings.map((w) => w.code)).toContain("print-area");
    const noPrint = await insp("xlsx-multi.xlsx", { xlsxSheet: 1, xlsxPrintArea: false });
    const t2 = blocksOf(noPrint).find((b) => b.type === "table") as Extract<Block, { type: "table" }>;
    expect(t2.header).toHaveLength(4);
    expect(t2.rows).toHaveLength(30);

    const all = await insp("xlsx-multi.xlsx", { xlsxSheet: "all" });
    expect(count(blocksOf(all), "table")).toBe(2);
    expect(count(blocksOf(all), "pagebreak")).toBe(1);
    expect(count(blocksOf(all), "heading")).toBe(2);

    const nohead = await insp("xlsx-simple.xlsx", { csvHeader: "none" });
    expect((blocksOf(nohead)[0] as Extract<Block, { type: "table" }>).header).toBeNull();
  });

  it("formulas show cached results; formulas without a saved result are reported", async () => {
    const i = await insp("xlsx-simple.xlsx");
    expect(JSON.stringify(blocksOf(i))).toContain("$96,291.00");
    const n = await insp("xlsx-formula-nocache.xlsx");
    expect(n.warnings.map((w) => w.code)).toContain("formula-no-cache");
  });

  it("handles 5,000 rows without losing any, and a wide sheet keeps all columns", async () => {
    const long = await insp("xlsx-long.xlsx");
    const t = blocksOf(long)[0] as Extract<Block, { type: "table" }>;
    expect(t.rows).toHaveLength(5000);
    const { bytes, ms } = await convert(long, "pdf");
    const pages = await extractPdf(bytes);
    expect(pages.pages.join(" ")).toContain("Customer 5000");
    evidence.push({ pathway: "xlsx-pdf", file: "xlsx-long.xlsx (5,000 rows)", pages: pages.numPages, ms });
    const wide = await insp("xlsx-wide.xlsx");
    expect((blocksOf(wide)[0] as Extract<Block, { type: "table" }>).header).toHaveLength(30);
    expect(wide.suggested?.page?.orientation).toBe("landscape");
  }, 120000);

  it.each([
    ["xlsx-too-wide.xlsx", "xlsx-too-wide"],
    ["xlsx-notzip.xlsx", "bad-signature"],
    ["xlsx-truncated.xlsx", "corrupt-zip"],
    ["xlsx-bomb.xlsx", "zip-too-large"],
  ])("refuses %s with %s", async (n, code) => {
    const f = await failure(n);
    expect(f.code).toBe(code);
  });

  it("conservative mode refuses what balanced allows, with the limit stated", async () => {
    await expect(insp("xlsx-long.xlsx", {}, "conservative")).rejects.toThrow(/row limit|rows in its used range/);
  });
});

describe("PDF to DOCX", () => {
  // pdftotext orders table cells by column and columns by coordinates, so for the LibreOffice export (made from docx-complex)
  // the true reference order is the Word source itself.
  // A floating text box has no position in reading order: LibreOffice prints it above its anchor paragraph, so those words are excluded here.
  const cleanRef = (n: string, extra: RegExp[] = [/^\d+\.$/, /text box|Text inside the box/]) =>
    corpusText(n === "pdf-from-libreoffice" ? "docx-complex.ref.txt" : `${n}.ref.txt`)
      .split("\n")
      .map((l) => l.replace(/^\d+\.\s+/, "")) // numbered-list markers become list numbering, not words
      .filter((l) => ![/^Page \d+$/, /^Corpus running header$/, /^Complex Document Header$/, /^Confidential - page \d*$/, ...extra].some((r) => r.test(l.trim())))
      .join(" ");
  const docxWords = (j: Awaited<ReturnType<typeof pythonDocx>>) => words((j.body as string[]).join(" ")); // document order, tables in place

  it.each(["pdf-text-simple", "pdf-two-column", "pdf-long", "pdf-from-libreoffice"])("%s: text and reading order against pdftotext / source order", async (n) => {
    const i = await insp(`${n}.pdf`);
    const { out, bytes, ms } = await convert(i, "docx");
    const j = await pythonDocx(bytes);
    const got = docxWords(j);
    const ref = words(cleanRef(n));
    const bag = bagRecall(ref, got);
    const ord = orderedRecall(ref, got);
    evidence.push({ pathway: "pdf-docx", file: `${n}.pdf`, bagRecall: +bag.toFixed(4), orderedRecall: +ord.toFixed(4), headings: j.paras.filter((p: { style: string }) => p.style.startsWith("Heading")).length, tables: j.tables.length, ms, warnings: i.warnings.map((w) => w.code) });
    expect(bag).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(ord).toBeGreaterThanOrEqual(n === "pdf-text-simple" ? 0.97 : ORDER_MIN);
    expect(out.checks.filter((c) => !c.passed).map((c) => c.label)).toEqual([]);
    expect(out.fidelity).toBe("experimental");
  }, 120000);

  it("rebuilds headings, a bullet list and a 5x3 table from a generated report", async () => {
    const i = await insp("pdf-text-simple.pdf");
    const blocks = blocksOf(i);
    expect(blocks.filter((b) => b.type === "heading").map((b) => (b as Extract<Block, { type: "heading" }>).runs.map((r) => r.text).join(""))).toEqual(["Quarterly Overview", "Key points", "Results", "Conclusion", "Appendix"]);
    const list = blocks.find((b) => b.type === "list") as Extract<Block, { type: "list" }>;
    expect(list.items).toHaveLength(3);
    expect(list.items[1]!.runs.map((r) => r.text).join("")).toMatch(/^Second bullet point that is long enough to wrap onto a second line/);
    const table = blocks.find((b) => b.type === "table") as Extract<Block, { type: "table" }>;
    expect(table.header!.map((c) => c.map((r) => r.text).join(""))).toEqual(["Region", "Units", "Revenue"]);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[3]!.map((c) => c.map((r) => r.text).join(""))).toEqual(["West", "77", "2,310.00"]);
    expect(JSON.stringify(blocks)).toContain('"bold":true');
    expect(JSON.stringify(blocks)).toContain('"italic":true');
  });

  it("removes repeated headers, footers and page numbers and says so; hyphenated words are rejoined", async () => {
    const i = await insp("pdf-text-simple.pdf");
    expect(JSON.stringify(blocksOf(i))).not.toContain("Corpus running header");
    expect(i.warnings.find((w) => w.code === "headers-removed")!.message).toMatch(/Corpus running header/);
  });

  it("two columns are read column by column and reported", async () => {
    const i = await insp("pdf-two-column.pdf");
    expect(i.warnings.map((w) => w.code)).toContain("columns");
  });

  it("keeps hyperlinks", async () => {
    const i = await insp("pdf-links.pdf");
    expect(JSON.stringify(blocksOf(i))).toContain('"link":"https://example.com/"');
    const { bytes } = await convert(i, "docx");
    expect((await pythonDocx(bytes)).paras.some((p: { links: number }) => p.links === 1)).toBe(true);
  });

  it("LibreOffice export: images are counted, alignment and bold headings come through", async () => {
    const i = await insp("pdf-from-libreoffice.pdf");
    expect(i.warnings.find((w) => w.code === "images")!.message).toMatch(/2 pictures/);
    const blocks = blocksOf(i);
    expect(blocks.some((b) => b.type === "paragraph" && b.align === "center")).toBe(true);
    expect(blocks.some((b) => b.type === "paragraph" && b.align === "right")).toBe(true);
    expect(blocks.filter((b) => b.type === "heading").length).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ["pdf-scanned.pdf", "pdf-scanned", /OCR/],
    ["pdf-encrypted.pdf", "pdf-encrypted", /password/i],
    ["pdf-truncated.pdf", "pdf-invalid", /damaged/],
    ["pdf-notpdf.pdf", "bad-signature", /PDF header/],
  ])("refuses %s with a specific message", async (n, code, re) => {
    const f = await failure(n);
    expect(f.code).toBe(code);
    expect(f.message).toMatch(re);
  });

  it("enforces page limits per processing mode", async () => {
    const ok = await insp("pdf-long.pdf");
    expect(ok.doc!.charCount).toBeGreaterThan(50000);
    // Books: 360 pages is fine in balanced mode and refused in conservative mode (300); 1,080 pages is refused in both.
    const longBytes = new Uint8Array(corpusBytes("pdf-long.pdf"));
    const make = async (copies: number) => {
      const plan = Array.from({ length: copies }, () => Array.from({ length: 120 }, (_, i) => ({ file: 0, page: i, rotate: 0 }))).flat();
      const { bytes } = await buildFromPlan([longBytes], plan);
      return new File([bytes as BlobPart], `book-${copies * 120}.pdf`, { type: "application/pdf" });
    };
    const p360 = await make(3);
    await expect(inspectFile(p360, "conservative")).rejects.toThrow(/360 pages.*300-page limit/);
    await expect(inspectFile(p360, "balanced")).resolves.toMatchObject({ kind: "pdf" });
    await expect(inspectFile(await make(9), "balanced")).rejects.toThrow(/1,080 pages.*1,000-page limit/);
  }, 300000);

  it("can be cancelled while parsing", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(inspectFile(corpusFile("pdf-long.pdf"), "balanced", undefined, DEFAULT_PARSE_OPTIONS, ac.signal)).rejects.toThrow(/Cancelled/);
  });
});

describe("PowerPoint feasibility (prototype only; the app does not accept .pptx)", () => {
  it("naive text extraction recovers words but not slides: layout, charts, pictures and tables are outside what can be reproduced", async () => {
    const { OfficeZip } = await import("@/engine/parsers/zip-safe");
    const rows: Record<string, unknown>[] = [];
    for (const n of ["pptx-simple", "pptx-complex"]) {
      const zip = OfficeZip.open(corpusBytes(`${n}.pptx`), (p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
      const slides = zip.names.sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1])).map((p) => zip.text(p)!);
      const text = slides.flatMap((x) => [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]!)).join(" ");
      const ref = words(corpusText(`${n}.ref.txt`));
      const all = slides.join("\n");
      const placeholders = (all.match(/<p:ph\b/g) ?? []).length;
      const withoutXfrm = slides.reduce((c, x) => c + [...x.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].filter((m) => /<p:ph\b/.test(m[0]) && !/<a:xfrm/.test(m[0])).length, 0);
      rows.push({
        file: `${n}.pptx`,
        wordRecall: +bagRecall(ref, words(text)).toFixed(3),
        slides: slides.length,
        placeholders,
        placeholdersWithoutOwnPosition: withoutXfrm,
        charts: (all.match(/drawingml\/2006\/chart/g) ?? []).length,
        pictures: (all.match(/<p:pic>/g) ?? []).length,
        tables: (all.match(/<a:tbl>/g) ?? []).length,
      });
    }
    evidence.push({ pathway: "pptx-feasibility", rows });
    // Text is recoverable, but every title/body placeholder takes its position from the slide layout and master:
    // a faithful render needs that inheritance plus charts, pictures and tables. Those are the reasons PPTX stays unavailable.
    expect((rows[0] as { wordRecall: number }).wordRecall).toBe(1);
    expect((rows[0] as { placeholdersWithoutOwnPosition: number }).placeholdersWithoutOwnPosition).toBeGreaterThan(0);
    expect((rows[1] as { charts: number }).charts).toBeGreaterThan(0);
  });
});
