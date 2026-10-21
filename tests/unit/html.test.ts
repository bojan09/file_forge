// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseHtml } from "@/engine/parsers/html";
import { FileForgeError } from "@/engine/types";

const all = (html: string) => {
  const doc = parseHtml(html, "balanced");
  return { doc, json: JSON.stringify(doc.blocks) };
};

describe("parseHtml", () => {
  it("maps a document subset", () => {
    const { doc, json } = all(`<h1>T</h1><p>A <b>bold</b> <i>it</i> <a href="https://e.com">l</a></p><ul><li>x<ul><li>y</li></ul></li></ul><ol><li>1</li></ol><pre>a\n  b</pre><blockquote><p>q</p></blockquote><hr><table><tr><th>H</th></tr><tr><td>c</td></tr></table>`);
    expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "code", "quote", "rule", "table"]);
    expect(json).toContain('"link":"https://e.com/"');
    const table = doc.blocks[7]!;
    expect(table.type === "table" && table.header).toHaveLength(1);
    expect(doc.warnings.some((w) => w.code === "approximate")).toBe(true);
  });

  it("drops scripts, event handlers, javascript: links, iframes and reports remote resources", () => {
    const { doc, json } = all(`<body onload="x()"><script>evil()</script><p onclick="y()">Hello <a href="javascript:alert(1)">bad</a></p><img src="https://evil.example/a.png" onerror="z()"><iframe src="https://evil.example"></iframe><link rel="stylesheet" href="https://evil.example/x.css"><video src="https://evil.example/v">fallback</video></body>`);
    expect(json).toContain("Hello");
    expect(json).not.toMatch(/evil\(|alert|onclick|javascript:|fallback/);
    expect(json).not.toContain('"link":"javascript');
    const codes = doc.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["scripts-removed", "remote-skipped", "media-skipped", "images-skipped", "links-dropped"]));
  });

  it("flags ignored CSS and merged cells", () => {
    const { doc } = all(`<style>p{color:red}</style><p style="color:blue">x</p><table><tr><td colspan="2">a</td></tr></table>`);
    const codes = doc.warnings.map((w) => w.code);
    expect(codes).toContain("css-ignored");
    expect(codes).toContain("table-spans");
  });

  it("tolerates malformed markup and keeps text", () => {
    const { json } = all(`<div>one <span>two</div> three <b>unclosed <p>para`);
    expect(json).toContain("one");
    expect(json).toContain("three");
    expect(json).toContain("para");
  });

  it("collapses whitespace like a browser and keeps Unicode", () => {
    const { doc } = all(`<p>  Здраво \n\n   свету   ќ </p>`);
    const p = doc.blocks[0]!;
    expect(p.type === "paragraph" && p.runs.map((r) => r.text).join("")).toBe("Здраво свету ќ");
  });

  it("rejects documents with no text and over-complex documents", () => {
    expect(() => parseHtml("<div></div><script>1</script>", "balanced")).toThrow(FileForgeError);
    expect(() => parseHtml("<p>x</p>".repeat(31000), "conservative")).toThrow(/elements/);
  });

  it("survives deep nesting", () => {
    const html = "<div>".repeat(500) + "deep text" + "</div>".repeat(500);
    expect(() => parseHtml(html, "balanced")).not.toThrow();
  });
});
