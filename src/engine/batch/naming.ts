const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Splits "name.ext" at the last dot (a leading dot is part of the name). */
export function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
}

/** Makes a string safe as a single file name on common platforms. */
export function sanitizeFileName(name: string, fallback = "file"): string {
  const { stem, ext } = splitName(name.normalize("NFC"));
  let s = stem
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  s = Array.from(s).slice(0, 120).join("");
  const safeExt = ext.length > 1 ? ext.replace(/[^A-Za-z0-9.]/g, "").slice(0, 12) : "";
  return `${s || fallback}${safeExt}`;
}

/** Entry name inside a ZIP: no directories, no traversal, no control characters. */
export function sanitizeEntryName(name: string, folder?: string): string {
  const base = sanitizeFileName(name.split(/[\\/]/).pop() ?? "", "file");
  return folder ? `${sanitizeFileName(folder, "folder")}/${base}` : base;
}

/** Returns `name`, or `name (2)`, `name (3)`… when already taken (case-insensitive). Adds the result to `taken`. */
export function uniqueName(name: string, taken: Set<string>): string {
  const lower = (n: string) => n.toLowerCase();
  if (!taken.has(lower(name))) {
    taken.add(lower(name));
    return name;
  }
  const { stem, ext } = splitName(name);
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(lower(candidate))) {
      taken.add(lower(candidate));
      return candidate;
    }
  }
}

export function zipFileName(input: string): string {
  const cleaned = sanitizeFileName(input.trim().replace(/\.zip$/i, ""), "fileforge-converted");
  return `${cleaned}.zip`;
}
