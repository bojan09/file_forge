// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeColor } from "@/engine/parsers/common";
import { parseCsv } from "@/engine/parsers/csv";
import { parseHtml } from "@/engine/parsers/html";
import { parseMarkdown } from "@/engine/parsers/markdown";
import type { Block, NormalizedDoc } from "@/engine/types";
import { runRender } from "@/engine/render";
import { defaultSettings, extractPdf } from "./helpers";

const fx = (n: string) => readFileSync(path.resolve(__dirname, "../fixtures", n));
const b64 = (n: string) => fx(n).toString("base64");
const png = b64("opaque.png");
const jpg = b64("photo.jpg");
const warnCodes = (d: NormalizedDoc) => d.warnings.map((w) => w.code);
const kinds = (d: NormalizedDoc) => d.blocks.map((b) => b.type);
const firstPara = (d: NormalizedDoc) => d.blocks.find((b) => b.type === "paragraph") as Extract<Block, { type: "paragraph" }>;
const pdfText = async (d: NormalizedDoc) => (await extractPdf((await runRender({ kind: "doc", doc: d, output: "pdf", settings: defaultSettings, title: "t" })).bytes)).pages.join(" ").replace(/\s+/g, " ");

describe("colors", () => {
  it.each([
    ["#c00", "#cc0000"],
    ["#1E3A8A", "#1e3a8a"],
    ["rgb(10, 20, 30)", "#0a141e"],
    ["rgba(10 20 30 / 50%)", "#0a141e"],
    ["navy", "#1e3a8a"],
  ])("%s → %s", (input, out) => expect(normalizeColor(input)).toBe(out));
  it.each(["white", "#fff", "#fefefe", "rgb(250,250,250)", "var(--x)", "url(x)", "expression(alert(1))", "", "#12"])("rejects %s", (input) => expect(normalizeColor(input)).toBeUndefined());
});

describe("HTML inline styles", () => {
  const html = `<h1 style="text-align:center;color:#1e3a8a">Title</h1>
    <p style="text-align:right">Right</p>
    <p>Plain <u>u</u> <ins>ins</ins> <span style="color:red;font-weight:700;font-style:italic;text-decoration:underline line-through">styled</span> <font color="#0a0">old font</font></p>
    <div style="text-align:center"><p>inherits</p><p style="text-align:left">override</p></div>
    <center>centered tag</center>
    <p align="right">attr align</p>`;
  const d = parseHtml(html, "balanced");

  it("reads color, alignment, underline, strike, bold, italic", () => {
    const [h] = d.blocks;
    expect(h).toMatchObject({ type: "heading", level: 1, align: "center" });
    expect((h as Extract<Block, { type: "heading" }>).runs[0]!.color).toBe("#1e3a8a");
    const styled = (d.blocks.find((b) => b.type === "paragraph" && b.runs.some((r) => r.text === "styled")) as Extract<Block, { type: "paragraph" }>).runs.find((r) => r.text === "styled")!;
    expect(styled).toMatchObject({ bold: true, italic: true, underline: true, strike: true });
    expect(styled.color).toBe("#c00000");
    const plain = (d.blocks.find((b) => b.type === "paragraph" && b.runs.some((r) => r.text === "u")) as Extract<Block, { type: "paragraph" }>).runs;
    expect(plain.find((r) => r.text === "u")!.underline).toBe(true);
    expect(plain.find((r) => r.text === "ins")!.underline).toBe(true);
    expect(plain.find((r) => r.text === "old font")!.color).toBe("#00aa00");
  });

  it("applies alignment from style, attribute, <center> and inheritance", () => {
    const align = (t: string) => (d.blocks.find((b) => b.type === "paragraph" && b.runs.some((r) => r.text.includes(t))) as Extract<Block, { type: "paragraph" }>).align;
    expect(align("Right")).toBe("right");
    expect(align("inherits")).toBe("center");
    expect(align("override")).toBe("left");
    expect(align("centered tag")).toBe("center");
    expect(align("attr align")).toBe("right");
  });

  it("reports unsupported CSS by name instead of ignoring it silently", () => {
    const x = parseHtml(`<p style="float:left;margin:4px;color:red;position:absolute">x</p><style>p{color:blue}</style>`, "balanced");
    const w = x.warnings.find((m) => m.code === "css-ignored")!;
    expect(w.message).toMatch(/float/);
    expect(w.message).toMatch(/position/);
    expect(w.message).toMatch(/stylesheet/);
    expect(w.message).toMatch(/3 inline style declarations/);
  });

  it("drops near-white text colors and says so", () => {
    const x = parseHtml(`<p style="color:#ffffff">ghost</p><p style="color:white">ghost2</p>`, "balanced");
    expect(firstPara(x).runs[0]!.color).toBeUndefined();
    expect(warnCodes(x)).toContain("light-colors");
  });

  it("turns page-break styles into page breaks, before and after", () => {
    const x = parseHtml(`<p>a</p><div style="page-break-before:always"></div><p>b</p><p style="break-after:page">c</p><p>d</p>`, "balanced");
    expect(kinds(x)).toEqual(["paragraph", "pagebreak", "paragraph", "paragraph", "pagebreak", "paragraph"]);
  });

  it("never lets CSS payloads through to the model", () => {
    const x = parseHtml(`<p style="color:red;background:url(https://evil.example/x.png);behavior:url(x.htc);width:expression(alert(1))" onclick="alert(1)">safe <b onmouseover="x()">text</b></p><script>alert(1)</script>`, "balanced");
    const json = JSON.stringify(x.blocks);
    expect(json).not.toMatch(/evil|expression|alert|onclick|behavior/);
    expect(warnCodes(x)).toContain("css-ignored");
  });

  it("table cells keep style and column alignment", () => {
    const x = parseHtml(`<table><tr><th align="right">N</th><th>T</th></tr><tr><td style="text-align:right;color:red">1</td><td>x</td></tr></table>`, "balanced");
    const t = x.blocks[0] as Extract<Block, { type: "table" }>;
    expect(t.align?.[0]).toBe("right");
    expect(t.autoAlign).toBe(false);
    expect(t.rows[0]![0]![0]!.color).toBe("#c00000");
  });

  it("reads author, description and keywords into document properties", () => {
    const x = parseHtml(`<html><head><title>T</title><meta name="author" content="A. Writer"><meta name="description" content="About"><meta name="keywords" content="one, two ,three"></head><body><p>x</p></body></html>`, "balanced");
    expect(x.meta).toMatchObject({ title: "T", author: "A. Writer", subject: "About", keywords: ["one", "two", "three"] });
  });
});

describe("HTML images", () => {
  it("embeds PNG and JPEG data URIs as image blocks, in order, with alt text and alignment", () => {
    const x = parseHtml(`<p>before</p><img alt="logo" src="data:image/png;base64,${png}"><p style="text-align:center"><img alt="photo" src="data:image/jpeg;base64,${jpg}"></p><p>after</p>`, "balanced");
    expect(kinds(x)).toEqual(["paragraph", "image", "image", "paragraph"]);
    const [, a, b] = x.blocks as Extract<Block, { type: "image" }>[];
    expect(a!.image).toMatchObject({ mime: "image/png", alt: "logo" });
    expect(a!.image.width).toBe(320);
    expect(b!.image.mime).toBe("image/jpeg");
    expect(b!.align).toBe("center");
    expect(x.imageCount).toBe(2);
  });

  it("lifts an image out of a link wrapper and out of a paragraph with text", () => {
    const x = parseHtml(`<a href="https://example.com"><img alt="l" src="data:image/png;base64,${png}"></a><p>caption <img alt="i" src="data:image/png;base64,${png}"> tail</p>`, "balanced");
    expect(x.blocks.filter((b) => b.type === "image")).toHaveLength(2);
    expect(JSON.stringify(x.blocks)).toContain("caption");
    expect(JSON.stringify(x.blocks)).toContain("tail");
  });

  it("never fetches remote or relative images; leaves a placeholder and a warning", () => {
    const x = parseHtml(`<img alt="remote" src="https://example.com/a.png"><img alt="rel" src="pic.png"><img src="//cdn.example/x.png">`, "balanced");
    expect(x.blocks.some((b) => b.type === "image")).toBe(false);
    expect(JSON.stringify(x.blocks)).toContain("[image: remote]");
    expect(x.warnings.find((w) => w.code === "images-skipped")!.message).toMatch(/3 linked images were not loaded/);
  });

  it("rejects corrupt, non-image, SVG and WebP payloads without throwing", () => {
    const truncated = Buffer.from(fx("opaque.png").subarray(0, 60)).toString("base64");
    const x = parseHtml(
      `<p>t</p><img alt="trunc" src="data:image/png;base64,${truncated}"><img alt="svg" src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="><img alt="webp" src="data:image/webp;base64,${b64("image.webp")}"><img alt="lie" src="data:image/png;base64,${Buffer.from("not a png at all").toString("base64")}"><img alt="bad" src="data:image/png;base64,@@@@">`,
      "balanced",
    );
    expect(x.blocks.some((b) => b.type === "image")).toBe(false);
    expect(x.imageCount).toBe(0);
    expect(warnCodes(x)).toContain("images-skipped");
  });

  it("enforces the per-image size limit", () => {
    const big = Buffer.concat([fx("opaque.png").subarray(0, 33), Buffer.alloc(5 * 1024 * 1024)]).toString("base64");
    const x = parseHtml(`<p>t</p><img alt="big" src="data:image/png;base64,${big}">`, "balanced");
    expect(x.blocks.some((b) => b.type === "image")).toBe(false);
    expect(x.warnings.find((w) => w.code === "images-skipped")!.message).toMatch(/limits/);
  });

  it("an image-only document is valid", () => {
    const x = parseHtml(`<img alt="only" src="data:image/png;base64,${png}">`, "balanced");
    expect(x.imageCount).toBe(1);
  });

  it("images inside headings or table cells fall back to alt text and are reported", () => {
    const x = parseHtml(`<h2>Head <img alt="hi" src="data:image/png;base64,${png}"></h2><table><tr><td><img alt="cell" src="data:image/png;base64,${png}"></td></tr></table>`, "balanced");
    expect(warnCodes(x)).toContain("images-inline");
    expect(x.blocks.some((b) => b.type === "image")).toBe(false);
  });
});

describe("Markdown", () => {
  it("embeds data-URI images as blocks and keeps remote ones as reported placeholders", () => {
    const d = parseMarkdown(`Intro\n\n![local](data:image/png;base64,${png})\n\nText with ![inline](data:image/png;base64,${png}) image and ![remote](https://example.com/x.png).\n`);
    expect(kinds(d)).toEqual(["paragraph", "image", "paragraph", "image"]);
    expect(JSON.stringify(d.blocks)).toContain("[image: remote]");
    expect(warnCodes(d)).toEqual(expect.arrayContaining(["images-embedded", "images-skipped"]));
  });

  it("renders task lists with markers and no bullet, without leaking '[x]'", async () => {
    const d = parseMarkdown("- [x] done\n- [ ] todo\n- [X] also\n");
    const list = d.blocks[0] as Extract<Block, { type: "list" }>;
    expect(list.plain).toBe(true);
    expect(list.items.map((i) => i.runs[0]!.text)).toEqual(["● done", "○ todo", "● also"]);
    expect(d.hasLists).toBe(false);
    const t = await pdfText(d);
    expect(t).toContain("● done");
    expect(t).not.toMatch(/\[[ xX]\]/);
  });

  it("mixed lists keep bullets", () => {
    const d = parseMarkdown("- [x] done\n- plain\n");
    expect((d.blocks[0] as Extract<Block, { type: "list" }>).plain).toBeUndefined();
  });

  it("reads front matter into properties and removes it from the body", () => {
    const d = parseMarkdown("---\ntitle: \"My Doc\"\nauthor: Jane\ndescription: A summary\nkeywords: [a, b]\n---\n\nBody text\n");
    expect(d.meta).toMatchObject({ title: "My Doc", author: "Jane", subject: "A summary", keywords: ["a", "b"] });
    expect(JSON.stringify(d.blocks)).not.toContain("author");
    expect(d.title).toBe("My Doc");
  });

  it("does not treat a lone horizontal rule at the top as front matter", () => {
    const d = parseMarkdown("---\n\nText\n\n---\n\nMore");
    expect(d.meta).toBeUndefined();
    expect(kinds(d)).toContain("rule");
  });

  it("converts page-break markers and removes HTML comments", () => {
    const d = parseMarkdown("one\n\n<!-- pagebreak -->\n\ntwo\n\n\\newpage\n\nthree\n\n<!-- a hidden note -->\n\nfour");
    expect(kinds(d)).toEqual(["paragraph", "pagebreak", "paragraph", "pagebreak", "paragraph", "paragraph"]);
    expect(JSON.stringify(d.blocks)).not.toContain("hidden note");
  });

  it("honours <br> and counts other raw HTML as text, with a note", () => {
    const d = parseMarkdown("line one<br>line two<br/>line three and <span>raw</span>");
    const runs = firstPara(d).runs.map((r) => r.text).join("");
    expect(runs).toContain("line one\nline two\nline three");
    expect(warnCodes(d)).toContain("raw-html");
  });

  it("source mode keeps everything verbatim as one code block", () => {
    const src = "# Title\n\n**bold** and [x](y)\n\n\tindented";
    const d = parseMarkdown(src, { markdown: "source" });
    expect(d.blocks).toHaveLength(1);
    expect((d.blocks[0] as Extract<Block, { type: "code" }>).text).toContain("**bold** and [x](y)");
    expect(warnCodes(d)).toContain("markdown-source");
  });

  it("unbalanced and hostile Markdown still parses", () => {
    for (const src of ["**bold", "[link](", "![img](", "| a | b\n|--", "```\nunclosed", "> > > deep\n> - [ ]", "<script>alert(1)</script>", "[x](javascript:alert(1))"]) {
      expect(() => parseMarkdown(src)).not.toThrow();
    }
    const d = parseMarkdown("[x](javascript:alert(1))");
    // markdown-it refuses the link, so the source stays visible text; nothing is clickable.
    expect(JSON.stringify(d.blocks)).not.toContain('"link"');
  });
});

describe("CSV options", () => {
  const rowsOf = (d: NormalizedDoc) => (d.blocks[0] as Extract<Block, { type: "table" }>);
  const cell = (c: { text: string }[]) => c.map((r) => r.text).join("");

  it.each([
    [",", "a,b,c\n1,2,3"],
    [";", "a;b;c\n1;2;3"],
    ["\t", "a\tb\tc\n1\t2\t3"],
    ["|", "a|b|c\n1|2|3"],
  ] as const)("overrides the delimiter to %j", (delim, src) => {
    const t = rowsOf(parseCsv(src, "balanced", { csvDelimiter: delim, csvHeader: "first" }));
    expect(t.header).toHaveLength(3);
    expect(cell(t.rows[0]![2]!)).toBe("3");
  });

  it("an explicit delimiter wins over auto-detection", () => {
    const src = "a,b;c\n1,2;3";
    expect(rowsOf(parseCsv(src, "balanced", { csvDelimiter: "auto", csvHeader: "first" })).header).toHaveLength(2);
    expect(rowsOf(parseCsv(src, "balanced", { csvDelimiter: ";", csvHeader: "first" })).header).toHaveLength(2);
    const comma = rowsOf(parseCsv(src, "balanced", { csvDelimiter: ",", csvHeader: "first" }));
    expect(cell(comma.header![1]!)).toBe("b;c");
  });

  it("reports the delimiter it used", () => {
    const d = parseCsv("a;b\n1;2", "balanced");
    expect(d.warnings.find((w) => w.code === "csv-delimiter")!.message).toMatch(/Detected semicolon/);
    const e = parseCsv("a;b\n1;2", "balanced", { csvDelimiter: "|", csvHeader: "first" });
    expect(e.warnings.find((w) => w.code === "csv-delimiter")!.message).toMatch(/Using pipe/);
  });

  it("header 'none' keeps every row as data", () => {
    const t = rowsOf(parseCsv("1,2\n3,4\n5,6", "balanced", { csvDelimiter: "auto", csvHeader: "none" }));
    expect(t.header).toBeNull();
    expect(t.rows).toHaveLength(3);
  });

  it("quoted fields: embedded delimiters, quotes, and newlines survive", () => {
    const src = 'name,quote\n"Smith, J.","He said ""hi"""\n"Line\nbreak",x\n';
    const t = rowsOf(parseCsv(src, "balanced"));
    expect(cell(t.rows[0]![0]!)).toBe("Smith, J.");
    expect(cell(t.rows[0]![1]!)).toBe('He said "hi"');
    expect(cell(t.rows[1]![0]!)).toBe("Line\nbreak");
  });

  it("keeps rows of empty cells and reports (not hides) blank lines", () => {
    const d = parseCsv("a,b\n,\n1,2\n\n\n3,4\n", "balanced");
    const t = rowsOf(d);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]!.every((c) => c.length === 0)).toBe(true);
    expect(warnCodes(d)).toContain("blank-lines");
  });

  it("keeps all 5000 rows and 40 columns, and refuses (not truncates) beyond the limit", () => {
    const wide = Array.from({ length: 40 }, (_, c) => `c${c}`).join(",");
    const row = Array.from({ length: 40 }, (_, c) => `v${c}`).join(",");
    const d = parseCsv(`${wide}\n${Array(5000).fill(row).join("\n")}`, "balanced");
    expect(rowsOf(d).rows).toHaveLength(5000);
    expect(rowsOf(d).header).toHaveLength(40);
    expect(() => parseCsv(`a,b\n${Array(20001).fill("1,2").join("\n")}`, "balanced")).toThrow(/row limit|rows/);
    expect(() => parseCsv(Array(41).fill("x").join(",") + "\n1", "balanced")).toThrow(/columns/);
  });

  it("Unicode values and BOM-less UTF-8 survive into the PDF", async () => {
    const d = parseCsv("име,град\nЈован,Скопје\nZoë,Łódź\n", "balanced");
    const t = await pdfText(d);
    for (const w of ["име", "Јован", "Скопје", "Zoë", "Łódź"]) expect(t).toContain(w);
  });

  it("ragged rows are padded and flagged", () => {
    const d = parseCsv("a,b,c\n1,2\n1,2,3,4", "balanced");
    expect(rowsOf(d).rows.every((r) => r.length === 4)).toBe(true);
    expect(warnCodes(d)).toContain("ragged-rows");
  });
});
