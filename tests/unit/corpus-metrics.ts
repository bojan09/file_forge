import { readFileSync } from "node:fs";
import path from "node:path";
import { extractPdf } from "./helpers";

export const corpusDir = path.resolve(__dirname, "../corpus");
export const corpusFile = (n: string) => new File([readFileSync(path.join(corpusDir, n))], n);
export const corpusBytes = (n: string) => new Uint8Array(readFileSync(path.join(corpusDir, n)));
export const corpusText = (n: string) => readFileSync(path.join(corpusDir, n), "utf8");

export const words = (t: string): string[] => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Share of reference words found anywhere in the output (multiset). */
export function bagRecall(ref: string[], out: string[]): number {
  const bag = new Map<string, number>();
  for (const w of out) bag.set(w, (bag.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of ref) {
    const n = bag.get(w) ?? 0;
    if (n > 0) {
      hit++;
      bag.set(w, n - 1);
    }
  }
  return ref.length ? hit / ref.length : 1;
}

/** Share of reference words matched in order: each is looked up in a window after the previous match. */
export function orderedRecall(ref: string[], out: string[], window = 40): number {
  let j = 0;
  let hit = 0;
  for (const w of ref) {
    const end = Math.min(out.length, j + window);
    for (let k = j; k < end; k++) {
      if (out[k] === w) {
        hit++;
        j = k + 1;
        break;
      }
    }
  }
  return ref.length ? hit / ref.length : 1;
}

export async function pdfWords(bytes: Uint8Array): Promise<{ words: string[]; pages: number }> {
  const { pages, numPages } = await extractPdf(bytes);
  return { words: words(pages.join(" ")), pages: numPages };
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  return (await extractPdf(bytes)).numPages;
}
