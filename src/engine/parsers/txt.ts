import type { Block } from "../types";
import { finalizeDoc, stripControl } from "./common";

export function parseTxt(text: string) {
  const normalized = stripControl(text.replace(/\r\n?/g, "\n").replace(/\t/g, "    "));
  const blocks: Block[] = [];
  for (const chunk of normalized.split(/\n{2,}/)) {
    const cleaned = chunk
      .split("\n")
      .map((l) => l.replace(/[ ]+$/, ""))
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
    if (cleaned.trim()) blocks.push({ type: "paragraph", runs: [{ text: cleaned }] });
  }
  return finalizeDoc(blocks, []);
}
