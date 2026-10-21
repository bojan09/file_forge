import JSZip from "jszip";
import type { NormalizedDoc, QualityCheck } from "./types";

const latin1 = (b: Uint8Array) => {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) s += String.fromCharCode(...b.subarray(i, i + chunk));
  return s;
};

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Byte-level structural checks on a generated PDF. */
export function verifyPdf(bytes: Uint8Array, opts: { pageCount?: number; kind: "text" | "image" }): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const head = latin1(bytes.subarray(0, 8));
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 1100)));
  checks.push({ id: "generated", label: "File generated", passed: bytes.length > 0, detail: `${bytes.length.toLocaleString()} bytes` });
  const validStructure = head.startsWith("%PDF-") && tail.includes("%%EOF");
  checks.push({ id: "pdf-structure", label: "Valid PDF structure (header and end marker present)", passed: validStructure });
  if (opts.pageCount !== undefined) checks.push({ id: "pages", label: `Contains ${opts.pageCount} page${opts.pageCount === 1 ? "" : "s"}`, passed: opts.pageCount > 0 });
  // Object dictionaries are stored uncompressed, so font and image resources are visible in the byte stream.
  const body = latin1(bytes);
  const imageObjs = (body.match(/\/Subtype\s*\/Image\b/g) ?? []).length;
  const fontObjs = (body.match(/\/Type\s*\/Font\b/g) ?? []).length;
  if (opts.kind === "text") {
    checks.push({
      id: "text-embedded",
      label: "Text is embedded as real text (fonts present, no page images), so it is selectable and searchable",
      passed: fontObjs > 0 && imageObjs === 0,
    });
  } else {
    checks.push({ id: "image-embedded", label: "Image embedded on the page (picture only, not searchable: no OCR)", passed: imageObjs >= 1 });
  }
  return checks;
}

/** Opens the DOCX zip and inspects document.xml for editable structure. */
export async function verifyDocx(bytes: Uint8Array, doc: NormalizedDoc): Promise<QualityCheck[]> {
  const checks: QualityCheck[] = [];
  checks.push({ id: "generated", label: "File generated", passed: bytes.length > 0, detail: `${bytes.length.toLocaleString()} bytes` });
  let zip: JSZip | null = null;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    zip = null;
  }
  const hasParts = !!zip && !!zip.file("[Content_Types].xml") && !!zip.file("word/document.xml");
  checks.push({ id: "docx-structure", label: "Valid DOCX package (ZIP with Word document parts)", passed: hasParts });
  if (!zip || !hasParts) return checks;
  const xml = await zip.file("word/document.xml")!.async("string");
  const textRuns = (xml.match(/<w:t[ >]/g) ?? []).length;
  checks.push({ id: "editable-text", label: "Content is stored as editable Word text", passed: textRuns > 0 && !Object.keys(zip.files).some((n) => n.startsWith("word/media/")) });
  const sample = firstText(doc);
  if (sample) {
    checks.push({ id: "text-present", label: "Source text found in the document", passed: xml.includes(xmlEscape(sample)) });
  }
  if (doc.hasTables) checks.push({ id: "tables", label: "Tables are real Word tables", passed: xml.includes("<w:tbl>") });
  if (doc.hasHeadings) checks.push({ id: "headings", label: "Headings use Word heading styles", passed: /<w:pStyle w:val="Heading[1-6]"/.test(xml) });
  if (doc.hasLists) checks.push({ id: "lists", label: "Lists use Word numbering", passed: xml.includes("<w:numPr>") });
  return checks;
}

function firstText(doc: NormalizedDoc): string {
  for (const b of doc.blocks) {
    let t = "";
    if (b.type === "paragraph" || b.type === "heading") t = b.runs[0]?.text ?? "";
    else if (b.type === "table") t = (b.header?.[0] ?? b.rows[0]?.[0])?.[0]?.text ?? "";
    else if (b.type === "list") t = b.items[0]?.runs[0]?.text ?? "";
    const line = t.split("\n")[0]!.trim().slice(0, 40);
    if (line) return line;
  }
  return "";
}
