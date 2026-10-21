/** Page-range text such as "1-3, 5, 8-" (1-based, inclusive). */
export interface RangeResult {
  ok: boolean;
  error?: string;
  /** One group of zero-based page indexes per comma-separated part, in typed order. */
  groups: number[][];
}

export function parseRanges(text: string, pageCount: number): RangeResult {
  const fail = (error: string): RangeResult => ({ ok: false, error, groups: [] });
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return fail("Enter at least one page or range, for example 1-3, 5.");
  const groups: number[][] = [];
  for (const part of parts) {
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return fail(`"${part}" is not a page number or range.`);
    let from: number;
    let to: number;
    if (!m[2]) {
      if (!m[1]) return fail(`"${part}" is not a page number or range.`);
      from = to = Number(m[1]);
    } else {
      from = m[1] ? Number(m[1]) : 1;
      to = m[3] ? Number(m[3]) : pageCount;
    }
    if (from < 1 || to < 1) return fail("Pages start at 1.");
    if (from > pageCount || to > pageCount) return fail(`This file has ${pageCount} page${pageCount === 1 ? "" : "s"}; "${part}" goes past the end.`);
    if (from > to) return fail(`"${part}" runs backwards. Write it as ${to}-${from}.`);
    const g: number[] = [];
    for (let i = from; i <= to; i++) g.push(i - 1);
    groups.push(g);
  }
  return { ok: true, groups };
}

/** Every page of every range in typed order, each page once. */
export function flattenUnique(groups: number[][]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const g of groups) for (const i of g) if (!seen.has(i)) (seen.add(i), out.push(i));
  return out;
}

export function everyN(pageCount: number, n: number): number[][] {
  const size = Math.max(1, Math.floor(n));
  const out: number[][] = [];
  for (let i = 0; i < pageCount; i += size) out.push(Array.from({ length: Math.min(size, pageCount - i) }, (_, k) => i + k));
  return out;
}
