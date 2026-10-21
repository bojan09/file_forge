import { jpegInfo, prepareImage } from "../prep-image";
import { pageDims } from "../page";
import type { RenderResult } from "../types";
import { FileForgeError, type ImageFit, type ImageQuality, type MarginName, type Orientation, type PageSizeName, type PreparedImage, type QualityCheck, type RenderJob } from "../types";
import { checkImageBytes, readImageSize, sniffImage, type ImageType } from "../validate";
import { sha256 } from "./intake";
import { sanitizeFileName } from "./naming";
import { renderJob } from "../worker-client";
import type { BatchLimits } from "./types";

export type MergeFit = Extract<ImageFit, "fit"> | "fill";

export interface MergeSettings {
  pageSize: PageSizeName;
  orientation: Orientation | "auto";
  margins: MarginName;
  fit: MergeFit;
  quality: ImageQuality;
  /** Output file name without extension. */
  name: string;
}

export interface MergeItem {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  type: ImageType;
  /** Displayed size after applying EXIF orientation. */
  width: number;
  height: number;
  thumbUrl?: string;
  hasAlpha?: boolean;
}

export type MergePhase = "idle" | "preparing" | "rendering" | "verifying" | "done" | "error";

export interface MergeResult {
  blob: Blob;
  filename: string;
  sizeBytes: number;
  pageCount: number;
  checks: QualityCheck[];
}

export interface MergeSnapshot {
  items: MergeItem[];
  settings: MergeSettings;
  phase: MergePhase;
  /** Images prepared so far (a real count) while phase is "preparing". */
  prepared: number;
  result?: MergeResult;
  error?: string;
  notices: string[];
  announcement: string;
  announceSeq: number;
  limits: BatchLimits;
}

export interface MergeDeps {
  prepare: (item: MergeItem, quality: ImageQuality, signal: AbortSignal, crop?: (w: number, h: number) => number | null) => Promise<PreparedImage>;
  render: (job: RenderJob, opts: { signal: AbortSignal; onStage: (s: "rendering" | "verifying") => void }) => Promise<RenderResult>;
  thumbnail?: (file: File) => Promise<string | undefined>;
}

const MB = 1024 * 1024;
const abortError = () => new DOMException("Cancelled", "AbortError");

export function orientedDimensions(bytes: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const size = readImageSize(bytes, type);
  if (!size) return null;
  if (type === "jpeg" && jpegInfo(bytes).orientation >= 5) return { width: size.height, height: size.width };
  return size;
}

async function browserThumbnail(file: File): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.8));
    return blob ? URL.createObjectURL(blob) : undefined;
  } catch {
    return undefined;
  }
}

export function createDefaultMergeDeps(): MergeDeps {
  return {
    prepare: async (item, quality, signal, crop) => prepareImage(new Uint8Array(await item.file.arrayBuffer()), item.type, quality, signal, { crop }),
    render: (job, opts) => renderJob(job, { signal: opts.signal, onStage: (s) => s !== "reading" && opts.onStage(s) }),
    thumbnail: browserThumbnail,
  };
}

/** Test/Node variant: no canvas, no worker. */
export const directRender: MergeDeps["render"] = async (job, opts) => (await import("../render")).runRender(job, (s) => s !== "reading" && opts.onStage(s));

let counter = 0;
const newId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Ordered list of images that become one PDF, one image per page. Framework-independent store.
 */
export class MergeList {
  private snap: MergeSnapshot;
  private listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private ac: AbortController | null = null;
  private disposed = false;

  constructor(
    private deps: MergeDeps,
    init: { limits: BatchLimits; settings: MergeSettings },
    private processing: "balanced" | "conservative" = "balanced",
  ) {
    this.snap = { items: [], settings: init.settings, phase: "idle", prepared: 0, notices: [], announcement: "", announceSeq: 0, limits: init.limits };
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;

  private set(p: Partial<MergeSnapshot>) {
    if (this.disposed) return;
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }
  private announce(m: string) {
    this.set({ announcement: m, announceSeq: this.snap.announceSeq + 1 });
  }

  setLimits(limits: BatchLimits, processing: "balanced" | "conservative") {
    this.processing = processing;
    this.set({ limits });
  }

  setSettings(patch: Partial<MergeSettings>) {
    // Any change invalidates a finished result: the PDF no longer matches the settings.
    this.set({ settings: { ...this.snap.settings, ...patch }, ...(this.snap.phase === "done" ? { phase: "idle" as const, result: undefined } : {}) });
  }

  dismissNotices() {
    this.set({ notices: [] });
  }

  addFiles(files: File[]) {
    const run = this.chain.then(() => this.intake(files));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async intake(files: File[]) {
    const problems: string[] = [];
    const dups: string[] = [];
    let added = 0;
    for (const file of files) {
      if (this.disposed) return { added, problems, duplicates: dups };
      try {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!["jpg", "jpeg", "png", "webp"].includes(ext)) throw new FileForgeError("not-image", `${file.name}: only JPG, PNG and WebP images can be merged.`);
        if (file.size === 0) throw new FileForgeError("empty", `${file.name}: the file is empty.`);
        if (file.size > 15 * MB) throw new FileForgeError("too-large", `${file.name}: images are limited to 15 MB each.`);
        const head = new Uint8Array(await file.slice(0, MB).arrayBuffer());
        const info = checkImageBytes(head, ext === "jpg" ? "jpg" : ext, this.processing);
        const type = info.type;
        const dims = orientedDimensions(head, type) ?? { width: info.width, height: info.height };
        const { maxFiles, maxTotalBytes } = this.snap.limits;
        if (this.snap.items.length >= maxFiles) throw new FileForgeError("limit", `${file.name}: at most ${maxFiles} images can be merged at once.`);
        if (this.snap.items.reduce((n, i) => n + i.sizeBytes, 0) + file.size > maxTotalBytes) throw new FileForgeError("limit", `${file.name}: would exceed the ${Math.round(maxTotalBytes / MB)} MB combined size limit.`);
        const same = this.snap.items.filter((i) => i.sizeBytes === file.size);
        let dup: MergeItem | undefined;
        if (same.length) {
          const h = await sha256(file).catch(() => "");
          for (const o of same) if (h && h === (await sha256(o.file).catch(() => "x"))) dup = o;
        }
        if (dup) {
          dups.push(`${file.name} (same as ${dup.name})`);
          continue;
        }
        const item: MergeItem = { id: newId(), file, name: file.name, sizeBytes: file.size, type, width: dims.width, height: dims.height };
        this.set({ items: [...this.snap.items, item], ...(this.snap.phase === "done" || this.snap.phase === "error" ? { phase: "idle" as const, result: undefined, error: undefined } : {}) });
        added++;
        void this.makeThumb(item.id, file);
      } catch (e) {
        problems.push(e instanceof FileForgeError ? (e.message.startsWith(file.name) ? e.message : `${file.name}: ${e.message}`) : `${file.name}: could not be read.`);
      }
    }
    const notices = [...this.snap.notices, ...problems];
    if (dups.length) notices.push(`Skipped duplicate image${dups.length > 1 ? "s" : ""}: ${dups.join(", ")}.`);
    this.set({ notices });
    this.announce(`${added} image${added === 1 ? "" : "s"} added${problems.length ? `, ${problems.length} not accepted` : ""}`);
    return { added, problems, duplicates: dups };
  }

  private async makeThumb(id: string, file: File) {
    if (!this.deps.thumbnail) return;
    const url = await this.deps.thumbnail(file);
    if (!url) return;
    const it = this.snap.items.find((i) => i.id === id);
    if (!it || this.disposed) {
      URL.revokeObjectURL(url);
      return;
    }
    this.set({ items: this.snap.items.map((i) => (i.id === id ? { ...i, thumbUrl: url } : i)) });
  }

  private release(items: MergeItem[]) {
    for (const i of items) if (i.thumbUrl) URL.revokeObjectURL(i.thumbUrl);
  }

  remove(id: string) {
    const it = this.snap.items.find((i) => i.id === id);
    if (!it) return;
    this.release([it]);
    this.set({ items: this.snap.items.filter((i) => i.id !== id), ...(this.snap.phase === "done" ? { phase: "idle" as const, result: undefined } : {}) });
    this.announce(`${it.name} removed`);
  }

  clear() {
    this.ac?.abort();
    this.release(this.snap.items);
    this.set({ items: [], phase: "idle", result: undefined, error: undefined, notices: [], prepared: 0 });
    this.announce("Images cleared");
  }

  moveTo(id: string, toIndex: number) {
    const items = [...this.snap.items];
    const from = items.findIndex((i) => i.id === id);
    const to = Math.max(0, Math.min(items.length - 1, toIndex));
    if (from < 0 || from === to) return;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it!);
    this.set({ items, ...(this.snap.phase === "done" ? { phase: "idle" as const, result: undefined } : {}) });
    this.announce(`${it!.name} moved to page ${to + 1} of ${items.length}`);
  }

  move(id: string, delta: -1 | 1) {
    const idx = this.snap.items.findIndex((i) => i.id === id);
    if (idx >= 0) this.moveTo(id, idx + delta);
  }

  /** Page frame for the order preview: page orientation and where the image lands (fractions of the page). */
  static previewFrame(item: Pick<MergeItem, "width" | "height">, s: Pick<MergeSettings, "pageSize" | "orientation" | "margins" | "fit">) {
    const o: Orientation = s.orientation === "auto" ? (item.width > item.height ? "landscape" : "portrait") : s.orientation;
    const d = pageDims({ pageSize: s.pageSize, margins: s.margins }, o);
    const contentAspect = d.contentWidth / d.contentHeight;
    const imgAspect = item.width / item.height;
    let w: number, h: number;
    if (s.fit === "fill") {
      w = d.contentWidth;
      h = d.contentHeight;
    } else if (imgAspect > contentAspect) {
      w = d.contentWidth;
      h = d.contentWidth / imgAspect;
    } else {
      h = d.contentHeight;
      w = d.contentHeight * imgAspect;
    }
    return { orientation: o, pageAspect: d.width / d.height, left: (d.width - w) / 2 / d.width, top: (d.height - h) / 2 / d.height, width: w / d.width, height: h / d.height, cropped: s.fit === "fill" };
  }

  /** Builds the merged PDF. Progress is real: images prepared so far, then the render and verify stages. */
  async generate(): Promise<MergeResult | null> {
    const { items, settings } = this.snap;
    if (!items.length || this.ac) return null;
    const ac = new AbortController();
    this.ac = ac;
    this.set({ phase: "preparing", prepared: 0, result: undefined, error: undefined });
    this.announce(`Preparing ${items.length} images`);
    try {
      const prepared: PreparedImage[] = [];
      for (const item of items) {
        if (ac.signal.aborted) throw abortError();
        const crop =
          settings.fit === "fill"
            ? (w: number, h: number) => {
                const o: Orientation = settings.orientation === "auto" ? (w > h ? "landscape" : "portrait") : settings.orientation;
                const d = pageDims({ pageSize: settings.pageSize, margins: settings.margins }, o);
                return d.contentWidth / d.contentHeight;
              }
            : undefined;
        prepared.push(await this.deps.prepare(item, settings.quality, ac.signal, crop));
        this.set({ prepared: prepared.length });
      }
      if (ac.signal.aborted) throw abortError();
      const title = sanitizeFileName(settings.name || "merged-images", "merged-images");
      this.set({ phase: "rendering" });
      const res = await this.deps.render(
        { kind: "images", images: prepared, settings: { pageSize: settings.pageSize, orientation: settings.orientation, margins: settings.margins, imageQuality: settings.quality, imageFit: "fit" }, title },
        { signal: ac.signal, onStage: (s) => this.set({ phase: s === "verifying" ? "verifying" : "rendering" }) },
      );
      if (ac.signal.aborted) throw abortError();
      const result: MergeResult = { blob: new Blob([res.bytes as BlobPart], { type: "application/pdf" }), filename: sanitizeFileName(`${title}.pdf`), sizeBytes: res.bytes.length, pageCount: res.pageCount ?? prepared.length, checks: res.checks };
      this.set({ phase: "done", result });
      this.announce(`Merged PDF ready: ${result.pageCount} pages`);
      return result;
    } catch (e) {
      if ((e instanceof DOMException && e.name === "AbortError") || ac.signal.aborted) {
        this.set({ phase: "idle", prepared: 0 });
        this.announce("Merge cancelled");
      } else {
        const message = e instanceof FileForgeError ? e.message : `Could not create the PDF. ${e instanceof Error ? e.message : ""}`.trim();
        this.set({ phase: "error", error: message });
        this.announce(message);
      }
      return null;
    } finally {
      this.ac = null;
    }
  }

  cancel() {
    this.ac?.abort();
  }

  dispose() {
    this.ac?.abort();
    this.release(this.snap.items);
    this.disposed = true;
    this.listeners.clear();
  }
}

export function defaultMergeSettings(base?: Partial<MergeSettings>): MergeSettings {
  return { pageSize: "A4", orientation: "auto", margins: "normal", fit: "fit", quality: "balanced", name: "merged-images", ...base };
}

export { sniffImage };
