// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { parseCsv } from "@/engine/parsers/csv";
import { parseHtml } from "@/engine/parsers/html";
import { parseMarkdown } from "@/engine/parsers/markdown";
import { runRender } from "@/engine/render";
import { defaultSettings } from "./helpers";

const out = process.env.ARTIFACT_DIR!;
const fx = (n: string) => readFileSync(path.resolve(__dirname, "../fixtures", n), "utf8");
it.skipIf(!out)("writes artifacts", async () => {
  mkdirSync(out, { recursive: true });
  const docs = { md: parseMarkdown(fx("sample.md")), html: parseHtml(fx("sample.html"), "balanced"), csv: parseCsv(fx("sample.csv"), "balanced"), wide: parseCsv(fx("wide.csv"), "balanced") };
  for (const [name, doc] of Object.entries(docs)) {
    const settings = name === "wide" ? { ...defaultSettings, orientation: "landscape" as const, margins: "narrow" as const } : defaultSettings;
    for (const output of ["pdf", "docx"] as const) {
      const r = await runRender({ kind: "doc", doc, output, settings, title: name });
      writeFileSync(path.join(out, `${name}.${output}`), r.bytes);
    }
  }
});
