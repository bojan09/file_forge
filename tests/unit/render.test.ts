import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/engine/parsers/csv";
import { parseMarkdown } from "@/engine/parsers/markdown";
import { parseTxt } from "@/engine/parsers/txt";
import { runRender } from "@/engine/render";
import { verifyDocx, verifyPdf } from "@/engine/verify";
import { measureCoverage } from "@/engine/coverage";
import type { NormalizedDoc, PageSettings } from "@/engine/types";
import { defaultSettings, docxXml, extractPdf } from "./helpers";

const fx = (n: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../fixtures", n)));
const pdf = (doc: NormalizedDoc, settings: PageSettings = defaultSettings) => runRender({ kind: "doc", doc, output: "pdf", settings, title: "t" });
const docx = (doc: NormalizedDoc, settings: PageSettings = defaultSettings) => runRender({ kind: "doc", doc, output: "docx", settings, title: "t" });

async function pageBoxes(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const out: number[][] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await doc.getPage(i)).view);
  return out;
}

describe("PDF rendering", () => {
  it("produces searchable text with Unicode (Latin, Cyrillic incl. Macedonian, Greek)", async () => {
    const res = await pdf(parseTxt("Здраво свету — Македонија ќ ѓ љ њ џ ѕ. Ελληνικά café Łódź €5 “quotes”."));
    const { pages } = await extractPdf(res.bytes);
    const t = pages.join(" ");
    for (const w of ["Здраво свету", "Македонија", "ќ ѓ љ њ џ ѕ", "Ελληνικά", "café", "Łódź", "€5"]) expect(t).toContain(w);
    expect(res.checks.every((c) => c.passed)).toBe(true);
    expect(res.mime).toBe("application/pdf");
  });

  it("paginates long text and keeps page order and all content", async () => {
    const paragraphs = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} ` + "lorem ipsum dolor sit amet ".repeat(12)).join("\n\n");
    const res = await pdf(parseTxt(paragraphs));
    const { pages, numPages } = await extractPdf(res.bytes);
    expect(numPages).toBeGreaterThan(10);
    expect(res.pageCount).toBe(numPages);
    const all = pages.join(" ");
    expect(all).toContain("Paragraph 0 ");
    expect(all).toContain("Paragraph 399 ");
    expect(all.indexOf("Paragraph 10 ")).toBeLessThan(all.indexOf("Paragraph 300 "));
  });

  it("does not overflow the page with an unbreakable long word", async () => {
    const res = await pdf(parseTxt("x".repeat(600)));
    const { pages } = await extractPdf(res.bytes);
    expect(pages.join("").replace(/\s/g, "")).toContain("x".repeat(600));
  });

  it("honors page size, orientation and margins", async () => {
    const doc = parseTxt("hello");
    const a4 = (await pageBoxes((await pdf(doc, { ...defaultSettings, pageSize: "A4" })).bytes))[0]!;
    const letterL = (await pageBoxes((await pdf(doc, { ...defaultSettings, pageSize: "LETTER", orientation: "landscape" })).bytes))[0]!;
    const legal = (await pageBoxes((await pdf(doc, { ...defaultSettings, pageSize: "LEGAL" })).bytes))[0]!;
    expect(Math.round(a4[2]!)).toBe(595);
    expect(Math.round(a4[3]!)).toBe(842);
    expect(Math.round(letterL[2]!)).toBe(792);
    expect(Math.round(letterL[3]!)).toBe(612);
    expect(Math.round(legal[3]!)).toBe(1008);
  });

  it("renders Markdown tables across pages with repeating headers", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => `| row${i} | value${i} |`).join("\n");
    const res = await pdf(parseMarkdown(`| Name | Val |\n|--|--|\n${rows}\n`));
    const { pages, numPages } = await extractPdf(res.bytes);
    expect(numPages).toBeGreaterThan(1);
    expect(pages.filter((p) => p.includes("Name") && p.includes("Val")).length).toBe(numPages);
    expect(pages.join(" ")).toContain("row119");
  });

  it("renders long wide CSV tables completely", async () => {
    const head = Array.from({ length: 10 }, (_, i) => `H${i}`).join(",");
    const body = Array.from({ length: 300 }, (_, r) => Array.from({ length: 10 }, (_, c) => `v${r}x${c}`).join(",")).join("\n");
    const res = await pdf(parseCsv(`${head}\n${body}\n`, "balanced"), { ...defaultSettings, orientation: "landscape" });
    const { pages } = await extractPdf(res.bytes);
    const all = pages.join(" ").replace(/\s+/g, "");
    expect(all).toContain("v299x9");
    expect(all).toContain("v0x0");
  });

  it("replaces glyphs the font lacks and warns; refuses mostly-unsupported text", async () => {
    const mixed = parseTxt("Hello world 你 mixed");
    const rep = await pdf(mixed);
    expect((await extractPdf(rep.bytes)).pages.join(" ")).toContain("Hello world ? mixed");
    expect(rep.checks.some((c) => c.id === "glyphs" && !c.passed)).toBe(true);
    const cjk = parseTxt("这是一个完全由中文组成的文档。".repeat(5));
    expect(measureCoverage(cjk).unsupported).toBeGreaterThan(30);
    await expect(pdf(cjk)).rejects.toThrow(/DOCX/);
  });

  it("renders links as clickable annotations and keeps emphasis text", async () => {
    const res = await pdf(parseMarkdown("See [site](https://example.com/x) and **bold**."));
    const text = Buffer.from(res.bytes).toString("latin1");
    expect(text).toContain("/URI (https://example.com/x)");
  });

  it("handles an empty-ish document with a single character", async () => {
    const res = await pdf(parseTxt("a"));
    expect((await extractPdf(res.bytes)).numPages).toBe(1);
  });
});

describe("image PDF rendering", () => {
  const jpg = { bytes: fx("photo.jpg"), mime: "image/jpeg" as const, width: 400, height: 240 };
  it("embeds the image once, with aspect ratio preserved and auto orientation", async () => {
    const res = await runRender({ kind: "image", image: jpg, settings: { ...defaultSettings, orientation: "auto" }, title: "p" });
    const [box] = await pageBoxes(res.bytes);
    expect(box![2]! > box![3]!).toBe(true); // landscape image -> landscape page
    expect(res.pageCount).toBe(1);
    expect(res.checks.find((c) => c.id === "image-embedded")?.passed).toBe(true);
    expect((await extractPdf(res.bytes)).pages.join("").trim()).toBe("");
  });
  it("match mode sizes the page to the image without margins", async () => {
    const res = await runRender({ kind: "image", image: jpg, settings: { ...defaultSettings, imageFit: "match" }, title: "p" });
    const [box] = await pageBoxes(res.bytes);
    expect(Math.round(box![2]!)).toBe(300);
    expect(Math.round(box![3]!)).toBe(180);
  });
  // PNG/WebP embedding is covered by the browser E2E tests: pdfmake decodes PNG via fflate Web Workers, unavailable in Node.
});

describe("DOCX rendering", () => {
  const md = "# Heading\n\nText with [link](https://example.com), **bold**, *it*, `code`.\n\n- a\n  - nested\n- b\n\n1. one\n2. two\n\nNew list:\n\n1. again\n\n> quote\n\n```\ncode block\n```\n\n| A | B |\n|--|--|\n| 1 | 2 |\n\n---\n";
  it("creates real Word structure", async () => {
    const res = await docx(parseMarkdown(md));
    const { xml, zip } = await docxXml(res.bytes);
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:hyperlink");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect((xml.match(/<w:numPr>/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(zip.files).some((n) => n.startsWith("word/media/"))).toBe(false);
    expect(res.checks.every((c) => c.passed)).toBe(true);
    expect(res.extension).toBe("docx");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("https://example.com");
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    expect(numbering).toContain("ordered-1".length ? "w:abstractNum" : "");
  });
  it("restarts numbering for separate ordered lists", async () => {
    const res = await docx(parseMarkdown("1. a\n2. b\n\ntext\n\n1. c\n"));
    const { xml } = await docxXml(res.bytes);
    const ids = new Set([...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
    expect(ids.size).toBe(2);
  });
  it("honors page size, landscape and margins", async () => {
    const land = await docx(parseTxt("x"), { ...defaultSettings, pageSize: "LETTER", orientation: "landscape", margins: "narrow" });
    const { xml } = await docxXml(land.bytes);
    const sz = /<w:pgSz [^>]*>/.exec(xml)![0];
    expect(sz).toContain('w:w="15840"');
    expect(sz).toContain('w:h="12240"');
    expect(sz).toContain('w:orient="landscape"');
    expect(xml).toMatch(/<w:pgMar [^>]*w:left="720"/);
    const portrait = await docx(parseTxt("x"), { ...defaultSettings, pageSize: "A4" });
    const p = /<w:pgSz [^>]*>/.exec((await docxXml(portrait.bytes)).xml)![0];
    expect(p).toContain('w:w="11906"');
    expect(p).toContain('w:h="16838"');
  });
  it("preserves line breaks, Unicode and escapes XML characters", async () => {
    const res = await docx(parseTxt("a & b < c > d\nline2 Здраво 中文"));
    const { xml } = await docxXml(res.bytes);
    expect(xml).toContain("a &amp; b &lt; c &gt; d");
    expect(xml).toContain("<w:br/>");
    expect(xml).toContain("Здраво 中文");
  });
  it("builds a table with the right shape for wide CSV", async () => {
    const head = Array.from({ length: 24 }, (_, i) => `C${i}`).join(",");
    const res = await docx(parseCsv(`${head}\n${head}\n`, "balanced"));
    const { xml } = await docxXml(res.bytes);
    expect((xml.match(/<w:gridCol /g) ?? []).length).toBe(24);
    expect((xml.match(/<w:tr>|<w:tr /g) ?? []).length).toBe(2);
    expect(xml).toContain("<w:tblHeader/>");
  });
});

describe("verification catches broken output", () => {
  it("flags truncated PDFs and corrupt DOCX", async () => {
    const good = (await pdf(parseTxt("hello"))).bytes;
    expect(verifyPdf(good.subarray(0, 40), { kind: "text" }).some((c) => c.id === "pdf-structure" && !c.passed)).toBe(true);
    expect(verifyPdf(new Uint8Array(), { kind: "text" })[0]!.passed).toBe(false);
    const doc = parseTxt("hello");
    const bad = await verifyDocx(new Uint8Array([1, 2, 3, 4]), doc);
    expect(bad.some((c) => c.id === "docx-structure" && !c.passed)).toBe(true);
  });
});

describe("performance", () => {
  it("converts a 5 MB text file to PDF without failing", async () => {
    const line = "The quick brown fox jumps over the lazy dog 0123456789 — ќ Ж.\n";
    const text = line.repeat(Math.ceil((5 * 1024 * 1024) / line.length));
    const doc = parseTxt(text);
    const start = Date.now();
    const res = await runRender({ kind: "doc", doc: { ...doc, blocks: doc.blocks }, output: "docx", settings: defaultSettings, title: "big" });
    console.log(`5MB TXT -> DOCX: ${Date.now() - start} ms, ${res.bytes.length} bytes`);
    expect(res.checks.every((c) => c.passed)).toBe(true);
  }, 120000);
});
