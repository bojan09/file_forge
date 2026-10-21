import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { finalizeDoc } from "@/engine/parsers/common";
import { readImageSize } from "@/engine/validate";
import { parseCsv } from "@/engine/parsers/csv";
import { parseMarkdown } from "@/engine/parsers/markdown";
import { runRender } from "@/engine/render";
import type { Block, Inline, NormalizedDoc, PageSettings, StyleSettings } from "@/engine/types";
import { defaultSettings, docxXml, extractPdf, pdfLayout, pythonDocx } from "./helpers";

const png = new Uint8Array(readFileSync(path.resolve(__dirname, "../fixtures/opaque.png")));
const fixtureBytes = (n: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../fixtures", n)));
const jpg = new Uint8Array(readFileSync(path.resolve(__dirname, "../fixtures/photo.jpg")));
const text = (t: string, extra: Partial<Inline> = {}): Inline => ({ text: t, ...extra });
const para = (...runs: Inline[]): Block => ({ type: "paragraph", runs });
const doc = (blocks: Block[], meta?: NormalizedDoc["meta"]) => finalizeDoc(blocks, [], undefined, meta);
const settings = (style: Partial<StyleSettings> = {}, over: Partial<PageSettings> = {}): PageSettings => ({ ...defaultSettings, ...over, style });
const pdf = (d: NormalizedDoc, s: PageSettings = defaultSettings) => runRender({ kind: "doc", doc: d, output: "pdf", settings: s, title: "t" });
const docx = (d: NormalizedDoc, s: PageSettings = defaultSettings) => runRender({ kind: "doc", doc: d, output: "docx", settings: s, title: "t" });
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const A4 = { w: 595.28, h: 841.89 };

function pngSize(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
const img = (alt = "x"): Block => ({ type: "image", image: { bytes: png, mime: "image/png", ...pngSize(png), alt } });

describe("PDF fonts, size and spacing", () => {
  it.each(["sans", "serif", "mono"] as const)("embeds the %s family and keeps text selectable", async (family) => {
    const res = await pdf(doc([para(text("Hello Здраво café world")), para(text("bold", { bold: true }), text(" italic", { italic: true }))]), settings({ fontFamily: family }));
    const { pages } = await extractPdf(res.bytes);
    expect(flat(pages)).toContain("Hello Здраво café world");
    const raw = latin1(res.bytes);
    if (family === "serif") expect(raw).toMatch(/LiberationSerif/);
    if (family === "mono") expect(raw).toMatch(/LiberationMono/);
    if (family === "sans") expect(raw).toMatch(/Roboto/);
    expect(res.checks.every((c) => c.passed)).toBe(true);
  });

  it("applies the body font size", async () => {
    const small = await pdfLayout((await pdf(doc([para(text("Sized text"))]), settings({ fontSize: 9 }))).bytes);
    const big = await pdfLayout((await pdf(doc([para(text("Sized text"))]), settings({ fontSize: 16 }))).bytes);
    expect(small[0]!.items[0]!.height).toBeCloseTo(9, 0);
    expect(big[0]!.items[0]!.height).toBeCloseTo(16, 0);
  });

  it("applies line spacing", async () => {
    const lines = "line one\nline two\nline three";
    const gap = async (ls: number) => {
      const p = (await pdfLayout((await pdf(doc([para(text(lines))]), settings({ lineSpacing: ls }))).bytes))[0]!;
      const ys = p.items.map((i) => i.y).sort((a, b) => b - a);
      return ys[0]! - ys[1]!;
    };
    const tight = await gap(1);
    const loose = await gap(2);
    expect(loose).toBeGreaterThan(tight * 1.6);
  });

  it("uses monospaced faces for code blocks and inline code", async () => {
    const res = await pdf(doc([{ type: "code", text: "const a = 1;" }, para(text("call "), text("run()", { code: true }))]));
    expect(latin1(res.bytes)).toMatch(/LiberationMono/);
    const { pages } = await extractPdf(res.bytes);
    expect(flat(pages)).toContain("const a = 1;");
  });

  it("clamps out-of-range style values instead of failing", async () => {
    const res = await pdf(doc([para(text("ok"))]), settings({ fontSize: 999, lineSpacing: -4, headerText: "x".repeat(500) } as Partial<StyleSettings>));
    const { pages } = await extractPdf(res.bytes);
    expect(pages.join(" ")).toContain("ok");
  });
});

describe("PDF inline formatting, colors and alignment", () => {
  it("draws underline and colors; text stays searchable", async () => {
    const plain = await pdfLayout((await pdf(doc([para(text("Alpha beta"))]))).bytes);
    const styled = await pdfLayout((await pdf(doc([para(text("Alpha ", { underline: true, color: "#c00000" }), text("beta"))]))).bytes);
    expect(styled[0]!.paths).toBeGreaterThan(plain[0]!.paths);
    expect(styled[0]!.fills).toContain("#c00000");
    expect(plain[0]!.fills).not.toContain("#c00000");
    expect(styled[0]!.items.map((i) => i.str).join("")).toContain("Alpha beta");
  });

  it("centers and right-aligns paragraphs and headings", async () => {
    const d = doc([
      { type: "paragraph", runs: [text("Centered line")], align: "center" },
      { type: "paragraph", runs: [text("Right line")], align: "right" },
      { type: "heading", level: 2, runs: [text("Centered heading")], align: "center" },
      { type: "paragraph", runs: [text("Left line")] },
    ]);
    const p = (await pdfLayout((await pdf(d)).bytes))[0]!;
    const find = (s: string) => p.items.find((i) => i.str.includes(s))!;
    const margin = 72;
    expect(find("Left line").x).toBeCloseTo(margin, 0);
    const c = find("Centered line");
    expect(c.x + c.width / 2).toBeCloseTo(A4.w / 2, 0);
    const r = find("Right line");
    expect(r.x + r.width).toBeCloseTo(A4.w - margin, 0);
    const h = find("Centered heading");
    expect(h.x + h.width / 2).toBeCloseTo(A4.w / 2, 0);
  });

  it("justifies when asked", async () => {
    const long = "word ".repeat(80).trim();
    const p = (await pdfLayout((await pdf(doc([{ type: "paragraph", runs: [text(long)], align: "justify" }]))).bytes))[0]!;
    const first = p.items[0]!;
    // Justified full lines end at the right margin.
    expect(first.x + first.width).toBeCloseTo(A4.w - 72, 0);
  });
});

describe("PDF headers, footers, page numbers, page breaks", () => {
  const long = doc(Array.from({ length: 120 }, (_, i) => para(text(`Paragraph ${i} ` + "lorem ipsum dolor sit amet ".repeat(8)))));

  it("prints header and footer text and 'Page n of N' on every page", async () => {
    const res = await pdf(long, settings({ headerText: "Quarterly Report", footerText: "Confidential", pageNumbers: "page-n-of-N" }));
    const pages = await pdfLayout(res.bytes);
    expect(pages.length).toBeGreaterThan(2);
    pages.forEach((p, i) => {
      const t = p.items.map((x) => x.str).join(" ");
      expect(t).toContain("Quarterly Report");
      expect(t).toContain("Confidential");
      expect(t).toContain(`Page ${i + 1} of ${pages.length}`);
    });
  });

  it("supports bare numbers, n / N, and no numbering at all", async () => {
    const bare = await pdfLayout((await pdf(long, settings({ pageNumbers: "n" }))).bytes);
    expect(bare[1]!.items.some((i) => i.str.trim() === "2")).toBe(true);
    const both = await pdfLayout((await pdf(long, settings({ pageNumbers: "n-of-N" }))).bytes);
    expect(both[0]!.items.some((i) => new RegExp(`^1 / ${both.length}$`).test(i.str.trim()))).toBe(true);
    const none = await pdfLayout((await pdf(long, settings({ pageNumbers: "none" }))).bytes);
    expect(none[0]!.items.some((i) => /\d+ \/ \d+|Page \d/.test(i.str))).toBe(false);
  });

  it("honours explicit page breaks and ignores a trailing one", async () => {
    const d = doc([para(text("First page")), { type: "pagebreak" }, para(text("Second page")), { type: "pagebreak" }, para(text("Third page")), { type: "pagebreak" }]);
    const res = await pdf(d);
    const { pages, numPages } = await extractPdf(res.bytes);
    expect(numPages).toBe(3);
    expect(pages[0]).toContain("First page");
    expect(pages[1]).toContain("Second page");
    expect(pages[2]).toContain("Third page");
  });

  it("sets document information from meta", async () => {
    const res = await pdf(doc([para(text("x"))], { title: "My Title", author: "Jane Doe", subject: "Subj", keywords: ["a", "b"] }));
    const raw = latin1(res.bytes);
    expect(raw).toContain("/Title");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(res.bytes), verbosity: 0 });
    const info = (await (await task.promise).getMetadata()).info as Record<string, string>;
    expect(info.Title).toBe("My Title");
    expect(info.Author).toBe("Jane Doe");
    expect(info.Subject).toBe("Subj");
    expect(info.Keywords).toBe("a, b");
    await task.destroy();
  });
});

describe("PDF margins, size, orientation", () => {
  it.each([
    ["A4", "portrait", 595.28, 841.89],
    ["LETTER", "landscape", 792, 612],
    ["LEGAL", "portrait", 612, 1008],
  ] as const)("%s %s", async (pageSize, orientation, w, h) => {
    const res = await pdf(doc([para(text("Margin check"))]), settings({}, { pageSize, orientation }));
    const [p] = await pdfLayout(res.bytes);
    expect(p!.width).toBeCloseTo(w, 0);
    expect(p!.height).toBeCloseTo(h, 0);
  });

  it.each([
    ["narrow", 36],
    ["normal", 72],
    ["wide", 108],
  ] as const)("%s margins start text at %d pt", async (margins, pts) => {
    const [p] = await pdfLayout((await pdf(doc([para(text("Margin check"))]), settings({}, { margins }))).bytes);
    expect(p!.items[0]!.x).toBeCloseTo(pts, 0);
  });

  it("auto orientation picks landscape for a wide table and portrait otherwise", async () => {
    const wide = parseCsv(Array.from({ length: 3 }, (_, r) => Array.from({ length: 10 }, (_, c) => `r${r}c${c}`).join(",")).join("\n"), "balanced");
    const [w] = await pdfLayout((await pdf(wide, settings({}, { orientation: "auto" }))).bytes);
    expect(w!.width).toBeGreaterThan(w!.height);
    const [n] = await pdfLayout((await pdf(doc([para(text("narrow"))]), settings({}, { orientation: "auto" }))).bytes);
    expect(n!.width).toBeLessThan(n!.height);
  });
});

describe("PDF tables", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `row${i},${i * 7},text ${i}`).join("\n");
  const csv = (n: number) => parseCsv(`Name,Amount,Note\n${rows(n)}`, "balanced");

  it("splits long tables across pages, repeating the header row, and loses no rows", async () => {
    const res = await pdf(csv(400));
    const pages = await pdfLayout(res.bytes);
    expect(pages.length).toBeGreaterThan(3);
    pages.forEach((p) => expect(p.items.some((i) => i.str.includes("Name"))).toBe(true));
    const all = pages.map((p) => p.items.map((i) => i.str).join(" ")).join(" ");
    for (const i of [0, 199, 399]) expect(all).toContain(`row${i}`);
  });

  it("applies zebra, header fill, and their opt-outs", async () => {
    const on = (await pdfLayout((await pdf(csv(6), settings({ tableZebra: true, tableHeaderFill: true }))).bytes))[0]!;
    expect(on.fills).toContain("#e8ecfb");
    expect(on.fills).toContain("#f7f8fb");
    const off = (await pdfLayout((await pdf(csv(6), settings({ tableZebra: false, tableHeaderFill: false }))).bytes))[0]!;
    expect(off.fills).not.toContain("#e8ecfb");
    expect(off.fills).not.toContain("#f7f8fb");
  });

  it("changes border drawing between grid, horizontal and none", async () => {
    const count = async (b: StyleSettings["tableBorders"]) => (await pdfLayout((await pdf(csv(5), settings({ tableBorders: b }))).bytes))[0]!.paths;
    const grid = await count("grid");
    const horizontal = await count("horizontal");
    const none = await count("none");
    expect(grid).toBeGreaterThan(horizontal);
    expect(horizontal).toBeGreaterThan(none);
  });

  it("right-aligns numeric CSV columns, and leaves them left when disabled", async () => {
    const x = async (numberAlign: "auto" | "left") => {
      const p = (await pdfLayout((await pdf(csv(8), settings({ numberAlign, tableZebra: false }))).bytes))[0]!;
      const cell = p.items.find((i) => i.str.trim() === "49")!;
      return cell.x + cell.width;
    };
    const right = await x("auto");
    const left = await x("left");
    expect(right).toBeGreaterThan(left + 5);
  });

  it("equal column sizing differs from content sizing", async () => {
    const skew = parseCsv("a,b\nx,this is a much longer value in the second column of text\ny,more long text here too", "balanced");
    const xOf = async (columnSizing: "content" | "equal") => (await pdfLayout((await pdf(skew, settings({ columnSizing }))).bytes))[0]!.items.find((i) => i.str.includes("this"))!.x;
    expect(Math.abs((await xOf("content")) - (await xOf("equal")))).toBeGreaterThan(20);
  });

  it("never drops a column or row in a wide table", async () => {
    const cols = 30;
    const header = Array.from({ length: cols }, (_, c) => `H${c}`).join(",");
    const body = Array.from({ length: 5 }, (_, r) => Array.from({ length: cols }, (_, c) => `v${r}_${c}`).join(",")).join("\n");
    const res = await pdf(parseCsv(`${header}\n${body}`, "balanced"), settings({}, { orientation: "landscape" }));
    const all = (await extractPdf(res.bytes)).pages.join(" ");
    for (let c = 0; c < cols; c++) expect(all).toContain(`H${c}`);
    for (let r = 0; r < 5; r++) expect(all).toContain(`v${r}_${cols - 1}`);
  });
});

describe("PDF images", () => {
  it("embeds PNG and JPEG images, scaled inside the text column", async () => {
    const jp = pngSizeFromJpeg(jpg);
    const d = doc([para(text("Before")), img(), { type: "image", image: { bytes: jpg, mime: "image/jpeg", ...jp }, align: "center" }, para(text("After"))]);
    const res = await pdf(d);
    const pages = await pdfLayout(res.bytes);
    expect(pages.reduce((n, p) => n + p.images, 0)).toBe(2);
    const t = (await extractPdf(res.bytes)).pages.join(" ");
    expect(t.indexOf("Before")).toBeLessThan(t.indexOf("After"));
    expect(res.checks.find((c) => c.id === "text-embedded")!.passed).toBe(true);
  });
});

function pngSizeFromJpeg(b: Uint8Array) {
  // Reuse the production header reader so the test exercises the same dimensions the parser would record.
  return readImageSize(b, "jpeg")!;
}

const flat = (pages: string[]) => pages.join(" ").replace(/\s+/g, " ");

/** Default body font and size from word/styles.xml (docDefaults), independent of any style name lookup. */
async function docDefaults(bytes: Uint8Array) {
  const { zip } = await docxXml(bytes);
  const st = await zip.file("word/styles.xml")!.async("string");
  const rpr = /<w:rPrDefault><w:rPr>(.*?)<\/w:rPr>/.exec(st)![1]!;
  return { font: /w:ascii="([^"]+)"/.exec(rpr)![1], half: Number(/<w:sz w:val="(\d+)"/.exec(rpr)![1]), spacing: Number(/<w:pPrDefault><w:pPr><w:spacing w:line="(\d+)"/.exec(st)![1]) };
}

describe("PNG variants that the PDF engine can't decode in a worker-less runtime", () => {
  it("are replaced by alt text with a visible check when no canvas exists (browsers flatten them instead)", async () => {
    for (const name of ["interlaced.png", "rgba.png"]) {
      const bytes = fixtureBytes(name);
      const d = doc([para(text("before")), { type: "image", image: { bytes, mime: "image/png", ...pngSize(bytes), alt: "variant" } }]);
      const res = await pdf(d);
      expect((await extractPdf(res.bytes)).pages.join(" ")).toContain("[image: variant]");
      expect(res.checks.some((c) => c.id === "images-dropped" && !c.passed)).toBe(true);
    }
  });
  it("DOCX embeds them unchanged", async () => {
    const bytes = fixtureBytes("rgba.png");
    const res = await docx(doc([{ type: "image", image: { bytes, mime: "image/png", ...pngSize(bytes) } }]));
    expect((await pythonDocx(res.bytes)).images).toBe(1);
  });
});

describe("DOCX structure (read back with python-docx)", () => {
  const sample = () =>
    doc(
      [
        { type: "heading", level: 1, runs: [text("Big Title")], align: "center" },
        { type: "heading", level: 2, runs: [text("Sub title")] },
        { type: "paragraph", runs: [text("Plain "), text("underlined", { underline: true }), text(" "), text("red", { color: "#c00000", bold: true }), text(" "), text("link", { link: "https://example.com/" })], align: "right" },
        { type: "list", ordered: false, items: [{ runs: [text("one")] }, { runs: [text("two")] }] },
        { type: "list", ordered: true, items: [{ runs: [text("first")] }, { runs: [text("second")] }] },
        { type: "pagebreak" },
        { type: "paragraph", runs: [text("On page two")] },
        img("alt text"),
        { type: "table", header: [[text("Name")], [text("Amount")]], rows: [[[text("a")], [text("1")]], [[text("b")], [text("2")]]], align: ["left", "right"], autoAlign: false },
      ],
      { title: "Doc Title", author: "Jane Doe", subject: "About things", keywords: ["x", "y"] },
    );
  const s = settings({ fontFamily: "serif", fontSize: 12, lineSpacing: 1.5, headerText: "Report header", footerText: "Footer note", pageNumbers: "page-n-of-N" }, { orientation: "landscape", pageSize: "LETTER", margins: "narrow" });

  it("keeps headings, runs, alignment, fonts, and editable text", async () => {
    const res = await docx(sample(), s);
    expect(res.checks.every((c) => c.passed)).toBe(true);
    const j = await pythonDocx(res.bytes);
    const styles = j.paras.map((p: { style: string }) => p.style);
    expect(styles).toContain("Heading 1");
    expect(styles).toContain("Heading 2");
    const title = j.paras.find((p: { text: string }) => p.text === "Big Title");
    expect(title.align).toContain("CENTER");
    const mixed = j.paras.find((p: { text: string }) => p.text.startsWith("Plain"));
    expect(mixed.align).toContain("RIGHT");
    const u = mixed.runs.find((r: { t: string }) => r.t === "underlined");
    expect(u.u).toBe(true);
    const red = mixed.runs.find((r: { t: string }) => r.t === "red");
    expect(red.color).toBe("C00000");
    expect(red.b).toBe(true);
    expect(mixed.links).toBe(1);
    const d = await docDefaults(res.bytes);
    expect(d.font).toBe("Times New Roman");
    expect(d.half).toBe(24);
    expect(d.spacing).toBe(360);
    expect(j.styles["Heading 1"].bold).toBe(true);
    expect(j.styles["Heading 1"].size).toBe(24);
    expect(j.styleCounts["Heading 1"]).toBe(1);
  });

  it("writes page setup, header, footer with PAGE/NUMPAGES fields, and core properties", async () => {
    const j = await pythonDocx((await docx(sample(), s)).bytes);
    expect(j.page.orient).toContain("LANDSCAPE");
    expect(j.page.w).toBeCloseTo(792, 0);
    expect(j.page.h).toBeCloseTo(612, 0);
    expect(j.page.left).toBeCloseTo(36, 0);
    expect(j.header.join(" ")).toContain("Report header");
    expect(j.footer.join(" ")).toContain("Footer note");
    expect(j.footer_xml).toMatch(/PAGE/);
    expect(j.footer_xml).toMatch(/NUMPAGES/);
    expect(j.core).toMatchObject({ title: "Doc Title", author: "Jane Doe", subject: "About things", keywords: "x, y" });
  });

  it("carries page breaks, embedded images with alt text, lists, and styled tables", async () => {
    const res = await docx(sample(), s);
    const j = await pythonDocx(res.bytes);
    const after = j.paras.find((p: { text: string }) => p.text === "On page two");
    expect(after.pageBreakBefore).toBe(true);
    expect(j.images).toBe(1);
    const { xml, zip } = await docxXml(res.bytes);
    expect(xml).toContain('descr="alt text"');
    expect(Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n]!.dir).length).toBe(1);
    expect(xml).toContain("<w:numPr>");
    const t = j.tables[0];
    expect(t.headerRepeat).toBe(true);
    expect(t.rows[0][0].fill).toBe("E8ECFB");
    expect(t.rows[2][0].fill).toBe("F7F8FB");
    expect(t.rows[1][1].align).toContain("RIGHT");
  });

  it("table style options change cell shading", async () => {
    const d = sample();
    const res = await docx(d, settings({ tableZebra: false, tableHeaderFill: false }));
    const t = (await pythonDocx(res.bytes)).tables[0];
    expect(t.rows[0][0].fill).toBeNull();
    expect(t.rows[2][0].fill).toBeNull();
  });

  it("serif, sans and mono map to Word font names", async () => {
    for (const [family, name] of [["sans", "Calibri"], ["serif", "Times New Roman"], ["mono", "Courier New"]] as const) {
      expect((await docDefaults((await docx(doc([para(text("x"))]), settings({ fontFamily: family }))).bytes)).font).toBe(name);
    }
  });

  it("keeps long tables as real tables with all rows", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => `r${i},${i}`).join("\n");
    const j = await pythonDocx((await docx(parseCsv(`a,b\n${rows}`, "balanced"))).bytes);
    expect(j.tables[0].rows.length).toBe(301);
  });
});

describe("Markdown flows into both renderers without syntax leakage", () => {
  const md = "# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code` plus a [link](https://example.com).\n\n- [x] done\n- [ ] todo\n\n> quote text\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n";
  it("PDF text has no markup characters", async () => {
    const { pages } = await extractPdf((await pdf(parseMarkdown(md))).bytes);
    const t = pages.join(" ");
    for (const raw of ["**", "~~", "# Title", "](", "|---", "[x]", "[ ]", "> quote"]) expect(t).not.toContain(raw);
    for (const word of ["Title", "bold", "italic", "gone", "code", "link", "done", "todo", "quote text"]) expect(t).toContain(word);
  });
  it("source mode keeps the markup verbatim in monospace", async () => {
    const res = await pdf(parseMarkdown(md, { markdown: "source" }));
    const { pages } = await extractPdf(res.bytes);
    expect(pages.join(" ")).toContain("**bold**");
    expect(latin1(res.bytes)).toMatch(/LiberationMono/);
  });
});

describe("long documents", () => {
  it("paginates 3000 lines with header/footer on every page and consistent counts", async () => {
    const d = doc(Array.from({ length: 1500 }, (_, i) => para(text(`Line ${i}: ` + "words go here ".repeat(10)))));
    const res = await pdf(d, settings({ headerText: "H", pageNumbers: "n-of-N" }));
    const pages = await pdfLayout(res.bytes);
    expect(res.pageCount).toBe(pages.length);
    expect(pages.length).toBeGreaterThan(30);
    expect(pages.every((p) => p.items.some((i) => i.str.trim() === "H"))).toBe(true);
    const last = pages[pages.length - 1]!;
    expect(last.items.some((i) => i.str.trim() === `${pages.length} / ${pages.length}`)).toBe(true);
  }, 120000);
});
