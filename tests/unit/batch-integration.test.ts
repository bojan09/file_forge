// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { BATCH_LIMITS } from "@/engine/batch/limits";
import { createDefaultDeps } from "@/engine/batch/default-deps";
import { BatchQueue, summarize } from "@/engine/batch/queue";
import type { SharedSettings } from "@/engine/batch/types";
import { buildZip } from "@/engine/batch/zip";
import { defaultSettings, docxXml, extractPdf } from "./helpers";

const read = (n: string) => readFileSync(path.resolve(__dirname, "../fixtures", n));
// jsdom's File lacks arrayBuffer/slice-arrayBuffer in some versions; build Files from Buffers and check support.
const fileOf = (name: string, data: Buffer | string) => new File([data as BlobPart], name);

const shared = (over: Partial<SharedSettings> = {}): SharedSettings => ({ output: "pdf", page: { ...defaultSettings }, suffix: "", ...over });

describe("batch with the real engine (main-thread render fallback)", () => {
  it("converts mixed files in order; outputs are valid and verified by independent readers; ZIP round-trips", async () => {
    const q = new BatchQueue(createDefaultDeps(() => "balanced"), { limits: BATCH_LIMITS.balanced, shared: shared(), processing: "balanced" });
    await q.addFiles([fileOf("notes.txt", read("sample.txt")), fileOf("plan.md", read("sample.md")), fileOf("table.csv", read("sample.csv")), fileOf("page.html", read("sample.html")), fileOf("broken.txt", Buffer.from([1, 2, 0, 3]))]);
    expect(q.getSnapshot().items.map((i) => i.status)).toEqual(["queued", "queued", "queued", "queued", "rejected"]);
    q.setOverride(q.getSnapshot().items[1]!.id, { output: "docx" });
    q.start();
    await q.idle();
    const snap = q.getSnapshot();
    expect(summarize(snap)).toMatchObject({ done: 4, failed: 0, rejected: 1 });
    const outs = snap.items.filter((i) => i.output).map((i) => i.output!);
    expect(outs.map((o) => o.filename)).toEqual(["notes.pdf", "plan.docx", "table.pdf", "page.pdf"]);
    for (const o of outs) expect(o.checks.every((c) => c.passed)).toBe(true);

    const bytes = async (n: string) => new Uint8Array(await outs.find((o) => o.filename === n)!.blob.arrayBuffer());
    expect((await extractPdf(await bytes("notes.pdf"))).pages.join(" ")).toContain("Здраво свету");
    expect((await extractPdf(await bytes("table.pdf"))).pages.join(" ")).toContain("Likes");
    expect((await extractPdf(await bytes("page.pdf"))).pages.join(" ")).toContain("HTML Heading");
    const { xml } = await docxXml(await bytes("plan.docx"));
    expect(xml).toContain("<w:tbl>");

    const zipBlob = await buildZip(outs.map((o) => ({ name: o.filename, blob: o.blob })));
    const z = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(z.files).sort()).toEqual(["notes.pdf", "page.pdf", "plan.docx", "table.pdf"]);
    for (const o of outs) expect(new Uint8Array(await z.file(o.filename)!.async("uint8array"))).toEqual(await bytes(o.filename));
  });

  it("a malformed file fails alone; the rest still convert; retry reports again", async () => {
    const q = new BatchQueue(createDefaultDeps(() => "balanced"), { limits: BATCH_LIMITS.balanced, shared: shared(), processing: "balanced" });
    // Passes intake (extension, no NUL in header) but is a CSV with a limit violation found at conversion time.
    const wide = Array.from({ length: 60 }, (_, i) => i).join(",");
    await q.addFiles([fileOf("a.txt", "first file"), fileOf("wide.csv", `${wide}\n${wide}\n`), fileOf("c.txt", "third file")]);
    q.start();
    await q.idle();
    expect(q.getSnapshot().items.map((i) => i.status)).toEqual(["done", "failed", "done"]);
    expect(q.getSnapshot().items[1]!.error).toMatch(/columns/);
    q.retry(q.getSnapshot().items[1]!.id);
    await q.idle();
    expect(q.getSnapshot().items[1]!.status).toBe("failed");
    expect(q.getSnapshot().items[1]!.attempts).toBe(2);
  });
});
