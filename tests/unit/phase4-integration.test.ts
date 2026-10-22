// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { BATCH_LIMITS } from "@/engine/batch/limits";
import { createDefaultDeps } from "@/engine/batch/default-deps";
import { validateIntake } from "@/engine/batch/intake";
import { BatchQueue, summarize } from "@/engine/batch/queue";
import { buildZip } from "@/engine/batch/zip";
import { inspectFile, reparseInspection, runConversion } from "@/engine/convert";
import { SOURCE_FORMATS, UNAVAILABLE_PATHWAYS, ACCEPT_ATTR, getFormat } from "@/engine/registry";
import { DEFAULT_PARSE_OPTIONS } from "@/engine/style";
import { defaultSettings, extractPdf, pythonDocx } from "./helpers";
import { corpusFile } from "./corpus-metrics";

const shared = (output: "pdf" | "docx") => ({ output, page: { ...defaultSettings }, suffix: "" });
const names = (q: BatchQueue) => q.getSnapshot().items.map((i) => `${i.name}:${i.status}`);

describe("registry", () => {
  it("every offered output has a fidelity label, and binary kinds are flagged", () => {
    for (const f of SOURCE_FORMATS) for (const o of f.outputs) expect(f.fidelity[o], `${f.id}->${o}`).toBeTruthy();
    expect(SOURCE_FORMATS.filter((f) => f.binary).map((f) => f.id).sort()).toEqual(["docx", "epub", "pdf", "xlsx"]);
    expect(getFormat("docx").outputs).toEqual(["pdf"]);
    expect(getFormat("xlsx").outputs).toEqual(["pdf"]);
    expect(getFormat("pdf").outputs).toEqual(["docx"]);
    getFormat("epub").outputs.forEach((o) => expect(getFormat("epub").fidelity[o]).toBe("high"));
    for (const k of ["docx", "xlsx", "pdf"] as const) expect(Object.values(getFormat(k).fidelity)).toContain("experimental");
  });
  it("the picker accepts the new extensions, and unavailable pathways are documented with reasons", () => {
    const accepted = ACCEPT_ATTR.split(",");
    for (const e of [".docx", ".xlsx", ".pdf", ".epub"]) expect(accepted).toContain(e);
    for (const e of [".pptx", ".doc", ".xls", ".docm", ".xlsm"]) expect(accepted).not.toContain(e);
    expect(UNAVAILABLE_PATHWAYS.map((u) => `${u.from}>${u.to}`)).toEqual(expect.arrayContaining(["Scanned PDF>Word", "Excel>Word", "PowerPoint>PDF", "PowerPoint>Word"]));
    for (const u of UNAVAILABLE_PATHWAYS) expect(u.reason.length).toBeGreaterThan(40);
  });
});

describe("intake and single-file guards", () => {
  it("rejects wrong extensions, disguised files and unsupported Office formats up front", async () => {
    await expect(validateIntake(corpusFile("docx-notzip.docx"), "balanced")).rejects.toThrow(/valid \.docx/);
    await expect(validateIntake(corpusFile("pdf-notpdf.pdf"), "balanced")).rejects.toThrow(/PDF header/);
    await expect(validateIntake(corpusFile("xlsx-notzip.xlsx"), "balanced")).rejects.toThrow(/valid \.xlsx/);
    await expect(validateIntake(new File(["x"], "deck.pptx"), "balanced")).rejects.toThrow(/not supported/);
    await expect(validateIntake(new File(["x"], "old.doc"), "balanced")).rejects.toThrow(/not supported/);
    await expect(validateIntake(new File(["x"], "macro.docm"), "balanced")).rejects.toThrow(/not supported/);
    await expect(validateIntake(corpusFile("docx-simple.docx"), "balanced")).resolves.toMatchObject({ extension: "docx" });
    await expect(validateIntake(corpusFile("pdf-text-simple.pdf"), "balanced")).resolves.toMatchObject({ extension: "pdf" });
  });
  it("size limits are per type", async () => {
    const big = new File([new Uint8Array(101 * 1024 * 1024)], "huge.pdf");
    await expect(validateIntake(big, "balanced")).rejects.toThrow(/limited to 100 MB/);
    const mid = new File([new Uint8Array(31 * 1024 * 1024)], "mid.pdf");
    await expect(validateIntake(mid, "conservative")).rejects.toThrow(/limited to 30 MB in conservative mode/);
  });
  it("refuses an output the source can't produce", async () => {
    const i = await inspectFile(corpusFile("docx-simple.docx"), "balanced");
    await expect(runConversion(i, { output: "docx", settings: defaultSettings, suffix: "" })).rejects.toThrow(/can't be converted to DOCX/);
    const p = await inspectFile(corpusFile("pdf-text-simple.pdf"), "balanced");
    await expect(runConversion(p, { output: "pdf", settings: defaultSettings, suffix: "" })).rejects.toThrow(/can't be converted to PDF/);
  });
  it("re-parsing XLSX options uses the kept bytes, not the file", async () => {
    let reads = 0;
    const f = corpusFile("xlsx-multi.xlsx");
    const orig = f.arrayBuffer.bind(f);
    f.arrayBuffer = () => (reads++, orig());
    const i = await inspectFile(f, "balanced");
    const all = await reparseInspection(i, "balanced", { ...DEFAULT_PARSE_OPTIONS, xlsxSheet: "all" });
    expect(reads).toBe(1);
    expect(all.doc!.blocks.filter((b) => b.type === "table")).toHaveLength(2);
  });
});

describe("batch with Office and PDF files", () => {
  it("mixed batch to PDF: eligible files convert, PDF input is skipped (not failed), failures stay isolated, ZIP is complete", async () => {
    const q = new BatchQueue(createDefaultDeps(() => "balanced", () => DEFAULT_PARSE_OPTIONS), { limits: BATCH_LIMITS.balanced, shared: shared("pdf"), processing: "balanced" });
    await q.addFiles([corpusFile("docx-simple.docx"), corpusFile("xlsx-simple.xlsx"), corpusFile("pdf-text-simple.pdf"), corpusFile("xlsx-too-wide.xlsx"), new File(["# Notes\n\ntext"], "notes.md"), corpusFile("docx-notzip.docx")]);
    expect(q.getSnapshot().items.map((i) => i.status)).toEqual(["queued", "queued", "queued", "queued", "queued", "rejected"]);
    const pdfItem = q.getSnapshot().items[2]!;
    q.start();
    await q.idle();
    const snap = q.getSnapshot();
    expect(names(q)).toEqual(["docx-simple.docx:done", "xlsx-simple.xlsx:done", "pdf-text-simple.pdf:queued", "xlsx-too-wide.xlsx:failed", "notes.md:done", "docx-notzip.docx:rejected"]);
    expect(summarize(snap)).toMatchObject({ done: 3, failed: 1, blocked: 1, rejected: 1 });
    expect(snap.items.find((i) => i.id === pdfItem.id)!.status).toBe("queued");
    expect(snap.items[3]!.error).toMatch(/40-column limit/);
    const outs = snap.items.filter((i) => i.output).map((i) => i.output!);
    expect(outs.map((o) => o.filename)).toEqual(["docx-simple.pdf", "xlsx-simple.pdf", "notes.pdf"]);
    for (const o of outs) expect(o.checks.every((c) => c.passed)).toBe(true);
    expect(outs[0]!.fidelity).toBe("experimental");
    expect((await extractPdf(new Uint8Array(await outs[0]!.blob.arrayBuffer()))).pages.join(" ")).toContain("Simple Report");
    const z = await JSZip.loadAsync(await (await buildZip(outs.map((o) => ({ name: o.filename, blob: o.blob })))).arrayBuffer());
    expect(Object.keys(z.files).sort()).toEqual(["docx-simple.pdf", "notes.pdf", "xlsx-simple.pdf"]);
  }, 120000);

  it("shared output DOCX: PDF input converts, Word and Excel inputs are skipped with an explanation", async () => {
    const q = new BatchQueue(createDefaultDeps(() => "balanced"), { limits: BATCH_LIMITS.balanced, shared: shared("docx"), processing: "balanced" });
    await q.addFiles([corpusFile("pdf-text-simple.pdf"), corpusFile("docx-simple.docx"), corpusFile("xlsx-simple.xlsx")]);
    q.start();
    await q.idle();
    expect(names(q)).toEqual(["pdf-text-simple.pdf:done", "docx-simple.docx:queued", "xlsx-simple.xlsx:queued"]);
    const out = q.getSnapshot().items[0]!.output!;
    expect(out.filename).toBe("pdf-text-simple.docx");
    expect(out.extension).toBe("docx");
    expect((await pythonDocx(new Uint8Array(await out.blob.arrayBuffer()))).paras.some((p: { style: string }) => p.style === "Heading 1")).toBe(true);
  }, 120000);

  it("a scanned PDF fails alone with the OCR explanation; retry reports it again", async () => {
    const q = new BatchQueue(createDefaultDeps(() => "balanced"), { limits: BATCH_LIMITS.balanced, shared: shared("docx"), processing: "balanced" });
    await q.addFiles([corpusFile("pdf-links.pdf"), corpusFile("pdf-scanned.pdf"), corpusFile("pdf-encrypted.pdf")]);
    q.start();
    await q.idle();
    expect(names(q)).toEqual(["pdf-links.pdf:done", "pdf-scanned.pdf:failed", "pdf-encrypted.pdf:failed"]);
    expect(q.getSnapshot().items[1]!.error).toMatch(/OCR/);
    expect(q.getSnapshot().items[2]!.error).toMatch(/password/i);
    q.retry(q.getSnapshot().items[1]!.id);
    await q.idle();
    expect(q.getSnapshot().items[1]!.attempts).toBe(2);
    expect(q.getSnapshot().items[1]!.status).toBe("failed");
  }, 120000);

  it("cancelling during a PDF parse stops it and leaves the queue usable", async () => {
    const q = new BatchQueue(createDefaultDeps(() => "balanced"), { limits: BATCH_LIMITS.balanced, shared: shared("docx"), processing: "balanced" });
    await q.addFiles([corpusFile("pdf-long.pdf"), corpusFile("pdf-links.pdf")]);
    q.start();
    await new Promise((r) => setTimeout(r, 30));
    q.cancelAll();
    await q.idle();
    expect(q.getSnapshot().items.every((i) => i.status === "cancelled" || i.status === "done")).toBe(true);
    q.clear();
    await q.addFiles([corpusFile("pdf-links.pdf")]);
    q.start();
    await q.idle();
    expect(q.getSnapshot().items[0]!.status).toBe("done");
  }, 120000);
});
