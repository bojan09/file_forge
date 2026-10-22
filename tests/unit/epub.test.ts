// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { inspectFile, runConversion, type Inspection } from "@/engine/convert";
import { DEFAULT_PARSE_OPTIONS } from "@/engine/style";
import type { Block } from "@/engine/types";
import { defaultSettings, docxXml, pythonDocx } from "./helpers";
import { bagRecall, corpusFile, corpusText, orderedRecall, pdfPageCount, pdfWords, words } from "./corpus-metrics";

const insp = (n: string, processing: "balanced" | "conservative" = "balanced") => inspectFile(corpusFile(n), processing, undefined, DEFAULT_PARSE_OPTIONS);
async function convert(i: Inspection, output: "pdf" | "docx") {
  const settings = { ...defaultSettings, ...i.suggested?.page, style: i.suggested?.style } as typeof defaultSettings;
  const out = await runConversion(i, { output, settings, suffix: "" });
  return { out, bytes: new Uint8Array(await out.blob.arrayBuffer()) };
}
const count = (blocks: Block[], type: Block["type"]): number => blocks.reduce((n, b) => n + (b.type === type ? 1 : 0), 0);
const failure = async (n: string) => {
  try {
    await insp(n);
  } catch (e) {
    return { code: (e as { code?: string }).code ?? "none", message: (e as Error).message };
  }
  throw new Error(`${n} should have been refused`);
};

describe("EPUB", () => {
  it.each(["epub-simple", "epub-long", "epub-fontobf"])("%s: every word of the source chapters reaches the PDF, in order", async (n) => {
    const i = await insp(`${n}.epub`);
    const { out, bytes } = await convert(i, "pdf");
    const ref = words(corpusText(`${n}.ref.txt`));
    const got = await pdfWords(bytes);
    expect(bagRecall(ref, got.words)).toBeGreaterThanOrEqual(0.99);
    expect(orderedRecall(ref, got.words)).toBeGreaterThanOrEqual(0.95);
    // jsdom has no canvas, so a PNG with transparency falls back to alt text here; real browsers flatten it (covered in the browser tests).
    expect(out.checks.filter((c) => !c.passed && !/transparency/.test(c.label)).map((c) => c.label)).toEqual([]);
    expect(out.fidelity).toBe("experimental");
    if (n === "epub-long") expect(await pdfPageCount(bytes)).toBeGreaterThan(100);
  }, 180000);

  it("reads the book's title and author, keeps structure, and starts each chapter on a new page", async () => {
    const i = await insp("epub-simple.epub");
    expect(i.doc!.title).toBe("Corpus Book");
    expect(i.doc!.meta?.author).toBe("Corpus Author");
    expect(count(i.doc!.blocks, "pagebreak")).toBe(2);
    expect(count(i.doc!.blocks, "heading")).toBeGreaterThanOrEqual(4);
    expect(count(i.doc!.blocks, "table")).toBe(1);
    expect(count(i.doc!.blocks, "list")).toBe(2);
    expect(i.doc!.imageCount).toBe(2); // PNG plus the JPEG inside the SVG cover wrapper
    // An XML-style empty <div/> must not swallow the rest of the chapter.
    expect(JSON.stringify(i.doc!.blocks)).toContain("Second paragraph");
    expect(JSON.stringify(i.doc!.blocks)).toContain("Македонски");
  });

  it("converts to DOCX with python-docx seeing the headings, table and Cyrillic text", async () => {
    const i = await insp("epub-simple.epub");
    const { bytes } = await convert(i, "docx");
    const j = await pythonDocx(bytes);
    expect(j.paras.filter((p: { style: string }) => p.style.startsWith("Heading")).length).toBeGreaterThanOrEqual(4);
    expect(j.tables.length).toBe(1);
    const { xml } = await docxXml(bytes);
    expect(xml).toContain("Македонски");
  });

  it("reports what it left out, instead of dropping it silently", async () => {
    const gif = await insp("epub-gifonly.epub");
    expect(gif.warnings.map((w) => w.code)).toContain("images-format");
    const simple = await insp("epub-simple.epub");
    expect(simple.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["approximate", "images-embedded"]));
  });

  it("refuses protected, invalid and disguised files with specific messages", async () => {
    expect((await failure("epub-drm.epub")).code).toBe("epub-drm");
    expect((await failure("epub-nocontainer.epub")).code).toBe("epub-invalid");
    expect((await failure("epub-notzip.epub")).code).toBe("bad-signature");
  });

  it("applies the page limits of the processing mode", async () => {
    // 60 chapters × ~14 paragraphs is a few hundred pages: fine in both modes; the guard itself is covered in large-docs.test.ts.
    await expect(insp("epub-long.epub", "conservative")).resolves.toMatchObject({ kind: "epub" });
  });
});
