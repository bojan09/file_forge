import { describe, expect, it } from "vitest";
import { parseMarkdown } from "@/engine/parsers/markdown";
import { runRender } from "@/engine/render";
import { defaultSettings, extractPdf } from "./helpers";

describe("smoke", () => {
  it("renders markdown to searchable PDF", async () => {
    const doc = parseMarkdown("# Title\n\nHello **world** — Здраво свету ќ ѓ\n\n- a\n- b\n");
    const res = await runRender({ kind: "doc", doc, output: "pdf", settings: defaultSettings, title: "t" });
    const { pages } = await extractPdf(res.bytes);
    console.log(pages, res.checks);
    expect(pages.join(" ")).toContain("Hello");
  });
});
