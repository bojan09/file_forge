import type { Block, Inline, ListItem } from "./types";

/**
 * pdfmake's line breaker is super-linear in paragraph length and in unbroken character runs
 * (measured: 10k unbroken characters ~4.7 s, 30k ~45 s, a 3 MB paragraph of short lines ~11 min).
 * These helpers keep every layout unit small without changing the text:
 *  - runs of non-space characters longer than MAX_UNBROKEN are split into adjacent inline pieces,
 *    which gives the layout engine break opportunities without inserting any characters;
 *  - paragraphs longer than CHUNK characters are split at a newline or space into consecutive
 *    paragraphs with no spacing between them.
 * Side effect (documented): a line may wrap slightly early at a chunk boundary.
 */
export const MAX_UNBROKEN = 50;
export const CHUNK = 3000;

export function splitUnbroken(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  const longToken = new RegExp(`\\S{${MAX_UNBROKEN + 1},}`, "gu");
  for (const run of runs) {
    if (run.text.length <= MAX_UNBROKEN) {
      out.push(run);
      continue;
    }
    let last = 0;
    for (const m of run.text.matchAll(longToken)) {
      const start = m.index!;
      if (start > last) out.push({ ...run, text: run.text.slice(last, start) });
      const chars = Array.from(m[0]);
      for (let i = 0; i < chars.length; i += MAX_UNBROKEN) out.push({ ...run, text: chars.slice(i, i + MAX_UNBROKEN).join("") });
      last = start + m[0].length;
    }
    if (last < run.text.length) out.push({ ...run, text: run.text.slice(last) });
  }
  return out;
}

function lengthOf(runs: Inline[]): number {
  let n = 0;
  for (const r of runs) n += r.text.length;
  return n;
}

/** Splits runs into groups of about `CHUNK` characters, cutting at newlines or spaces (the cut character is consumed). */
export function chunkRuns(runs: Inline[]): Inline[][] {
  if (lengthOf(runs) <= CHUNK) return [runs];
  const groups: Inline[][] = [];
  let cur: Inline[] = [];
  let curLen = 0;
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    curLen = 0;
  };
  for (const run of runs) {
    let text = run.text;
    while (curLen + text.length > CHUNK) {
      const room = CHUNK - curLen;
      let cut = text.lastIndexOf("\n", room);
      if (cut <= 0) cut = text.lastIndexOf(" ", room);
      if (cut <= 0) {
        if (curLen > 0) {
          flush();
          continue;
        }
        // No break opportunity inside a window and nothing buffered: cut at the window edge.
        const head = text.slice(0, room);
        cur.push({ ...run, text: head });
        curLen += head.length;
        text = text.slice(room);
        flush();
        continue;
      }
      const head = text.slice(0, cut);
      if (head) cur.push({ ...run, text: head });
      text = text.slice(cut + 1);
      flush();
    }
    if (text) {
      cur.push({ ...run, text });
      curLen += text.length;
    }
  }
  flush();
  return groups;
}

function hardenItem(it: ListItem): ListItem {
  return { runs: splitUnbroken(it.runs), children: it.children ? hardenBlocks(it.children) : undefined };
}

export function hardenBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph": {
        const groups = chunkRuns(splitUnbroken(b.runs));
        groups.forEach((runs, i) => out.push({ type: "paragraph", runs, align: b.align, cont: b.cont || i < groups.length - 1 ? true : undefined }));
        break;
      }
      case "heading":
        out.push({ ...b, runs: splitUnbroken(b.runs) });
        break;
      case "list":
        out.push({ ...b, items: b.items.map(hardenItem) });
        break;
      case "quote":
        out.push({ ...b, blocks: hardenBlocks(b.blocks) });
        break;
      case "table":
        out.push({ ...b, header: b.header ? b.header.map(splitUnbroken) : null, rows: b.rows.map((r) => r.map(splitUnbroken)) });
        break;
      default:
        out.push(b);
    }
  }
  return out;
}
