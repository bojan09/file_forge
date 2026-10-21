// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { parseCsv } from "@/engine/parsers/csv";
import { parseHtml } from "@/engine/parsers/html";
import { parseMarkdown } from "@/engine/parsers/markdown";
import { runRender } from "@/engine/render";
import type { NormalizedDoc, PageSettings } from "@/engine/types";
import { defaultSettings } from "./helpers";

// Measurements for docs/PHASE_3_REPORT.md. Run: PERF=1 npx vitest run tests/unit/phase3-perf.test.ts --disableConsoleIntercept
const run = process.env.PERF ? describe : describe.skip;
const png = readFileSync(path.resolve(__dirname, "../fixtures/opaque.png")).toString("base64");
const t = async <T,>(label: string, fn: () => Promise<T> | T) => {
  const start = performance.now();
  const out = await fn();
  console.log(`PERF ${label}: ${Math.round(performance.now() - start)} ms`);
  return out;
};
const render = (doc: NormalizedDoc, output: "pdf" | "docx", settings: PageSettings = defaultSettings) => runRender({ kind: "doc", doc, output, settings, title: "t" });

run("phase 3 timings (node, main thread; browser workers add ~0)", () => {
  it("measures", async () => {
    const md = Array.from({ length: 2000 }, (_, i) => `## Heading ${i}\n\nParagraph **${i}** with *style* and a [link](https://example.com). ${"Lorem ipsum dolor sit amet. ".repeat(10)}\n\n- item a\n- item b\n`).join("\n");
    const mdDoc = await t(`parse markdown ${(md.length / 1024).toFixed(0)} KB`, () => parseMarkdown(md));
    const pages = (await t("render md → PDF (sans)", () => render(mdDoc, "pdf"))).pageCount;
    console.log(`PERF md pdf pages: ${pages}`);
    await t("render md → PDF (serif, first use incl. font load)", () => render(mdDoc, "pdf", { ...defaultSettings, style: { fontFamily: "serif" } }));
    await t("render md → PDF (serif, warm)", () => render(mdDoc, "pdf", { ...defaultSettings, style: { fontFamily: "serif" } }));
    await t("render md → DOCX", () => render(mdDoc, "docx"));

    const csv = "id,name,amount,note\n" + Array.from({ length: 19999 }, (_, i) => `${i},name ${i},${i * 3.5},some note ${i}`).join("\n");
    const csvDoc = await t(`parse CSV 20,000 rows ${(csv.length / 1024).toFixed(0)} KB`, () => parseCsv(csv, "balanced"));
    await t("reparse CSV with other delimiter (options change)", () => parseCsv(csv, "balanced", { csvDelimiter: ";", csvHeader: "none" }));
    const csvPages = (await t("render CSV 20,000 rows → PDF", () => render(csvDoc, "pdf"))).pageCount;
    console.log(`PERF csv pdf pages: ${csvPages}`);
    await t("render CSV 20,000 rows → DOCX", () => render(csvDoc, "docx"));

    const html = `<html><body>${Array.from({ length: 40 }, (_, i) => `<h2 style="color:#1e3a8a">Section ${i}</h2><p style="text-align:justify">${"Text with <b>bold</b> and <u>underline</u>. ".repeat(20)}</p><img alt="i${i}" src="data:image/png;base64,${png}">`).join("")}</body></html>`;
    const htmlDoc = await t(`parse HTML with 40 images ${(html.length / 1024).toFixed(0)} KB`, () => parseHtml(html, "balanced"));
    await t("render HTML+40 images → PDF", () => render(htmlDoc, "pdf"));
    await t("render HTML+40 images → DOCX", () => render(htmlDoc, "docx"));
  }, 600000);
});
