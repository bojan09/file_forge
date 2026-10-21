import { getFormat } from "../registry";
import { FileForgeError, type OutputFormat, type PageSettings, type Processing } from "../types";
import { sha256, validateIntake } from "./intake";
import { uniqueName } from "./naming";
import type { AddReport, BatchDeps, BatchLimits, BatchSnapshot, ItemOverrides, QueueItem, RunState, SharedSettings } from "./types";

const MB = 1024 * 1024;
/** Rejected rows kept visible; more than this are summarized in one notice. */
const MAX_REJECTED_ROWS = 20;

let idCounter = 0;
const newId = () => `q${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export const effectiveOutput = (item: Pick<QueueItem, "overrides">, shared: SharedSettings): OutputFormat => item.overrides.output ?? shared.output;

export function effectiveSettings(item: Pick<QueueItem, "overrides">, shared: SharedSettings): PageSettings {
  const o = item.overrides;
  return {
    pageSize: o.pageSize ?? shared.page.pageSize,
    orientation: o.orientation ?? shared.page.orientation,
    margins: o.margins ?? shared.page.margins,
    imageQuality: o.imageQuality ?? shared.page.imageQuality,
    imageFit: o.imageFit ?? shared.page.imageFit,
  };
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

/** Whether a file can be converted to the output selected for it, and if not, why. */
export function eligibility(item: Pick<QueueItem, "kind" | "rejectReason" | "overrides">, shared: SharedSettings): Eligibility {
  if (!item.kind) return { ok: false, reason: item.rejectReason ?? "This file type is not supported." };
  const fmt = getFormat(item.kind);
  const out = effectiveOutput(item, shared);
  if (!fmt.outputs.includes(out)) {
    return {
      ok: false,
      reason:
        item.kind === "image"
          ? "Images can only be converted to PDF. Choose PDF for this file (or for the whole batch)."
          : `${fmt.label} can't be converted to ${out.toUpperCase()}.`,
    };
  }
  return { ok: true };
}

export interface BatchSummary {
  total: number;
  queued: number;
  converting: number;
  done: number;
  failed: number;
  cancelled: number;
  rejected: number;
  /** Queued files that the selected output can't produce; they are skipped, not failed. */
  blocked: number;
  outputBytes: number;
  inputBytes: number;
}

export function summarize(s: Pick<BatchSnapshot, "items" | "shared">): BatchSummary {
  const sum: BatchSummary = { total: 0, queued: 0, converting: 0, done: 0, failed: 0, cancelled: 0, rejected: 0, blocked: 0, outputBytes: 0, inputBytes: 0 };
  for (const it of s.items) {
    if (it.status === "rejected") {
      sum.rejected++;
      continue;
    }
    sum.total++;
    sum.inputBytes += it.sizeBytes;
    sum[it.status]++;
    if (it.status === "queued" && !eligibility(it, s.shared).ok) sum.blocked++;
    if (it.output) sum.outputBytes += it.output.sizeBytes;
  }
  return sum;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export interface BatchOptions {
  limits: BatchLimits;
  shared: SharedSettings;
  processing: Processing;
}

/**
 * Framework-independent conversion queue. Files convert strictly one at a time, in list order.
 * The actual conversion is injected (`deps.convert`) so the queue logic is testable without a browser.
 */
export class BatchQueue {
  private snap: BatchSnapshot;
  private listeners = new Set<() => void>();
  private controllers = new Map<string, AbortController>();
  private loop: Promise<void> | null = null;
  private pauseRequested = false;
  private intakeChain: Promise<unknown> = Promise.resolve();
  private fingerprints = new WeakMap<File, Promise<string>>();
  private processing: Processing;
  private disposed = false;

  constructor(
    private deps: BatchDeps,
    opts: BatchOptions,
  ) {
    this.processing = opts.processing;
    this.snap = { items: [], shared: opts.shared, run: "idle", limits: opts.limits, announcement: "", announceSeq: 0, notices: [] };
  }

  // ---- store plumbing ----------------------------------------------------
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<BatchSnapshot>) {
    if (this.disposed) return;
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  private announce(message: string) {
    this.set({ announcement: message, announceSeq: this.snap.announceSeq + 1 });
  }

  private patchItem(id: string, patch: Partial<QueueItem>) {
    if (!this.snap.items.some((i) => i.id === id)) return;
    this.set({ items: this.snap.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }

  private get(id: string) {
    return this.snap.items.find((i) => i.id === id);
  }

  // ---- configuration -----------------------------------------------------
  setLimits(limits: BatchLimits, processing: Processing) {
    this.processing = processing;
    this.set({ limits });
  }

  /** Changes batch-wide settings. They apply to files that have not started converting yet. */
  setShared(patch: { output?: OutputFormat; suffix?: string; page?: Partial<PageSettings> }) {
    const { page, ...rest } = patch;
    this.set({ shared: { ...this.snap.shared, ...rest, page: { ...this.snap.shared.page, ...page } } });
  }

  setOverride(id: string, patch: ItemOverrides | null) {
    const it = this.get(id);
    if (!it) return;
    const next: ItemOverrides = patch === null ? {} : { ...it.overrides, ...patch };
    for (const k of Object.keys(next) as (keyof ItemOverrides)[]) if (next[k] === undefined) delete next[k];
    this.patchItem(id, { overrides: next });
  }

  dismissNotices() {
    this.set({ notices: [] });
  }

  // ---- intake ------------------------------------------------------------
  addFiles(files: File[]): Promise<AddReport> {
    const run = this.intakeChain.then(() => this.intake(files));
    this.intakeChain = run.catch(() => undefined);
    return run;
  }

  private fingerprint(file: File): Promise<string> {
    let p = this.fingerprints.get(file);
    if (!p) {
      p = (this.deps.fingerprint ?? sha256)(file);
      this.fingerprints.set(file, p);
    }
    return p;
  }

  private async findDuplicate(file: File, accepted: QueueItem[]): Promise<QueueItem | undefined> {
    for (const other of accepted) {
      if (other.sizeBytes !== file.size) continue;
      try {
        const [a, b] = await Promise.all([this.fingerprint(file), this.fingerprint(other.file)]);
        if (a === b) return other;
      } catch {
        if (other.name === file.name && other.file.lastModified === file.lastModified) return other;
      }
    }
    return undefined;
  }

  private async intake(files: File[]): Promise<AddReport> {
    const report: AddReport = { added: 0, rejected: [], duplicates: [] };
    let hiddenRejects = 0;
    const reject = (file: File, reason: string) => {
      report.rejected.push({ name: file.name, reason });
      const shown = this.snap.items.filter((i) => i.status === "rejected").length;
      if (shown >= MAX_REJECTED_ROWS) {
        hiddenRejects++;
        return;
      }
      const item: QueueItem = {
        id: newId(), file, name: file.name, sizeBytes: file.size, kind: null, extension: "", status: "rejected",
        rejectReason: reason, overrides: {}, attempts: 0,
      };
      this.set({ items: [...this.snap.items, item] });
    };

    for (const file of files) {
      if (this.disposed) break;
      let kind: QueueItem["kind"];
      let extension: string;
      try {
        const v = await validateIntake(file, this.processing);
        kind = v.format.id;
        extension = v.extension;
      } catch (e) {
        reject(file, e instanceof FileForgeError ? e.message : "This file couldn't be read.");
        continue;
      }
      const accepted = this.snap.items.filter((i) => i.status !== "rejected");
      const { maxFiles, maxTotalBytes } = this.snap.limits;
      if (accepted.length >= maxFiles) {
        reject(file, `Batch limit reached: at most ${maxFiles} files at a time.`);
        continue;
      }
      const total = accepted.reduce((n, i) => n + i.sizeBytes, 0);
      if (total + file.size > maxTotalBytes) {
        reject(file, `Adding this file would exceed the ${Math.round(maxTotalBytes / MB)} MB combined size limit.`);
        continue;
      }
      const dup = await this.findDuplicate(file, accepted);
      if (dup) {
        report.duplicates.push({ name: file.name, of: dup.name });
        continue;
      }
      const item: QueueItem = { id: newId(), file, name: file.name, sizeBytes: file.size, kind, extension, status: "queued", overrides: {}, attempts: 0 };
      this.set({ items: [...this.snap.items, item], run: this.snap.run === "finished" ? "idle" : this.snap.run });
      report.added++;
    }

    const notices = [...this.snap.notices];
    if (report.duplicates.length) notices.push(`Skipped ${report.duplicates.length} duplicate file${report.duplicates.length > 1 ? "s" : ""}: ${report.duplicates.map((d) => `${d.name} (same as ${d.of})`).join(", ")}.`);
    if (hiddenRejects) notices.push(`${hiddenRejects} more file${hiddenRejects > 1 ? "s were" : " was"} not supported or over the limits and not listed.`);
    if (notices.length !== this.snap.notices.length) this.set({ notices });
    const bits = [`${report.added} file${report.added === 1 ? "" : "s"} added`];
    if (report.rejected.length) bits.push(`${report.rejected.length} not accepted`);
    if (report.duplicates.length) bits.push(`${report.duplicates.length} duplicate${report.duplicates.length === 1 ? "" : "s"} skipped`);
    this.announce(bits.join(", "));
    return report;
  }

  // ---- list editing --------------------------------------------------------
  remove(id: string) {
    const it = this.get(id);
    if (!it) return;
    this.controllers.get(id)?.abort();
    this.set({ items: this.snap.items.filter((i) => i.id !== id) });
    this.announce(`${it.name} removed`);
  }

  /** Removes everything, cancelling active work and dropping all outputs. */
  clear() {
    this.pauseRequested = false;
    this.controllers.forEach((c) => c.abort());
    this.set({ items: [], run: "idle", notices: [] });
    this.announce("Queue cleared");
  }

  clearRejected() {
    this.set({ items: this.snap.items.filter((i) => i.status !== "rejected") });
  }

  /** Moves an item to `toIndex` within the list. Position only changes processing order for files not yet started. */
  moveTo(id: string, toIndex: number) {
    const items = [...this.snap.items];
    const from = items.findIndex((i) => i.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(items.length - 1, toIndex));
    if (from === to) return;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it!);
    this.set({ items });
    this.announce(`${it!.name} moved to position ${to + 1} of ${items.length}`);
  }

  move(id: string, delta: -1 | 1) {
    const idx = this.snap.items.findIndex((i) => i.id === id);
    if (idx >= 0) this.moveTo(id, idx + delta);
  }

  // ---- running -------------------------------------------------------------
  private runnable() {
    return this.snap.items.find((i) => i.status === "queued" && eligibility(i, this.snap.shared).ok);
  }

  hasRunnable(): boolean {
    return !!this.runnable();
  }

  start() {
    if (this.loop || this.disposed) return;
    if (!this.runnable()) return;
    this.pauseRequested = false;
    this.set({ run: "running" });
    this.loop = this.runLoop().finally(() => {
      this.loop = null;
    });
  }

  private async runLoop() {
    for (;;) {
      if (this.disposed) return;
      if (this.pauseRequested) {
        this.pauseRequested = false;
        this.set({ run: "paused" });
        this.announce("Paused. The current file finished; the rest are waiting.");
        return;
      }
      const next = this.runnable();
      if (!next) break;
      await this.runItem(next.id);
    }
    if (!this.snap.items.length) {
      this.set({ run: "idle" });
      return;
    }
    this.set({ run: "finished" });
    const s = summarize(this.snap);
    this.announce(`Batch finished: ${s.done} converted${s.failed ? `, ${s.failed} failed` : ""}${s.cancelled ? `, ${s.cancelled} cancelled` : ""}${s.blocked ? `, ${s.blocked} skipped` : ""}.`);
  }

  private async runItem(id: string) {
    const item = this.get(id);
    if (!item || item.status !== "queued") return; // never start a job twice
    const { shared } = this.snap;
    const ac = new AbortController();
    this.controllers.set(id, ac);
    this.patchItem(id, { status: "converting", stage: "reading", error: undefined, errorRetryable: undefined, output: undefined, attempts: item.attempts + 1 });
    this.announce(`Converting ${item.name}`);
    try {
      const result = await this.deps.convert(item, {
        output: effectiveOutput(item, shared),
        settings: effectiveSettings(item, shared),
        suffix: shared.suffix,
        signal: ac.signal,
        onStage: (stage) => {
          if (this.get(id)?.status === "converting") this.patchItem(id, { stage });
        },
      });
      if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const taken = new Set(this.snap.items.filter((i) => i.id !== id && i.output).map((i) => i.output!.filename.toLowerCase()));
      const filename = uniqueName(result.filename, taken);
      this.patchItem(id, { status: "done", stage: undefined, output: { ...result, filename } });
      this.announce(`${item.name} converted to ${filename}`);
    } catch (e) {
      if (isAbort(e) || ac.signal.aborted) {
        this.patchItem(id, { status: "cancelled", stage: undefined });
        this.announce(`${item.name} cancelled`);
      } else {
        const message = e instanceof Error && e.message ? (e instanceof FileForgeError ? e.message : `Something went wrong while converting this file. (${e.message})`) : "Conversion failed.";
        this.patchItem(id, { status: "failed", stage: undefined, error: message, errorRetryable: e instanceof FileForgeError ? e.retryable : true });
        this.announce(`${item.name} failed: ${message}`);
      }
    } finally {
      this.controllers.delete(id);
    }
  }

  pause() {
    if (this.snap.run === "running") {
      this.pauseRequested = true;
      this.set({ run: "pausing" });
      this.announce("Pausing after the current file");
    }
  }

  resume() {
    if (this.snap.run === "pausing") {
      this.pauseRequested = false;
      this.set({ run: "running" });
      return;
    }
    if (this.snap.run === "paused") this.start();
  }

  /** Cancels the active file (if any) and every file still waiting. Finished outputs are kept. */
  cancelAll() {
    this.pauseRequested = false;
    this.set({ items: this.snap.items.map((i) => (i.status === "queued" ? { ...i, status: "cancelled" as const } : i)) });
    this.controllers.forEach((c) => c.abort());
    if (!this.loop) this.set({ run: this.snap.items.some((i) => i.output) ? "finished" : "idle" });
    this.announce("Cancelled remaining files");
  }

  /** Cancels one file. The queue continues with the next. */
  cancelItem(id: string) {
    const it = this.get(id);
    if (!it) return;
    if (it.status === "converting") this.controllers.get(id)?.abort();
    else if (it.status === "queued") {
      this.patchItem(id, { status: "cancelled" });
      this.announce(`${it.name} cancelled`);
    }
  }

  /** Puts a failed, cancelled or finished file back in the queue and runs it. */
  retry(id: string) {
    const it = this.get(id);
    if (!it || !(it.status === "failed" || it.status === "cancelled" || it.status === "done")) return;
    this.patchItem(id, { status: "queued", error: undefined, errorRetryable: undefined, output: undefined, stage: undefined });
    if (this.snap.run === "finished" || this.snap.run === "idle") this.start();
  }

  retryFailed() {
    const ids = this.snap.items.filter((i) => i.status === "failed").map((i) => i.id);
    this.set({ items: this.snap.items.map((i) => (ids.includes(i.id) ? { ...i, status: "queued" as const, error: undefined, errorRetryable: undefined } : i)) });
    if (ids.length && (this.snap.run === "finished" || this.snap.run === "idle")) this.start();
  }

  /** Queues every cancelled file again. */
  requeueCancelled() {
    this.set({ items: this.snap.items.map((i) => (i.status === "cancelled" ? { ...i, status: "queued" as const } : i)), run: this.snap.run === "finished" ? "idle" : this.snap.run });
  }

  /** Resolves when the running loop (if any) has stopped. For tests and shutdown. */
  async idle() {
    while (this.loop) await this.loop;
  }

  dispose() {
    this.controllers.forEach((c) => c.abort());
    this.disposed = true;
    this.listeners.clear();
  }
}
