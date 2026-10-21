import { FileForgeError, type ImageQuality, type PreparedImage } from "./types";
import type { ImageType } from "./validate";

const MAX_DIM: Record<ImageQuality, number> = { high: Infinity, balanced: 3000, small: 2000 };
const JPEG_Q: Record<ImageQuality, number> = { high: 0.95, balanced: 0.85, small: 0.7 };

/** Reads EXIF orientation (1-8) and component count from a JPEG header. */
export function jpegInfo(b: Uint8Array): { orientation: number; components: number } {
  let orientation = 1;
  let components = 3;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = dv.getUint16(i + 2);
    if (marker === 0xe1 && len >= 16 && String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!) === "Exif") {
      const t = i + 10;
      const little = b[t] === 0x49;
      const ifd = t + dv.getUint32(t + 4, little);
      if (ifd + 2 < b.length) {
        const n = dv.getUint16(ifd, little);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (e + 10 > b.length) break;
          if (dv.getUint16(e, little) === 0x0112) orientation = dv.getUint16(e + 8, little);
        }
      }
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      components = b[i + 9] ?? 3;
      break;
    }
    i += 2 + len;
  }
  return { orientation, components };
}

export function pngInfo(b: Uint8Array): { bitDepth: number; colorType: number; interlace: number } {
  return { bitDepth: b[24] ?? 8, colorType: b[25] ?? 6, interlace: b[28] ?? 0 };
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function encode(canvas: AnyCanvas, mime: string, quality: number): Promise<Uint8Array> {
  const blob: Blob | null =
    "convertToBlob" in canvas ? await canvas.convertToBlob({ type: mime, quality }) : await new Promise<Blob | null>((res) => (canvas as HTMLCanvasElement).toBlob(res, mime, quality));
  if (!blob || !blob.size) throw new FileForgeError("encode-failed", "The browser couldn't re-encode this image. Try a smaller image or lower quality.", true);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Produces bytes the PDF engine can embed. Originals are passed through untouched when that is
 * lossless and safe; everything else is decoded (honoring EXIF rotation) and re-encoded.
 */
export interface PrepareOptions {
  /** Called with the displayed (EXIF-corrected) size; return a target width/height ratio to center-crop to, or null for no crop. */
  crop?: (width: number, height: number) => number | null;
}

export async function prepareImage(bytes: Uint8Array, type: ImageType, quality: ImageQuality, signal?: AbortSignal, opts: PrepareOptions = {}): Promise<PreparedImage> {
  const abortCheck = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  const blob = new Blob([bytes as BlobPart], { type: `image/${type}` });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new FileForgeError("bad-image", "This browser couldn't decode the image. The file may be damaged or use an unsupported variant.");
  }
  try {
    abortCheck();
    const { width: srcW, height: srcH } = bitmap;

    const cropAspect = opts.crop?.(srcW, srcH) ?? null;
    if (quality === "high" && cropAspect === null) {
      if (type === "jpeg") {
        const info = jpegInfo(bytes);
        if (info.orientation === 1 && info.components !== 4) return { bytes, mime: "image/jpeg", width: srcW, height: srcH };
      } else if (type === "png") {
        const info = pngInfo(bytes);
        if (info.bitDepth === 8 && info.interlace === 0) return { bytes, mime: "image/png", width: srcW, height: srcH };
      }
    }

    // Source rectangle: the whole bitmap, or a centered crop when an explicit "fill" crop was requested.
    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;
    if (cropAspect !== null) {
      if (srcW / srcH > cropAspect) {
        sw = Math.max(1, Math.round(srcH * cropAspect));
        sx = Math.round((srcW - sw) / 2);
      } else {
        sh = Math.max(1, Math.round(srcW / cropAspect));
        sy = Math.round((srcH - sh) / 2);
      }
    }
    const scale = Math.min(1, MAX_DIM[quality] / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new FileForgeError("encode-failed", "Canvas isn't available in this browser.", true);

    const lossless = quality === "high" && type !== "jpeg";
    if (!lossless) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    abortCheck();
    const out = await encode(canvas, lossless ? "image/png" : "image/jpeg", JPEG_Q[quality]);
    return { bytes: out, mime: lossless ? "image/png" : "image/jpeg", width: w, height: h };
  } finally {
    bitmap.close();
  }
}

/** True when `bytes` is a PNG variant that pdfmake decodes through a nested Worker (alpha, interlaced, 16-bit, palette transparency). */
export function pngNeedsFlatten(bytes: Uint8Array): boolean {
  const info = pngInfo(bytes);
  if (info.interlace !== 0 || info.bitDepth === 16 || info.colorType === 4 || info.colorType === 6) return true;
  if (info.colorType === 3) {
    // Palette images carry transparency in an optional tRNS chunk.
    for (let i = 8; i + 8 < bytes.length; ) {
      const len = ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
      const name = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
      if (name === "tRNS") return true;
      if (name === "IDAT" || name === "IEND") break;
      i += 12 + len;
    }
  }
  return false;
}

/** Re-encodes a PNG as an opaque 8-bit non-interlaced PNG on a white background. Needs a canvas (browser or worker). */
export async function flattenPng(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  try {
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    return await encode(canvas, "image/png", 1);
  } finally {
    bitmap.close();
  }
}
