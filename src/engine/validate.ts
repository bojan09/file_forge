import { PROCESSING_LIMITS, SOURCE_FORMATS, findFormatByExtension, formatBytes, getExtension, type SourceFormat } from "./registry";
import { FileForgeError, type Processing } from "./types";

export interface Validated {
  format: SourceFormat;
  extension: string;
}

/** Cheap checks that need no file bytes: extension, size, emptiness. */
export function validateFileMeta(file: { name: string; size: number }, processing: Processing = "balanced"): Validated {
  const ext = getExtension(file.name);
  const format = findFormatByExtension(ext);
  if (!format) {
    const supported = SOURCE_FORMATS.flatMap((f) => f.extensions.map((e) => e.toUpperCase())).join(", ");
    throw new FileForgeError(
      "unsupported-type",
      ext
        ? `.${ext} files are not supported. FileForge accepts: ${supported}.`
        : `This file has no extension, so its type can't be determined. FileForge accepts: ${supported}.`,
    );
  }
  if (file.size === 0) throw new FileForgeError("empty-file", "This file is empty.");
  const cap = Math.min(format.maxBytes, PROCESSING_LIMITS[processing].maxFileBytes);
  if (file.size > cap) {
    throw new FileForgeError(
      "too-large",
      `${format.label} files are limited to ${formatBytes(cap)}${cap < format.maxBytes ? " in conservative mode (balanced allows " + formatBytes(format.maxBytes) + ")" : ""} here. This file is ${formatBytes(file.size)}.`,
    );
  }
  return { format, extension: ext };
}

export type ImageType = "jpeg" | "png" | "webp";

export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  return null;
}

function ascii(b: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i] ?? 0);
  return s;
}

/**
 * Reads pixel dimensions from the file header without decoding, so oversized images
 * (decompression bombs) are rejected before any canvas allocation.
 */
export function readImageSize(b: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (type === "png") {
      if (b.length < 24) return null;
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (type === "jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
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
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        i += 2 + len;
      }
      return null;
    }
    // webp
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X" && b.length >= 30) {
      const w = 1 + ((b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16));
      const h = 1 + ((b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16));
      return { width: w, height: h };
    }
    if (chunk === "VP8L" && b.length >= 25) {
      const bits = dv.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 " && b.length >= 30) {
      return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
    return null;
  } catch {
    return null;
  }
}

export function checkImageBytes(bytes: Uint8Array, extension: string, processing: Processing) {
  const type = sniffImage(bytes);
  if (!type) throw new FileForgeError("bad-image", "This file isn't a valid JPG, PNG or WebP image.");
  const expected = extension === "jpg" ? "jpeg" : extension;
  if (type !== expected) {
    throw new FileForgeError("ext-mismatch", `The file extension says .${extension} but the contents are ${type.toUpperCase()}. Rename it correctly and try again.`);
  }
  const size = readImageSize(bytes, type);
  if (!size || size.width < 1 || size.height < 1) throw new FileForgeError("bad-image", "Couldn't read this image's dimensions. The file may be damaged.");
  const mp = (size.width * size.height) / 1_000_000;
  const maxMp = PROCESSING_LIMITS[processing].imageMaxMegapixels;
  if (mp > maxMp) {
    throw new FileForgeError(
      "image-too-large",
      `This image is ${mp.toFixed(1)} megapixels (${size.width}×${size.height}). The limit is ${maxMp} MP${processing === "conservative" ? " in conservative mode — switch to balanced in Settings to allow up to 25 MP" : ""}.`,
    );
  }
  return { type, ...size };
}

export interface DecodedText {
  text: string;
  encoding: string;
  replacementCount: number;
}

/** Decodes text honoring BOMs, rejecting binary content. */
export function decodeText(bytes: Uint8Array): DecodedText {
  let encoding = "utf-8";
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    start = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    start = 2;
  }
  const view = bytes.subarray(start);
  if (encoding === "utf-8") {
    const probe = view.subarray(0, Math.min(view.length, 8192));
    for (let i = 0; i < probe.length; i++) {
      if (probe[i] === 0) throw new FileForgeError("binary-file", "This looks like a binary file, not text. It can't be converted as text.");
    }
  }
  const text = new TextDecoder(encoding).decode(view);
  let replacementCount = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) replacementCount++;
  return { text, encoding, replacementCount };
}
