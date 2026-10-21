// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { BATCH_LIMITS } from "@/engine/batch/limits";
import { createDefaultDeps } from "@/engine/batch/default-deps";
import { BatchQueue, summarize } from "@/engine/batch/queue";
import { buildZip } from "@/engine/batch/zip";
import { complexityNote, estimatePages, inspectFile, reparseInspection, runConversion } from "@/engine/convert";
import { finalizeDoc } from "@/engine/parsers/common";
import type { Block, PageSettings } from "@/engine/types";
import { DEFAULT_SETTINGS, parseOptionsFromSettings, sanitizeSettings, styleFromSettings } from "@/lib/settings";
import { defaultSettings, docxXml, extractPdf } from "./helpers";

const read = (n: string) => readFileSync(path.resolve(__dirname, "../fixtures", n));
const fileOf = (name: string, data: Buffer | string) => new File([data as BlobPart], name);
const pdfText = async (b: Blob) => (await extractPdf(new Uint8Array(await b.arrayBuffer()))).pages.join(" ").replace(/\s+/g, " ");

describe("inspect, re-parse and convert with options", () => {
  it("re-parses CSV with a new delimiter and header setting without reading the file again", async () => {
    let reads = 0;
    const file = fileOf("d.csv", "a;b;c\n1;2;3\n4;5;6\n");
    const orig = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => (reads++, orig());
    const insp = await inspectFile(file, "balanced");
    expect(reads).toBe(1);
    const t1 = insp.doc!.blocks[0] as Extract<Block, { type: "table" }>;
    expect(t1.header).toHaveLength(3);
    const again = await reparseInspection(insp, "balanced", { ...insp.options, csvDelimiter: ",", csvHeader: "none" });
    const t2 = again.doc!.blocks[0] as Extract<Block, { type: "table" }>;
    expect(t2.header).toBeNull();
    expect(t2.rows[0]).toHaveLength(1);
    const back = await reparseInspection(again, "balanced", { ...again.options, csvDelimiter: ";", csvHeader: "first" });
    expect((back.doc!.blocks[0] as Extract<Block, { type: "table" }>).header).toHaveLength(3);
    expect(reads).toBe(1);
    expect(back.warnings.find((w) => w.code === "csv-delimiter")!.message).toMatch(/semicolon/);
  });

  it("re-parses Markdown between formatted and source", async () => {
    const insp = await inspectFile(fileOf("n.md", "# Head\n\n**bold**"), "balanced");
    expect(insp.doc!.hasHeadings).toBe(true);
    const src = await reparseInspection(insp, "balanced", { ...insp.options, markdown: "source" });
    expect(src.doc!.blocks[0]!.type).toBe("code");
    expect(src.doc!.hasHeadings).toBe(false);
  });

  it("applies persisted style defaults and per-file style to the output", async () => {
    const insp = await inspectFile(fileOf("n.md", "# Head\n\nBody **text** here."), "balanced");
    const style = { ...styleFromSettings({ ...DEFAULT_SETTINGS, fontFamily: "serif", pageNumbers: "page-n-of-N" }), headerText: "Per-file header" };
    const settings: PageSettings = { ...defaultSettings, style };
    const out = await runConversion(insp, { output: "pdf", settings, suffix: "" });
    expect(await pdfText(out.blob)).toMatch(/Per-file header.*Page 1 of 1/);
    const raw = Buffer.from(await out.blob.arrayBuffer()).toString("latin1");
    expect(raw).toMatch(/LiberationSerif/);
    const docxOut = await runConversion(insp, { output: "docx", settings, suffix: "" });
    expect(docxOut.checks.every((c) => c.passed)).toBe(true);
    const { zip } = await docxXml(new Uint8Array(await docxOut.blob.arrayBuffer()));
    expect(Object.keys(zip.files).some((n) => /word\/header\d*\.xml/.test(n))).toBe(true);
  });

  it("fails cleanly on malformed input instead of producing a broken file", async () => {
    await expect(inspectFile(fileOf("x.csv", ""), "balanced")).rejects.toThrow();
    await expect(inspectFile(fileOf("x.md", "   \n\n"), "balanced")).rejects.toThrow(/no text/i);
    await expect(inspectFile(fileOf("x.html", "<script>1</script>"), "balanced")).rejects.toThrow(/no convertible/i);
    await expect(inspectFile(fileOf("x.txt", Buffer.from([0x68, 0x00, 0x69])), "balanced")).rejects.toThrow(/binary/i);
  });
});

describe("batch regressions with styles", () => {
  const shared = (style?: PageSettings["style"]) => ({ output: "pdf" as const, page: { ...defaultSettings, style }, suffix: "" });

  it("shared style reaches every file; per-file output override and ZIP still work; failures stay isolated", async () => {
    const style = { fontFamily: "serif" as const, headerText: "Batch header", pageNumbers: "n-of-N" as const };
    const q = new BatchQueue(createDefaultDeps(() => "balanced", () => parseOptionsFromSettings({ ...DEFAULT_SETTINGS, csvDelimiter: ";" })), { limits: BATCH_LIMITS.balanced, shared: shared(style), processing: "balanced" });
    await q.addFiles([fileOf("a.md", "# A\n\ntext a"), fileOf("b.csv", "x;y\n1;2\n"), fileOf("c.csv", `${Array.from({ length: 60 }, (_, i) => i).join(";")}\n1`), fileOf("d.txt", "plain d")]);
    q.setOverride(q.getSnapshot().items[3]!.id, { output: "docx" });
    q.start();
    await q.idle();
    const snap = q.getSnapshot();
    expect(summarize(snap)).toMatchObject({ done: 3, failed: 1 });
    expect(snap.items.map((i) => i.status)).toEqual(["done", "done", "failed", "done"]);
    const outs = snap.items.filter((i) => i.output).map((i) => i.output!);
    for (const o of outs.filter((o) => o.extension === "pdf")) {
      expect(await pdfText(o.blob)).toContain("Batch header");
      expect(Buffer.from(await o.blob.arrayBuffer()).toString("latin1")).toMatch(/LiberationSerif/);
    }
    // The semicolon option applied to the batch: two columns, not one.
    expect(await pdfText(outs[1]!.blob)).toMatch(/x\s+y/);
    const z = await JSZip.loadAsync(await (await buildZip(outs.map((o) => ({ name: o.filename, blob: o.blob })))).arrayBuffer());
    expect(Object.keys(z.files).sort()).toEqual(["a.pdf", "b.pdf", "d.docx"]);
  });
});

describe("settings", () => {
  it("round-trips the new style and parse settings and rejects bad values", () => {
    const s = sanitizeSettings({ fontFamily: "serif", fontSize: 13, lineSpacing: 1.5, pageNumbers: "n", tableZebra: false, tableBorders: "none", csvDelimiter: ";", csvHeader: "none", markdown: "source", orientation: "auto", tableFontScale: 1.2 });
    expect(s).toMatchObject({ fontFamily: "serif", fontSize: 13, lineSpacing: 1.5, pageNumbers: "n", tableZebra: false, tableBorders: "none", csvDelimiter: ";", csvHeader: "none", markdown: "source", orientation: "auto", tableFontScale: 1.2 });
    const bad = sanitizeSettings({ fontFamily: "comic", fontSize: 4000, lineSpacing: "x", pageNumbers: "roman", tableZebra: "yes", csvDelimiter: "<script>", markdown: "html", tableFontScale: -1 });
    expect(bad.fontFamily).toBe("sans");
    expect(bad.fontSize).toBe(16);
    expect(bad.lineSpacing).toBe(DEFAULT_SETTINGS.lineSpacing);
    expect(bad.pageNumbers).toBe(DEFAULT_SETTINGS.pageNumbers);
    expect(bad.tableZebra).toBe(true);
    expect(bad.csvDelimiter).toBe("auto");
    expect(bad.markdown).toBe("formatted");
    expect(bad.tableFontScale).toBe(0.8);
  });
});

describe("complexity warnings", () => {
  const paragraphs = (chars: number) => finalizeDoc([{ type: "paragraph", runs: [{ text: "x".repeat(chars) }] }], []);
  it("is quiet for normal documents and escalates with length", () => {
    expect(complexityNote(paragraphs(5000), 5000, "txt")).toBeNull();
    expect(complexityNote(paragraphs(400_000), 400_000, "txt")?.level).toBe("info");
    const huge = complexityNote(paragraphs(1_500_000), 1_500_000, "txt");
    expect(huge?.level).toBe("warn");
    expect(huge?.message).toMatch(/DOCX is much faster/);
  });
  it("counts table rows and images in the estimate", () => {
    const rows = finalizeDoc([{ type: "table", header: [[{ text: "a" }]], rows: Array.from({ length: 4000 }, () => [[{ text: "1" }]]) }], []);
    expect(estimatePages(rows)).toBeGreaterThanOrEqual(100);
    const img = { bytes: new Uint8Array(1), mime: "image/png" as const, width: 1, height: 1 };
    const many = finalizeDoc(Array.from({ length: 40 }, () => ({ type: "image" as const, image: img })), []);
    expect(complexityNote(many, 1, "html")?.code).toBe("many-images");
  });
});
