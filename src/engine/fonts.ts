import type { FontFamilyName } from "./types";

/** Loads a font file by name. Replaceable so tests (no network) can read from disk. */
export type FontLoader = (file: string) => Promise<Uint8Array>;

const defaultLoader: FontLoader = async (file) => {
  // Same-origin static asset (public/fonts). Never leaves the site; cached by the service worker in Phase 5.
  const res = await fetch(`/fonts/${file}`);
  if (!res.ok) throw new Error(`Font ${file} could not be loaded (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
};

let loader: FontLoader = defaultLoader;
export function setFontLoader(next: FontLoader | null) {
  loader = next ?? defaultLoader;
}

export interface FamilyFiles {
  /** Font name registered with pdfmake. */
  name: string;
  normal: string;
  bold: string;
  italics: string;
  bolditalics: string;
}

/** Liberation fonts (SIL OFL 1.1) are fetched on demand; Roboto ships inside the pdfmake bundle. */
export const FAMILY_FILES: Record<Exclude<FontFamilyName, "sans">, FamilyFiles> = {
  serif: { name: "LiberationSerif", normal: "LiberationSerif-Regular.ttf", bold: "LiberationSerif-Bold.ttf", italics: "LiberationSerif-Italic.ttf", bolditalics: "LiberationSerif-BoldItalic.ttf" },
  mono: { name: "LiberationMono", normal: "LiberationMono-Regular.ttf", bold: "LiberationMono-Bold.ttf", italics: "LiberationMono-Italic.ttf", bolditalics: "LiberationMono-BoldItalic.ttf" },
};

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const loaded = new Map<string, Promise<string>>();

/** Base64 contents of each face, memoised per worker so a font is fetched and encoded once. */
export function loadFace(file: string): Promise<string> {
  let p = loaded.get(file);
  if (!p) {
    p = loader(file).then(toBase64);
    p.catch(() => loaded.delete(file));
    loaded.set(file, p);
  }
  return p;
}

export async function loadFamily(family: Exclude<FontFamilyName, "sans">): Promise<{ vfs: Record<string, string>; files: FamilyFiles }> {
  const files = FAMILY_FILES[family];
  const names = [files.normal, files.bold, files.italics, files.bolditalics];
  const data = await Promise.all(names.map(loadFace));
  const vfs: Record<string, string> = {};
  names.forEach((n, i) => (vfs[n] = data[i]!));
  return { vfs, files };
}
