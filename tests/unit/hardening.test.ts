import { describe, expect, it } from "vitest";
import { CHUNK, MAX_UNBROKEN, chunkRuns, hardenBlocks, splitUnbroken } from "@/engine/layout-safe";
import { safeBaseName } from "@/engine/convert";
import { parseCsv } from "@/engine/parsers/csv";
import { parseTxt } from "@/engine/parsers/txt";
import { runRender } from "@/engine/render";
import { defaultSettings, extractPdf } from "./helpers";

const join = (runs: { text: string }[]) => runs.map((r) => r.text).join("");
const stripPageNumbers = (pages: string[]) => pages.map((p, i) => p.replace(new RegExp(`\\s*${i + 1} / ${pages.length}\\s*$`), "")).join(" ").replace(/\s+/g, "");

describe("layout hardening (regressions for quadratic PDF layout)", () => {
  it("splits long unbroken runs without changing or inserting characters", () => {
    const text = "short " + "x".repeat(2000) + " 😀".repeat(80) + " tail";
    const out = splitUnbroken([{ text, bold: true }]);
    expect(join(out)).toBe(text);
    expect(out.every((r) => Array.from(r.text).length <= MAX_UNBROKEN || /\s/.test(r.text))).toBe(true);
    expect(out.every((r) => r.bold)).toBe(true);
    expect(splitUnbroken([{ text: "tiny" }])).toEqual([{ text: "tiny" }]);
  });

  it("chunks long paragraphs at newlines or spaces and keeps all non-space text in order", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `line ${i} of the log`).join("\n");
    const groups = chunkRuns([{ text }]);
    expect(groups.length).toBeGreaterThan(10);
    for (const g of groups) expect(join(g).length).toBeLessThanOrEqual(CHUNK);
    expect(groups.map(join).join("\n")).toBe(text);
    const words = chunkRuns([{ text: "lorem ipsum ".repeat(5000) }]);
    expect(words.map(join).join(" ").replace(/\s+/g, " ").trim()).toBe("lorem ipsum ".repeat(5000).replace(/\s+/g, " ").trim());
  });

  it("marks continuation paragraphs so spacing stays natural", () => {
    const blocks = hardenBlocks([{ type: "paragraph", runs: [{ text: "word ".repeat(2000) }] }]);
    expect(blocks.length).toBeGreaterThan(2);
    for (const b of blocks.slice(0, -1)) expect(b).toMatchObject({ type: "paragraph", cont: true });
    const last = blocks[blocks.length - 1]!;
    expect(last.type === "paragraph" ? last.cont : "x").toBeUndefined(); // the final piece keeps normal paragraph spacing
  });

  it("renders a 200k-character unbroken string quickly and losslessly", async () => {
    const t = Date.now();
    const text = "abcdefghij".repeat(20_000);
    const r = await runRender({ kind: "doc", doc: parseTxt(text), output: "pdf", settings: defaultSettings, title: "t" });
    expect(Date.now() - t).toBeLessThan(60_000);
    expect(stripPageNumbers((await extractPdf(r.bytes)).pages)).toBe(text);
  }, 120_000);

  it("renders a log-style file with no blank lines (20k lines) in bounded time, losslessly", async () => {
    const text = Array.from({ length: 20_000 }, (_, i) => `2024-01-01 INFO line ${i} something happened`).join("\n");
    const t = Date.now();
    const r = await runRender({ kind: "doc", doc: parseTxt(text), output: "pdf", settings: defaultSettings, title: "t" });
    expect(Date.now() - t).toBeLessThan(90_000);
    expect(stripPageNumbers((await extractPdf(r.bytes)).pages)).toBe(text.replace(/\s+/g, ""));
  }, 180_000);

  it("renders a table cell with 100k unbroken characters without losing any", async () => {
    const cell = "z".repeat(100_000);
    const r = await runRender({ kind: "doc", doc: parseCsv(`a,b\n"${cell}",2\nlast,row\n`, "balanced"), output: "pdf", settings: defaultSettings, title: "t" });
    const all = stripPageNumbers((await extractPdf(r.bytes)).pages);
    // Column text can interleave in extraction order, so count characters instead of matching one run.
    expect(all.match(/z/g)?.length).toBe(100_000);
    expect(all.includes("last")).toBe(true);
  }, 120_000);
});

describe("filename handling", () => {
  it("makes safe base names", () => {
    expect(safeBaseName("report.final.txt")).toBe("report.final");
    expect(safeBaseName("CON.txt")).toBe("_CON");
    expect(safeBaseName("..hidden..md")).toBe("hidden");
    expect(safeBaseName("a<b>:c.txt")).toBe("a_b_c");
    expect(safeBaseName(".txt")).toBe(".txt".replace(/^\.+/, "") || "converted");
    expect(safeBaseName("日本語のファイル.md")).toBe("日本語のファイル");
  });
});
