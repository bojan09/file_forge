import { describe, expect, it } from "vitest";
import { parseCsv } from "@/engine/parsers/csv";
import { parseMarkdown } from "@/engine/parsers/markdown";
import { parseTxt } from "@/engine/parsers/txt";
import { FileForgeError } from "@/engine/types";

const text = (runs: { text: string }[]) => runs.map((r) => r.text).join("");

describe("parseTxt", () => {
  it("splits paragraphs on blank lines and keeps hard line breaks", () => {
    const doc = parseTxt("one\ntwo\n\n\nthree\r\nfour\r\n");
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(text((doc.blocks[0] as { runs: { text: string }[] }).runs)).toBe("one\ntwo");
    expect(text((doc.blocks[1] as { runs: { text: string }[] }).runs)).toBe("three\nfour");
  });
  it("expands tabs, strips control characters, keeps Unicode", () => {
    const doc = parseTxt("a\tb\u0000c\u0007 ќ Ж 中");
    expect(text((doc.blocks[0] as { runs: { text: string }[] }).runs)).toBe("a    bc ќ Ж 中");
  });
  it("handles very long text", () => {
    const doc = parseTxt(("word ".repeat(50) + "\n\n").repeat(5000));
    expect(doc.blocks).toHaveLength(5000);
  });
});

describe("parseMarkdown", () => {
  const md = `# Title\n\nSome **bold**, *italic*, ~~gone~~, \`code\` and [ok](https://example.com) and [bad](javascript:alert(1)).\n\n- a\n  - nested\n- b\n\n1. one\n2. two\n\n> quote\n\n\`\`\`\nlet x = 1;\n\`\`\`\n\n| H1 | H2 |\n|:--|--:|\n| a | b |\n| c | d |\n\n![alt text](http://x/y.png)\n\n<script>alert(1)</script>\n\n---\n`;
  const doc = parseMarkdown(md);
  it("maps supported structure", () => {
    const types = doc.blocks.map((b) => b.type);
    expect(types).toEqual(expect.arrayContaining(["heading", "paragraph", "list", "quote", "code", "table", "rule"]));
    expect(doc.hasTables && doc.hasLists && doc.hasHeadings).toBe(true);
    expect(doc.title).toBe("Title");
  });
  it("keeps emphasis and only safe links", () => {
    const p = doc.blocks.find((b) => b.type === "paragraph")!;
    if (p.type !== "paragraph") throw new Error();
    expect(p.runs.some((r) => r.bold && r.text === "bold")).toBe(true);
    expect(p.runs.some((r) => r.italic && r.text === "italic")).toBe(true);
    expect(p.runs.some((r) => r.strike && r.text === "gone")).toBe(true);
    expect(p.runs.some((r) => r.code && r.text === "code")).toBe(true);
    expect(p.runs.find((r) => r.text === "ok")?.link).toBe("https://example.com/");
    expect(p.runs.find((r) => r.text === "bad")?.link).toBeUndefined();
  });
  it("parses nested lists and table alignment", () => {
    const list = doc.blocks.find((b) => b.type === "list" && !b.ordered);
    expect(list && list.type === "list" && list.items[0]!.children?.[0]).toMatchObject({ type: "list" });
    const table = doc.blocks.find((b) => b.type === "table");
    expect(table && table.type === "table" && table.align).toEqual(["left", "right"]);
    expect(table && table.type === "table" && table.rows).toHaveLength(2);
  });
  it("never interprets raw HTML and reports skipped images", () => {
    const all = JSON.stringify(doc.blocks);
    expect(all).toContain("<script>alert(1)</script>");
    expect(doc.warnings.some((w) => w.code === "images-skipped")).toBe(true);
    expect(all).toContain("[image: alt text]");
  });
});

describe("parseCsv", () => {
  it("parses quotes, commas and newlines inside cells; pads ragged rows", () => {
    const doc = parseCsv('a,b,c\n1,"x, ""y""",3\n"multi\nline",5\n', "balanced");
    const t = doc.blocks[0]!;
    if (t.type !== "table") throw new Error();
    expect(text(t.header![1]!)).toBe("b");
    expect(text(t.rows[0]![1]!)).toBe('x, "y"');
    expect(text(t.rows[1]![0]!)).toBe("multi\nline");
    expect(t.rows[1]).toHaveLength(3);
    expect(doc.warnings.some((w) => w.code === "ragged-rows")).toBe(true);
  });
  it("detects semicolon and tab delimiters", () => {
    const semi = parseCsv("a;b\n1;2\n", "balanced").blocks[0]!;
    expect(semi.type === "table" && semi.header).toHaveLength(2);
    const tab = parseCsv("a\tb\n1\t2\n", "balanced").blocks[0]!;
    expect(tab.type === "table" && tab.header).toHaveLength(2);
  });
  it("warns about wide tables", () => {
    const head = Array.from({ length: 20 }, (_, i) => `c${i}`).join(",");
    const doc = parseCsv(`${head}\n${head}\n`, "balanced");
    expect(doc.warnings.some((w) => w.code === "wide-table" && w.level === "warn")).toBe(true);
  });
  it("rejects too many rows, too many columns, and empty input", () => {
    const rows = "a,b\n" + "1,2\n".repeat(5001);
    expect(() => parseCsv(rows, "conservative")).toThrow(FileForgeError);
    expect(() => parseCsv(rows, "balanced")).not.toThrow();
    const wide = Array.from({ length: 45 }, (_, i) => i).join(",");
    expect(() => parseCsv(`${wide}\n${wide}`, "balanced")).toThrow(/columns/);
    expect(() => parseCsv("\n\n", "balanced")).toThrow(/no rows/);
  });
  it("shows malformed quotes as a warning instead of crashing", () => {
    const doc = parseCsv('a,b\n"unterminated,2\n', "balanced");
    expect(doc.blocks).toHaveLength(1);
  });
});
