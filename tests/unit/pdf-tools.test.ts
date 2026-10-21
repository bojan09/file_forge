import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { everyN, flattenUnique, parseRanges } from "@/engine/pdf-tools/ranges";
import { buildFromPlan, compressPdf, inspectPdf, setMetadata } from "@/engine/pdf-tools/ops";
import { runPdfTool } from "@/engine/pdf-tools/client";

const corpus = (n: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../corpus", n)));
const dir = mkdtempSync(path.join(tmpdir(), "pdftools-"));
let n = 0;
/** Independent readers: poppler's pdftotext/pdfinfo, not the library that wrote the file. */
function poppler(bytes: Uint8Array) {
  const f = path.join(dir, `f${n++}.pdf`);
  writeFileSync(f, bytes);
  const info = execFileSync("pdfinfo", ["-f", "1", "-l", "9999", f]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(info)![1]);
  const rot = [...info.matchAll(/Page\s+(\d+)\s+rot:\s+(\d+)/g)].map((m) => Number(m[2]));
  const text = (p: number) => execFileSync("pdftotext", ["-f", String(p), "-l", String(p), "-layout", f, "-"]).toString().replace(/\s+/g, " ").trim();
  return { pages, rot, text, info };
}

describe("page ranges", () => {
  it("parses single pages, ranges and open ends", () => {
    expect(parseRanges("1-3, 5, 8-", 10).groups).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
    expect(parseRanges("-2", 10).groups).toEqual([[0, 1]]);
  });
  it.each([["", /at least one/], ["0", /start at 1/], ["11", /past the end/], ["5-3", /backwards/], ["a", /not a page/], ["1-2-3", /not a page/], ["--", /not a page/]])("rejects %j", (t, re) => {
    const r = parseRanges(t, 10);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(re);
  });
  it("dedupes and splits evenly", () => {
    expect(flattenUnique([[0, 1], [1, 2]])).toEqual([0, 1, 2]);
    expect(everyN(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(everyN(3, 0)).toEqual([[0], [1], [2]]);
  });
});

describe("PDF tools against independent readers", () => {
  const simple = corpus("pdf-text-simple.pdf");
  const two = corpus("pdf-two-column.pdf");
  const long = corpus("pdf-long.pdf");

  it("merges two files in order with every page's text intact", async () => {
    const { bytes, pages } = await buildFromPlan(
      [simple, two],
      [...Array.from({ length: 4 }, (_, i) => ({ file: 0, page: i, rotate: 0 })), ...Array.from({ length: 3 }, (_, i) => ({ file: 1, page: i, rotate: 0 }))],
    );
    expect(pages).toBe(7);
    const out = poppler(bytes);
    const a = poppler(simple);
    const b = poppler(two);
    expect(out.pages).toBe(7);
    for (let i = 1; i <= 4; i++) expect(out.text(i)).toBe(a.text(i));
    for (let i = 1; i <= 3; i++) expect(out.text(4 + i)).toBe(b.text(i));
  });

  it("extracts, reorders and deletes pages", async () => {
    const { bytes } = await buildFromPlan([simple], [{ file: 0, page: 2, rotate: 0 }, { file: 0, page: 0, rotate: 0 }]);
    const out = poppler(bytes);
    const src = poppler(simple);
    expect(out.pages).toBe(2);
    expect(out.text(1)).toBe(src.text(3));
    expect(out.text(2)).toBe(src.text(1));
  });

  it("rotates cumulatively without touching other pages", async () => {
    const { bytes } = await buildFromPlan([simple], [{ file: 0, page: 0, rotate: 90 }, { file: 0, page: 1, rotate: 0 }, { file: 0, page: 0, rotate: 270 }]);
    expect(poppler(bytes).rot).toEqual([90, 0, 270]);
    const again = await buildFromPlan([bytes], [{ file: 0, page: 0, rotate: 90 }, { file: 0, page: 2, rotate: 180 }]);
    expect(poppler(again.bytes).rot).toEqual([180, 90]);
  });

  it("splits a 120-page file into the requested groups", async () => {
    const r = await runPdfTool({
      kind: "split",
      input: long,
      name: "pdf-long.pdf",
      groups: [Array.from({ length: 50 }, (_, i) => ({ file: 0, page: i, rotate: 0 })), Array.from({ length: 70 }, (_, i) => ({ file: 0, page: 50 + i, rotate: 0 }))],
      outNames: ["a.pdf", "b.pdf"],
    });
    expect(r.outputs.map((o) => poppler(o.bytes).pages)).toEqual([50, 70]);
    const src = poppler(long);
    expect(poppler(r.outputs[1]!.bytes).text(1)).toBe(src.text(51));
  });

  it("edits metadata, clears it, and keeps content", async () => {
    const m = await setMetadata(simple, { title: "Új Title ✓", author: "Автор", subject: "S", keywords: "a, b, c" }, false);
    const info = await inspectPdf(m.bytes);
    expect(info).toMatchObject({ title: "Új Title ✓", author: "Автор", subject: "S", keywords: "a, b, c", pageCount: 4 });
    expect(poppler(m.bytes).info).toContain("Title:");
    expect(poppler(m.bytes).text(2)).toBe(poppler(simple).text(2));
    const c = await setMetadata(m.bytes, { title: "", author: "", subject: "", keywords: "" }, true);
    expect(await inspectPdf(c.bytes)).toMatchObject({ title: "", author: "", subject: "", keywords: "" });
  });

  it("compression never returns a larger file and keeps every page", async () => {
    const r = await compressPdf(long);
    expect(r.bytes.length).toBeLessThanOrEqual(long.length);
    expect(poppler(r.bytes).pages).toBe(120);
    expect(poppler(r.bytes).text(60)).toBe(poppler(long).text(60));
    const again = await compressPdf(r.bytes);
    expect(again.smaller).toBe(false);
    expect(again.bytes).toBe(r.bytes);
  });

  it("refuses encrypted, damaged and non-PDF input with specific messages", async () => {
    await expect(inspectPdf(corpus("pdf-encrypted.pdf"), "enc.pdf")).rejects.toMatchObject({ code: "pdf-encrypted" });
    await expect(inspectPdf(corpus("pdf-truncated.pdf"), "t.pdf")).rejects.toMatchObject({ code: expect.stringMatching(/pdf-damaged|not-pdf/) });
    await expect(inspectPdf(corpus("pdf-notpdf.pdf"), "x.pdf")).rejects.toMatchObject({ code: "not-pdf" });
    await expect(buildFromPlan([simple], [{ file: 0, page: 9, rotate: 0 }])).rejects.toMatchObject({ code: "bad-page" });
    await expect(buildFromPlan([simple], [])).rejects.toMatchObject({ code: "empty-plan" });
  });

  it("a cancelled run rejects with AbortError before starting", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runPdfTool({ kind: "inspect", input: simple, name: "a.pdf" }, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
