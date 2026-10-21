import JSZip from "jszip";

/** Extracts text per page from a PDF using pdf.js, independent of our own verification code. */
export async function extractPdf(bytes: Uint8Array): Promise<{ pages: string[]; numPages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { pages, numPages };
}

export async function docxXml(bytes: Uint8Array): Promise<{ xml: string; zip: JSZip }> {
  const zip = await JSZip.loadAsync(bytes);
  return { xml: await zip.file("word/document.xml")!.async("string"), zip };
}

export const defaultSettings = {
  pageSize: "A4" as const,
  orientation: "portrait" as const,
  margins: "normal" as const,
  imageQuality: "balanced" as const,
  imageFit: "fit" as const,
};

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
}

/** Independent layout facts read with pdf.js: per page size, positioned text items, fills, images. */
export async function pdfLayout(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const OPS = pdfjs.OPS;
  const pages: { width: number; height: number; items: TextItem[]; fills: string[]; images: number; paths: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const [x0, y0, x1, y1] = page.view;
    const tc = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of tc.items) {
      if ("str" in it && it.str.trim()) items.push({ str: it.str, x: it.transform[4]!, y: it.transform[5]!, width: it.width, height: it.height, font: it.fontName });
    }
    const ops = await page.getOperatorList();
    const fills: string[] = [];
    let images = 0;
    let paths = 0;
    ops.fnArray.forEach((fn, k) => {
      const args = ops.argsArray[k] as unknown[];
      if (fn === OPS.setFillRGBColor) fills.push(String(args[0]).toLowerCase());
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) images++;
      else if (fn === OPS.constructPath) paths++;
    });
    pages.push({ width: x1! - x0!, height: y1! - y0!, items, fills, images, paths });
  }
  await task.destroy();
  return pages;
}

/** Hex string "#rrggbb" as pdf.js reports fill colors. */
export const hex = (h: string) => h.toLowerCase();

/** Reads a DOCX with python-docx (an independent parser) and returns a JSON summary. */
export async function pythonDocx(bytes: Uint8Array): Promise<Record<string, any>> {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "ff-docx-"));
  const file = path.join(dir, "t.docx");
  writeFileSync(file, bytes);
  const script = `
import json, sys, docx
from docx.oxml.ns import qn
d = docx.Document(sys.argv[1])
s = d.sections[0]
out = {
  "core": {"title": d.core_properties.title, "author": d.core_properties.author, "subject": d.core_properties.subject, "keywords": d.core_properties.keywords},
  "page": {"w": s.page_width.pt, "h": s.page_height.pt, "left": s.left_margin.pt, "top": s.top_margin.pt, "orient": str(s.orientation)},
  "header": [p.text for p in s.header.paragraphs],
  "footer": [p.text for p in s.footer.paragraphs],
  "footer_xml": s.footer._element.xml,
  "paras": [],
  "tables": [],
  "images": len(d.inline_shapes),
}
for p in d.paragraphs:
    runs = [{"t": r.text, "b": r.bold, "i": r.italic, "u": r.underline, "strike": r.font.strike, "color": str(r.font.color.rgb) if r.font.color is not None and r.font.color.type is not None else None, "font": r.font.name, "size": r.font.size.pt if r.font.size else None} for r in p.runs]
    pPr = p._p.pPr
    out["paras"].append({"style": p.style.name, "align": str(p.alignment) if p.alignment is not None else None, "text": p.text, "runs": runs, "pageBreakBefore": bool(p.paragraph_format.page_break_before), "hasBr": 'w:br w:type="page"' in p._p.xml or "w:type=\\"page\\"" in p._p.xml, "links": len(p._p.findall(qn("w:hyperlink")))})
for t in d.tables:
    rows = []
    for r in t.rows:
        rows.append([{"t": c.text, "fill": (c._tc.tcPr.find(qn("w:shd")).get(qn("w:fill")) if c._tc.tcPr is not None and c._tc.tcPr.find(qn("w:shd")) is not None else None), "align": str(c.paragraphs[0].alignment) if c.paragraphs[0].alignment is not None else None} for c in r.cells])
    out["tables"].append({"rows": rows, "headerRepeat": 'w:tblHeader' in t._tbl.xml})
out["styles"] = {}
out["styleCounts"] = {}
for x in d.styles:
    if x.name is None: continue
    out["styleCounts"][x.name] = out["styleCounts"].get(x.name, 0) + 1
    try:
        out["styles"][x.name] = {"font": x.font.name, "size": x.font.size.pt if x.font.size else None, "bold": x.font.bold}
    except Exception:
        pass
print(json.dumps(out))
`;
  const spath = path.join(dir, "read.py");
  writeFileSync(spath, script);
  const res = execFileSync("python3", ["-I", spath, file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(res);
}
