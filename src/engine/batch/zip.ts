import { zip, zipSync, type Zippable } from "fflate";
import { uniqueName, sanitizeEntryName } from "./naming";

export interface ZipEntry {
  /** Desired name; made safe and unique by buildZip. */
  name: string;
  blob: Blob;
  folder?: string;
}

export interface ZipProgress {
  /** Entries read into memory so far. */
  read: number;
  total: number;
  phase: "reading" | "compressing";
}

export type ZipImpl = (data: Zippable) => Promise<Uint8Array>;

const asyncZip: ZipImpl = (data) =>
  new Promise((resolve, reject) => zip(data, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out))));

/** Blocking fallback for environments where fflate's worker-based zip is unavailable. */
const syncZip: ZipImpl = async (data) => zipSync(data, { level: 6 });

const STORE_ONLY = /\.(docx|jpe?g|png|webp|zip)$/i;

/**
 * Builds a ZIP entirely in memory with fflate (MIT). Entry names are sanitized and de-duplicated.
 * DOCX and image files are already compressed, so they are stored without recompression.
 * Throws if both the async and the blocking implementation fail; callers keep individual downloads available.
 */
export async function buildZip(entries: ZipEntry[], onProgress?: (p: ZipProgress) => void, impls: ZipImpl[] = [asyncZip, syncZip]): Promise<Blob> {
  if (!entries.length) throw new Error("Nothing to add to the archive.");
  const taken = new Map<string, Set<string>>();
  const data: Zippable = {};
  let read = 0;
  for (const entry of entries) {
    const folder = entry.folder ?? "";
    const set = taken.get(folder) ?? new Set<string>();
    taken.set(folder, set);
    const safe = sanitizeEntryName(entry.name, entry.folder);
    const base = safe.split("/").pop()!;
    const finalName = uniqueName(base, set);
    const path = folder ? `${safe.split("/")[0]}/${finalName}` : finalName;
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    data[path] = [bytes, { level: STORE_ONLY.test(finalName) ? 0 : 6 }];
    read++;
    onProgress?.({ read, total: entries.length, phase: "reading" });
  }
  onProgress?.({ read, total: entries.length, phase: "compressing" });
  let lastError: unknown;
  for (const impl of impls) {
    try {
      const out = await impl(data);
      return new Blob([out as BlobPart], { type: "application/zip" });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not create the archive.");
}
