import { describe, expect, it } from "vitest";
import { BATCH_LIMITS, effectiveBatchLimits } from "@/engine/batch/limits";
import { sanitizeEntryName, sanitizeFileName, uniqueName, zipFileName } from "@/engine/batch/naming";
import { BatchQueue, eligibility, summarize } from "@/engine/batch/queue";
import type { BatchDeps, ConvertContext, QueueItem, SharedSettings } from "@/engine/batch/types";
import type { ConversionOutput } from "@/engine/convert";
import { FileForgeError } from "@/engine/types";
import { defaultSettings } from "./helpers";

const shared = (over: Partial<SharedSettings> = {}): SharedSettings => ({ output: "pdf", page: { ...defaultSettings }, suffix: "", ...over });
// Numeric content makes a file of that many bytes, unique per name so it is not treated as a duplicate.
const file = (name: string, content: string | number = "hello", type = "text/plain") => new File([typeof content === "number" ? name.padEnd(content, "-").slice(0, content) : content], name, { type });

function output(name: string, ctx: ConvertContext): ConversionOutput {
  const ext = ctx.output;
  return {
    blob: new Blob(["x"], { type: "application/octet-stream" }),
    filename: `${name.replace(/\.[^.]+$/, "")}${ctx.suffix}.${ext}`,
    mime: "application/pdf", extension: ext, sizeBytes: 1, checks: [], warnings: [], fidelity: "high",
  };
}

/** Deterministic fake engine: every call is recorded and resolved manually (or immediately). */
function fakeEngine(opts: { manual?: boolean; fail?: (name: string, attempt: number) => Error | undefined } = {}) {
  const calls: { name: string; ctx: ConvertContext; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const attempts = new Map<string, number>();
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const deps: BatchDeps = {
    fingerprint: async (f) => `${f.size}:${await f.text()}`,
    convert: (item: QueueItem, ctx) =>
      new Promise<ConversionOutput>((resolve, reject) => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(item.name);
        const n = (attempts.get(item.name) ?? 0) + 1;
        attempts.set(item.name, n);
        ctx.signal.addEventListener("abort", () => {
          active--;
          reject(new DOMException("Cancelled", "AbortError"));
        });
        const finish = () => {
          const err = opts.fail?.(item.name, n);
          if (ctx.signal.aborted) return;
          active--;
          if (err) reject(err);
          else resolve(output(item.name, ctx));
        };
        ctx.onStage("rendering");
        const call = { name: item.name, ctx, resolve: finish, reject };
        calls.push(call);
        if (!opts.manual) queueMicrotask(finish);
      }),
  };
  return { deps, calls, order, get maxActive() { return maxActive; } };
}

const make = (engine: ReturnType<typeof fakeEngine>, over: Partial<SharedSettings> = {}, limits = BATCH_LIMITS.balanced) =>
  new BatchQueue(engine.deps, { limits, shared: shared(over), processing: "balanced" });

const names = (q: BatchQueue) => q.getSnapshot().items.map((i) => i.name);
const status = (q: BatchQueue, name: string) => q.getSnapshot().items.find((i) => i.name === name)!.status;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("intake", () => {
  it("accepts several files at once and validates each individually", async () => {
    const q = make(fakeEngine());
    const rep = await q.addFiles([file("a.txt"), file("b.md", "# hi"), file("c.zip", "PK"), file("d.csv", "a,b\n1,2"), file("e.txt", 0)]);
    expect(rep.added).toBe(3);
    expect(rep.rejected.map((r) => r.name).sort()).toEqual(["c.zip", "e.txt"]);
    const items = q.getSnapshot().items;
    expect(items.filter((i) => i.status === "rejected")).toHaveLength(2);
    expect(items.find((i) => i.name === "c.zip")!.rejectReason).toMatch(/\.zip files are not supported/);
    expect(items.filter((i) => i.status === "queued").map((i) => i.name)).toEqual(["a.txt", "b.md", "d.csv"]);
  });

  it("rejects binary files disguised as text and fake images", async () => {
    const q = make(fakeEngine());
    const bin = new File([new Uint8Array([1, 2, 0, 3])], "x.txt");
    const fake = new File([new Uint8Array([1, 2, 3, 4, 5])], "x.png");
    const rep = await q.addFiles([bin, fake, file("ok.txt")]);
    expect(rep.added).toBe(1);
    expect(rep.rejected).toHaveLength(2);
  });

  it("detects exact duplicates but keeps same-name files with different content", async () => {
    const q = make(fakeEngine());
    await q.addFiles([file("a.txt", "same")]);
    const rep = await q.addFiles([file("copy of a.txt", "same"), file("a.txt", "diff!"), file("b.txt", "same")]);
    expect(rep.duplicates.map((d) => d.name).sort()).toEqual(["b.txt", "copy of a.txt"]);
    expect(rep.added).toBe(1);
    expect(names(q)).toEqual(["a.txt", "a.txt"]);
    expect(q.getSnapshot().notices[0]).toMatch(/Skipped 2 duplicate/);
  });

  it("enforces file-count and combined-size limits without blocking valid files", async () => {
    const q = make(fakeEngine(), {}, { maxFiles: 3, maxTotalBytes: 100 });
    const rep = await q.addFiles([file("1.txt", 40), file("2.txt", 40), file("3.txt", 40), file("4.txt", 5), file("5.txt", 10)]);
    expect(names(q).filter((n) => status(q, n) !== "rejected")).toEqual(["1.txt", "2.txt", "4.txt"]);
    expect(rep.rejected.find((r) => r.name === "3.txt")!.reason).toMatch(/combined size/);
    expect(rep.rejected.find((r) => r.name === "5.txt")!.reason).toMatch(/at most 3 files/);
  });

  it("serializes concurrent adds so limits hold", async () => {
    const q = make(fakeEngine(), {}, { maxFiles: 2, maxTotalBytes: 1e6 });
    await Promise.all([q.addFiles([file("a.txt", "1")]), q.addFiles([file("b.txt", "22")]), q.addFiles([file("c.txt", "333")])]);
    expect(q.getSnapshot().items.filter((i) => i.status === "queued")).toHaveLength(2);
  });

  it("caps the number of visible rejected rows", async () => {
    const q = make(fakeEngine());
    await q.addFiles(Array.from({ length: 30 }, (_, i) => file(`bad${i}.exe`, "x")));
    expect(q.getSnapshot().items).toHaveLength(20);
    expect(q.getSnapshot().notices.join(" ")).toMatch(/10 more files/);
  });
});

describe("ordering and list editing", () => {
  it("reorders with move and moveTo and removes", async () => {
    const q = make(fakeEngine());
    await q.addFiles([file("a.txt", "1"), file("b.txt", "2"), file("c.txt", "3")]);
    const id = (n: string) => q.getSnapshot().items.find((i) => i.name === n)!.id;
    q.move(id("c.txt"), -1);
    expect(names(q)).toEqual(["a.txt", "c.txt", "b.txt"]);
    q.moveTo(id("b.txt"), 0);
    expect(names(q)).toEqual(["b.txt", "a.txt", "c.txt"]);
    q.move(id("b.txt"), -1);
    expect(names(q)).toEqual(["b.txt", "a.txt", "c.txt"]);
    q.remove(id("a.txt"));
    expect(names(q)).toEqual(["b.txt", "c.txt"]);
    q.clear();
    expect(names(q)).toEqual([]);
  });
});

describe("sequential execution", () => {
  it("runs in list order, one at a time", async () => {
    const e = fakeEngine();
    const q = make(e);
    await q.addFiles([file("a.txt", "1"), file("b.txt", "22"), file("c.txt", "333")]);
    const id = q.getSnapshot().items.find((i) => i.name === "c.txt")!.id;
    q.moveTo(id, 0);
    q.start();
    await q.idle();
    expect(e.order).toEqual(["c.txt", "a.txt", "b.txt"]);
    expect(e.maxActive).toBe(1);
    expect(q.getSnapshot().run).toBe("finished");
    expect(summarize(q.getSnapshot()).done).toBe(3);
  });

  it("does not start duplicate jobs on repeated start/retry", async () => {
    const e = fakeEngine({ manual: true });
    const q = make(e);
    await q.addFiles([file("a.txt", "1"), file("b.txt", "22")]);
    q.start();
    q.start();
    q.start();
    await tick();
    expect(e.calls).toHaveLength(1);
    q.retry(q.getSnapshot().items[0]!.id); // converting: ignored
    await tick();
    expect(e.calls).toHaveLength(1);
    e.calls[0]!.resolve();
    await tick();
    expect(e.calls).toHaveLength(2);
    e.calls[1]!.resolve();
    await q.idle();
    expect(e.order).toEqual(["a.txt", "b.txt"]);
  });

  it("reports the real stage and processes files added while running", async () => {
    const e = fakeEngine({ manual: true });
    const q = make(e);
    await q.addFiles([file("a.txt", "1")]);
    q.start();
    await tick();
    expect(q.getSnapshot().items[0]).toMatchObject({ status: "converting", stage: "rendering" });
    await q.addFiles([file("late.txt", "zz")]);
    e.calls[0]!.resolve();
    await tick();
    e.calls[1]!.resolve();
    await q.idle();
    expect(e.order).toEqual(["a.txt", "late.txt"]);
  });
});

describe("failures and retry", () => {
  it("keeps going after a failure and retries only the failed file", async () => {
    const e = fakeEngine({ fail: (n, attempt) => (n === "b.txt" && attempt === 1 ? new FileForgeError("boom", "Could not parse b.txt", true) : undefined) });
    const q = make(e);
    await q.addFiles([file("a.txt", "1"), file("b.txt", "22"), file("c.txt", "333")]);
    q.start();
    await q.idle();
    expect([status(q, "a.txt"), status(q, "b.txt"), status(q, "c.txt")]).toEqual(["done", "failed", "done"]);
    const b = q.getSnapshot().items[1]!;
    expect(b.error).toBe("Could not parse b.txt");
    expect(b.errorRetryable).toBe(true);
    q.retry(b.id);
    await q.idle();
    expect(status(q, "b.txt")).toBe("done");
    expect(e.order).toEqual(["a.txt", "b.txt", "c.txt", "b.txt"]);
    expect(q.getSnapshot().items[1]!.attempts).toBe(2);
  });

  it("retryFailed re-queues every failed file", async () => {
    const e = fakeEngine({ fail: (_n, attempt) => (attempt === 1 ? new Error("x") : undefined) });
    const q = make(e);
    await q.addFiles([file("a.txt", "1"), file("b.txt", "22")]);
    q.start();
    await q.idle();
    expect(summarize(q.getSnapshot()).failed).toBe(2);
    q.retryFailed();
    await q.idle();
    expect(summarize(q.getSnapshot()).done).toBe(2);
  });
});

describe("pause, resume, cancel", () => {
  it("pauses between files and resumes", async () => {
    const e = fakeEngine({ manual: true });
    const q = make(e);
    await q.addFiles([file("a.txt", "1"), file("b.txt", "22"), file("c.txt", "333")]);
    q.start();
    await tick();
    q.pause();
    expect(q.getSnapshot().run).toBe("pausing");
    e.calls[0]!.resolve();
    await q.idle();
    expect(q.getSnapshot().run).toBe("paused");
    expect(status(q, "a.txt")).toBe("done");
    expect(status(q, "b.txt")).toBe("queued");
    expect(e.calls).toHaveLength(1);
    q.resume();
    await tick();
    expect(e.calls).toHaveLength(2);
    e.calls[1]!.resolve();
    await tick();
    e.calls[2]!.resolve();
    await q.idle();
    expect(q.getSnapshot().run).toBe("finished");
  });

  it("resuming while pausing cancels the pause", async () => {
    const e = fakeEngine({ manual: true });
    const q = make(e);
    await q.addFiles([file("a.txt", "1"), file("b.txt", "22")]);
    q.start();
    await tick();
    q.pause();
    q.resume();
    expect(q.getSnapshot().run).toBe("running");
    e.calls[0]!.resolve();
    await tick();
    expect(e.calls).toHaveLength(2);
    e.calls[1]!.resolve();
    await q.idle();
  });

  it("cancels the active file only and continues with the next", async () => {
    const e = fakeEngine({ manual: true });
    const q = make(e);
    await q.addFiles([file("a.txt", "1"), file("b.txt", "22")]);
    q.start();
    await tick();
    q.cancelItem(q.getSnapshot().items[0]!.id);
    await tick();
    expect(status(q, "a.txt")).toBe("cancelled");
    expect(e.calls[0]!.ctx.signal.aborted).toBe(true);
    expect(e.calls).toHaveLength(2);
    e.calls[1]!.resolve();
    await q.idle();
    expect(status(q, "b.txt")).toBe("done");
  });

  it("cancelAll aborts the active file, cancels waiting ones and keeps finished outputs", async () => {
    const e = fakeEngine({ manual: true });
    const q = make(e);
    await q.addFiles([file("a.txt", "1"), file("b.txt", "22"), file("c.txt", "333")]);
    q.start();
    await tick();
    e.calls[0]!.resolve();
    await tick();
    q.cancelAll();
    await q.idle();
    expect([status(q, "a.txt"), status(q, "b.txt"), status(q, "c.txt")]).toEqual(["done", "cancelled", "cancelled"]);
    expect(q.getSnapshot().items[0]!.output).toBeDefined();
    expect(q.getSnapshot().run).toBe("finished");
    // cancelled files can be retried
    q.retry(q.getSnapshot().items[1]!.id);
    await tick();
    expect(e.calls.at(-1)!.name).toBe("b.txt");
    e.calls.at(-1)!.resolve();
    await q.idle();
    expect(status(q, "b.txt")).toBe("done");
  });

  it("clear while converting aborts and leaves an empty, idle queue", async () => {
    const e = fakeEngine({ manual: true });
    const q = make(e);
    await q.addFiles([file("a.txt", "1")]);
    q.start();
    await tick();
    q.clear();
    await q.idle();
    expect(q.getSnapshot().items).toEqual([]);
    expect(q.getSnapshot().run).toBe("idle");
    expect(e.calls[0]!.ctx.signal.aborted).toBe(true);
  });
});

describe("settings", () => {
  it("applies shared settings and per-file overrides to each conversion", async () => {
    const e = fakeEngine();
    const q = make(e, { suffix: "_x" });
    await q.addFiles([file("a.txt", "1"), file("b.md", "22"), file("c.csv", "a,b\n1,2")]);
    const id = (n: string) => q.getSnapshot().items.find((i) => i.name === n)!.id;
    q.setShared({ output: "docx", page: { pageSize: "LETTER" } });
    q.setOverride(id("b.md"), { output: "pdf", orientation: "landscape", margins: "narrow" });
    const seen = new Map<string, ConvertContext>();
    const orig = e.deps.convert;
    e.deps.convert = (item, ctx) => (seen.set(item.name, ctx), orig(item, ctx));
    q.start();
    await q.idle();
    expect(seen.get("a.txt")).toMatchObject({ output: "docx", suffix: "_x", settings: { pageSize: "LETTER", orientation: "portrait", margins: "normal" } });
    expect(seen.get("b.md")).toMatchObject({ output: "pdf", settings: { pageSize: "LETTER", orientation: "landscape", margins: "narrow" } });
    expect(q.getSnapshot().items.map((i) => i.output?.filename)).toEqual(["a_x.docx", "b_x.pdf", "c_x.docx"]);
  });

  it("explains and skips files the selected format can't produce, without failing the batch", async () => {
    const e = fakeEngine();
    const q = make(e, { output: "docx" });
    await q.addFiles([file("a.txt", "1"), new File([new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 10, 0, 10, 3, 1, 0x22, 0, 2, 0x11, 0, 3, 0x11, 0])], "p.jpg")]);
    const snap = q.getSnapshot();
    const img = snap.items.find((i) => i.name === "p.jpg")!;
    expect(eligibility(img, snap.shared)).toMatchObject({ ok: false });
    expect((eligibility(img, snap.shared) as { reason: string }).reason).toMatch(/only be converted to PDF/);
    q.start();
    await q.idle();
    expect(e.order).toEqual(["a.txt"]);
    expect(status(q, "p.jpg")).toBe("queued");
    expect(summarize(q.getSnapshot())).toMatchObject({ done: 1, blocked: 1, failed: 0 });
    q.setOverride(img.id, { output: "pdf" });
    expect(eligibility(q.getSnapshot().items[1]!, q.getSnapshot().shared)).toEqual({ ok: true });
    q.start();
    await q.idle();
    expect(status(q, "p.jpg")).toBe("done");
  });

  it("gives colliding outputs unique names", async () => {
    const e = fakeEngine();
    const q = make(e);
    await q.addFiles([file("report.txt", "one"), file("report.md", "two"), file("Report.csv", "a,b")]);
    q.start();
    await q.idle();
    expect(q.getSnapshot().items.map((i) => i.output!.filename)).toEqual(["report.pdf", "report (2).pdf", "Report (3).pdf"]);
  });
});

describe("naming helpers", () => {
  it("uniqueName is case-insensitive and keeps extensions", () => {
    const taken = new Set<string>();
    expect([uniqueName("a.pdf", taken), uniqueName("A.pdf", taken), uniqueName("a.pdf", taken), uniqueName("noext", taken), uniqueName("noext", taken)]).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf", "noext", "noext (2)"]);
  });
  it("sanitizes file and entry names", () => {
    expect(sanitizeFileName('a/b\\c:d*e?"f<g>h|.pdf')).toBe("a_b_c_d_e_f_g_h_.pdf");
    expect(sanitizeFileName("CON.pdf")).toBe("_CON.pdf");
    expect(sanitizeFileName("  .hidden. .pdf")).toBe("hidden.pdf");
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("é".repeat(300) + ".pdf").length).toBeLessThanOrEqual(124);
    expect(sanitizeEntryName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeEntryName("C:\\x\\y.pdf")).toBe("y.pdf");
    expect(sanitizeEntryName("a.pdf", "originals")).toBe("originals/a.pdf");
  });
  it("zipFileName always ends in a single .zip", () => {
    expect(zipFileName("my files")).toBe("my files.zip");
    expect(zipFileName("x.ZIP")).toBe("x.zip");
    expect(zipFileName("   ")).toBe("fileforge-converted.zip");
    expect(zipFileName("a/b")).toBe("a_b.zip");
  });
});

describe("batch limits", () => {
  it("lowers limits on low-memory devices", () => {
    expect(effectiveBatchLimits("balanced").limits).toEqual({ maxFiles: 10, maxTotalBytes: 50 * 1024 * 1024 });
    expect(effectiveBatchLimits("balanced", 2).limits.maxFiles).toBe(5);
    expect(effectiveBatchLimits("balanced", 2).warning).toMatch(/lowered/);
    expect(effectiveBatchLimits("balanced", 4).warning).toMatch(/slow/);
    expect(effectiveBatchLimits("balanced", 8).warning).toBeUndefined();
    expect(effectiveBatchLimits("conservative", 8).limits.maxFiles).toBe(5);
  });
});
