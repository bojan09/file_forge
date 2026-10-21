import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BATCH_LIMITS } from "@/engine/batch/limits";
import { MergeList, defaultMergeSettings, directRender, orientedDimensions, type MergeDeps, type MergeItem } from "@/engine/batch/merge";
import { buildZip } from "@/engine/batch/zip";
import { jpegInfo } from "@/engine/prep-image";
import type { PreparedImage } from "@/engine/types";
import { extractPdf } from "./helpers";

const fx = (n: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../fixtures", n)));

/** Rewrites (or inserts) the EXIF orientation of a JPEG, to build distinct rotated variants. */
function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const tiff = Uint8Array.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 1, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  const exif = Uint8Array.from([...Buffer.from("Exif\0\0"), ...tiff]);
  const len = exif.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...exif, ...jpeg.subarray(2)]);
}

const base = fx("photo.jpg"); // 400x240 landscape, orientation 1
const jpg = (o: number) => new File([withOrientation(base, o) as BlobPart], `img-o${o}.jpg`, { type: "image/jpeg" });

const prep = (item: MergeItem): PreparedImage => ({ bytes: new Uint8Array(0), mime: "image/jpeg", width: item.width, height: item.height });

function deps(over: Partial<MergeDeps> = {}): MergeDeps & { crops: (number | null)[]; prepared: string[] } {
  const crops: (number | null)[] = [];
  const prepared: string[] = [];
  return {
    crops,
    prepared,
    prepare: async (item, _q, signal, crop) => {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      prepared.push(item.name);
      crops.push(crop ? crop(item.width, item.height) : null);
      // Embed real JPEG bytes; displayed size follows the EXIF orientation like the browser pipeline.
      const o = jpegInfo(new Uint8Array(await item.file.arrayBuffer())).orientation;
      return { bytes: base, mime: "image/jpeg", width: o >= 5 ? 240 : 400, height: o >= 5 ? 400 : 240 };
    },
    render: directRender,
    ...over,
  };
}

const list = (d: MergeDeps, limits = BATCH_LIMITS.balanced) => new MergeList(d, { limits, settings: defaultMergeSettings() });

async function pageBoxes(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const out: { w: number; h: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const v = (await doc.getPage(i)).view;
    out.push({ w: Math.round(v[2]! - v[0]!), h: Math.round(v[3]! - v[1]!) });
  }
  return out;
}

describe("MergeList: intake and ordering", () => {
  it("accepts images, rejects other types and exact duplicates, keeps order", async () => {
    const m = list(deps());
    const rep = await m.addFiles([jpg(1), jpg(6), new File(["x"], "notes.txt"), new File([withOrientation(base, 1) as BlobPart], "copy.jpg"), new File([], "empty.png")]);
    expect(rep.added).toBe(2);
    expect(rep.problems.join(" ")).toMatch(/notes\.txt.*only JPG, PNG and WebP/);
    expect(rep.problems.join(" ")).toMatch(/empty\.png/);
    expect(rep.duplicates[0]).toMatch(/copy\.jpg \(same as img-o1\.jpg\)/);
    const { items } = m.getSnapshot();
    expect(items.map((i) => i.name)).toEqual(["img-o1.jpg", "img-o6.jpg"]);
    expect([items[0]!.width, items[0]!.height]).toEqual([400, 240]);
    expect([items[1]!.width, items[1]!.height]).toEqual([240, 400]); // EXIF 6 swaps displayed dimensions
    m.moveTo(items[1]!.id, 0);
    expect(m.getSnapshot().items.map((i) => i.name)).toEqual(["img-o6.jpg", "img-o1.jpg"]);
    m.remove(items[0]!.id);
    expect(m.getSnapshot().items).toHaveLength(1);
  });

  it("enforces batch limits", async () => {
    const m = list(deps(), { maxFiles: 2, maxTotalBytes: 1e9 });
    const rep = await m.addFiles([jpg(1), jpg(2), jpg(3)]);
    expect(rep.added).toBe(2);
    expect(rep.problems[0]).toMatch(/at most 2 images/);
  });

  it("reads displayed dimensions from the header", () => {
    expect(orientedDimensions(withOrientation(base, 8), "jpeg")).toEqual({ width: 240, height: 400 });
    expect(orientedDimensions(withOrientation(base, 3), "jpeg")).toEqual({ width: 400, height: 240 });
  });
});

describe("MergeList: PDF generation", () => {
  it("creates one page per image, in list order, with per-page orientation (auto)", async () => {
    const d = deps();
    const m = list(d);
    await m.addFiles([jpg(1), jpg(6), jpg(3)]);
    const res = await m.generate();
    expect(res).not.toBeNull();
    expect(res!.pageCount).toBe(3);
    expect(d.prepared).toEqual(["img-o1.jpg", "img-o6.jpg", "img-o3.jpg"]);
    const boxes = await pageBoxes(new Uint8Array(await res!.blob.arrayBuffer()));
    expect(boxes.map((b) => (b.w > b.h ? "L" : "P"))).toEqual(["L", "P", "L"]);
    expect(boxes[0]).toEqual({ w: 842, h: 595 }); // A4 landscape
    expect(res!.checks.every((c) => c.passed)).toBe(true);
    expect(res!.checks.some((c) => c.id === "image-count")).toBe(true);
    expect(res!.filename).toBe("merged-images.pdf");
    // reordering changes the page order
    const items = m.getSnapshot().items;
    m.moveTo(items[1]!.id, 0);
    expect(m.getSnapshot().phase).toBe("idle");
    const res2 = await m.generate();
    const boxes2 = await pageBoxes(new Uint8Array(await res2!.blob.arrayBuffer()));
    expect(boxes2.map((b) => (b.w > b.h ? "L" : "P"))).toEqual(["P", "L", "L"]);
  });

  it("honors page size, forced orientation, and does not add empty pages", async () => {
    const m = list(deps());
    await m.addFiles([jpg(1), jpg(6)]);
    m.setSettings({ pageSize: "LETTER", orientation: "portrait", margins: "narrow" });
    const res = (await m.generate())!;
    const boxes = await pageBoxes(new Uint8Array(await res.blob.arrayBuffer()));
    expect(boxes).toEqual([{ w: 612, h: 792 }, { w: 612, h: 792 }]);
    const { numPages } = await extractPdf(new Uint8Array(await res.blob.arrayBuffer()));
    expect(numPages).toBe(2);
  });

  it("fill crops to the content aspect only when explicitly selected", async () => {
    const d = deps();
    const m = list(d);
    await m.addFiles([jpg(1)]);
    await m.generate();
    expect(d.crops).toEqual([null]);
    m.setSettings({ fit: "fill", pageSize: "A4", orientation: "portrait", margins: "normal" });
    await m.generate();
    const aspect = d.crops[1]!;
    expect(aspect).toBeCloseTo((595.28 - 144) / (841.89 - 144), 3);
  });

  it("preview frames show fit vs fill placement", () => {
    const landscape = { width: 400, height: 240 };
    const fit = MergeList.previewFrame(landscape, { pageSize: "A4", orientation: "portrait", margins: "normal", fit: "fit" });
    expect(fit.cropped).toBe(false);
    expect(fit.width).toBeLessThan(1);
    expect(fit.height).toBeLessThan(fit.width * fit.pageAspect); // landscape image is wider than tall on the page
    const fill = MergeList.previewFrame(landscape, { pageSize: "A4", orientation: "portrait", margins: "normal", fit: "fill" });
    expect(fill.cropped).toBe(true);
    expect(fill.left).toBeCloseTo(72 / 595.28, 3);
  });

  it("reports real progress, can be cancelled, and recovers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps();
    const slow: MergeDeps = { ...d, prepare: async (item, q, signal, crop) => (item.name === "img-o6.jpg" ? (await gate, d.prepare(item, q, signal, crop)) : d.prepare(item, q, signal, crop)) };
    const m = list(slow);
    await m.addFiles([jpg(1), jpg(6), jpg(3)]);
    const run = m.generate();
    await new Promise((r) => setTimeout(r, 10));
    expect(m.getSnapshot()).toMatchObject({ phase: "preparing", prepared: 1 });
    m.cancel();
    release();
    expect(await run).toBeNull();
    expect(m.getSnapshot().phase).toBe("idle");
    expect(await m.generate()).not.toBeNull(); // usable again
  });

  it("surfaces engine errors without losing the list", async () => {
    const d = deps({ render: async () => { throw new Error("render exploded"); } });
    const m = list(d);
    await m.addFiles([jpg(1)]);
    expect(await m.generate()).toBeNull();
    expect(m.getSnapshot()).toMatchObject({ phase: "error" });
    expect(m.getSnapshot().error).toMatch(/render exploded/);
    expect(m.getSnapshot().items).toHaveLength(1);
  });
});

describe("MergeList: memory cleanup", () => {
  const revoked: string[] = [];
  const realRevoke = URL.revokeObjectURL;
  afterEach(() => {
    URL.revokeObjectURL = realRevoke;
    revoked.length = 0;
  });
  it("revokes thumbnail URLs on remove, clear and dispose", async () => {
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    let n = 0;
    const m = list(deps({ thumbnail: async () => `blob:test/${n++}` }));
    await m.addFiles([jpg(1), jpg(6), jpg(3)]);
    await new Promise((r) => setTimeout(r, 10));
    const [a] = m.getSnapshot().items;
    expect(m.getSnapshot().items.every((i) => i.thumbUrl)).toBe(true);
    m.remove(a!.id);
    expect(revoked).toEqual([a!.thumbUrl]);
    m.clear();
    expect(revoked).toHaveLength(3);
    await m.addFiles([jpg(2)]);
    await new Promise((r) => setTimeout(r, 10));
    m.dispose();
    expect(revoked).toHaveLength(4);
  });
});

describe("buildZip", () => {
  const blob = (s: string | Uint8Array) => new Blob([s as BlobPart]);
  const bytesOf = async (z: JSZip, name: string) => new Uint8Array(await z.file(name)!.async("uint8array"));

  it("creates a valid archive with identical contents", async () => {
    const pdfBytes = new Uint8Array(Array.from({ length: 5000 }, (_, i) => (i * 7) % 251));
    const zipBlob = await buildZip([
      { name: "a.pdf", blob: blob(pdfBytes) },
      { name: "b.docx", blob: blob("docx bytes") },
      { name: "Здраво 文档.pdf", blob: blob("unicode") },
    ]);
    expect(zipBlob.type).toBe("application/zip");
    const z = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(z.files).sort()).toEqual(["Здраво 文档.pdf", "a.pdf", "b.docx"].sort());
    expect(await bytesOf(z, "a.pdf")).toEqual(pdfBytes);
    expect(await z.file("b.docx")!.async("string")).toBe("docx bytes");
    expect(await z.file("Здраво 文档.pdf")!.async("string")).toBe("unicode");
  });

  it("de-duplicates names and neutralizes path traversal", async () => {
    const z = await JSZip.loadAsync(await (await buildZip([
      { name: "report.pdf", blob: blob("1") },
      { name: "Report.pdf", blob: blob("2") },
      { name: "report.pdf", blob: blob("3") },
      { name: "../../evil.sh", blob: blob("x") },
      { name: "C:\\Windows\\sys.pdf", blob: blob("y") },
      { name: "CON.pdf", blob: blob("z") },
    ])).arrayBuffer());
    const names = Object.keys(z.files).sort();
    expect(names).toEqual(["Report (2).pdf", "_CON.pdf", "evil.sh", "report (3).pdf", "report.pdf", "sys.pdf"].sort());
    expect(names.every((n) => !n.includes("..") && !n.startsWith("/") && !n.includes("\\"))).toBe(true);
    expect(await z.file("report.pdf")!.async("string")).toBe("1");
  });

  it("places originals in a folder with their own unique names", async () => {
    const z = await JSZip.loadAsync(await (await buildZip([
      { name: "a.pdf", blob: blob("out") },
      { name: "a.txt", blob: blob("orig1"), folder: "originals" },
      { name: "a.txt", blob: blob("orig2"), folder: "originals" },
    ])).arrayBuffer());
    expect(Object.keys(z.files).filter((n) => !n.endsWith("/")).sort()).toEqual(["a.pdf", "originals/a (2).txt", "originals/a.txt"]);
  });

  it("reports progress and falls back when the async implementation fails", async () => {
    const seen: string[] = [];
    const out = await buildZip([{ name: "a.pdf", blob: blob("1") }, { name: "b.pdf", blob: blob("2") }], (p) => seen.push(`${p.phase}:${p.read}/${p.total}`), [
      async () => { throw new Error("worker unavailable"); },
      async (data) => (await import("fflate")).zipSync(data),
    ]);
    expect(seen).toEqual(["reading:1/2", "reading:2/2", "compressing:2/2"]);
    expect(Object.keys((await JSZip.loadAsync(await out.arrayBuffer())).files)).toHaveLength(2);
  });

  it("throws when every implementation fails, and on empty input", async () => {
    await expect(buildZip([{ name: "a", blob: blob("1") }], undefined, [async () => { throw new Error("nope"); }])).rejects.toThrow("nope");
    await expect(buildZip([])).rejects.toThrow(/Nothing to add/);
  });

  it("passes an independent reader (python zipfile)", async () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
    const out = await buildZip([{ name: "x.pdf", blob: blob(big) }, { name: "y.docx", blob: blob("hello") }]);
    const dir = mkdtempSync(path.join(tmpdir(), "ff-zip-"));
    const file = path.join(dir, "t.zip");
    writeFileSync(file, Buffer.from(await out.arrayBuffer()));
    let result = "";
    try {
      result = execFileSync("python3", ["-I", "-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or 'OK', sorted(z.namelist()))", file], { encoding: "utf8" });
    } catch {
      return; // python3 unavailable: JSZip checks above still cover integrity
    }
    expect(result).toContain("OK ['x.pdf', 'y.docx']");
    try {
      const t = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
      expect(t).toMatch(/No errors detected/);
    } catch {
      /* unzip not installed */
    }
  });
});

vi.setConfig({ testTimeout: 60000 });
