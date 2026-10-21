import { unzipSync } from "fflate";
import { FileForgeError } from "../types";

export interface ZipLimits {
  /** Largest single part that may be read. */
  maxEntryBytes: number;
  /** Total of all parts that may be read. */
  maxTotalBytes: number;
  maxEntries: number;
}

export const OFFICE_ZIP_LIMITS: ZipLimits = { maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 160 * 1024 * 1024, maxEntries: 5000 };

/** ZIP local-file signature, shared by DOCX, XLSX and PPTX. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7) && (bytes[3] === 4 || bytes[3] === 6 || bytes[3] === 8);
}

export class OfficeZip {
  private files: Record<string, Uint8Array>;
  readonly names: string[];
  /** Every part in the package, including ones that were not read (used to report charts, pivots, media). */
  readonly allNames: string[];

  private constructor(files: Record<string, Uint8Array>, allNames: string[]) {
    this.files = files;
    this.names = Object.keys(files);
    this.allNames = allNames;
  }

  /**
   * Unzips only the parts `want` accepts, refusing archives whose declared sizes exceed the limits (zip bombs).
   * fflate verifies that the real inflated size matches the declared size, so a lying header fails rather than allocating.
   */
  static open(bytes: Uint8Array, want: (name: string) => boolean, limits: ZipLimits = OFFICE_ZIP_LIMITS): OfficeZip {
    if (!isZip(bytes)) throw new FileForgeError("not-zip", "This file isn't a valid Office document (it is not a ZIP package). It may be damaged or have the wrong extension.");
    let total = 0;
    let entries = 0;
    const allNames: string[] = [];
    try {
      const files = unzipSync(bytes, {
        filter: (f) => {
          if (++entries > limits.maxEntries) throw new FileForgeError("zip-too-many", "This document contains an unusually large number of parts and was refused.");
          allNames.push(f.name);
          if (f.name.endsWith("/") || !want(f.name)) return false;
          if (f.originalSize > limits.maxEntryBytes) throw new FileForgeError("zip-too-large", "One part of this document is too large to process safely in the browser.");
          total += f.originalSize;
          if (total > limits.maxTotalBytes) throw new FileForgeError("zip-too-large", "This document expands to more data than can be processed safely in the browser.");
          return true;
        },
      });
      return new OfficeZip(files, allNames);
    } catch (e) {
      if (e instanceof FileForgeError) throw e;
      throw new FileForgeError("corrupt-zip", "This file is damaged or truncated and couldn't be opened as an Office document.");
    }
  }

  has(name: string): boolean {
    return name in this.files;
  }

  bytes(name: string): Uint8Array | undefined {
    return this.files[name];
  }

  text(name: string): string | undefined {
    const b = this.files[name];
    return b ? new TextDecoder("utf-8").decode(b) : undefined;
  }
}

/** Resolves a relationship target (relative to the part that owns the rels file) to a package path. */
export function resolveTarget(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = basePart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

/** Parses a `.rels` part. Uses a tolerant attribute scan, so it works without DOMParser (workers, node). */
export function parseRels(xml: string | undefined): Relationship[] {
  if (!xml) return [];
  const out: Relationship[] = [];
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = m[1]!;
    const get = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(attrs)?.[1];
    const id = get("Id");
    const target = get("Target");
    if (id && target) out.push({ id, type: get("Type") ?? "", target: decodeXml(target), external: get("TargetMode") === "External" });
  }
  return out;
}

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : "";
  });
}
