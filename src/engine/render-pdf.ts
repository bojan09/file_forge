import * as pdfMakeNs from "pdfmake/build/pdfmake";
import vfsNs from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { absoluteWidths, columnWeights, pageDims, tableFontSize, textOf } from "./page";
import type { Block, Inline, NormalizedDoc, Orientation, PageSettings, PreparedImage } from "./types";

// The UMD bundle is CommonJS: depending on the bundler, the live module object is the namespace or its `default`.
const pdfMake = ((pdfMakeNs as unknown as { default?: typeof pdfMakeNs }).default ?? pdfMakeNs) as typeof pdfMakeNs;
const vfs = ((vfsNs as unknown as { default?: typeof vfsNs }).default ?? vfsNs) as typeof vfsNs;

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addFonts({
    Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Medium.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-MediumItalic.ttf" },
  });
  fontsReady = true;
}

const LINK = "#1d4ed8";
const HEADING_SIZE = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 11.5, 6: 11 } as const;

function runsToContent(runs: Inline[]): Content[] {
  return runs.map((r) => {
    const node: Record<string, unknown> = { text: r.text };
    if (r.bold) node.bold = true;
    if (r.italic) node.italics = true;
    if (r.strike) node.decoration = "lineThrough";
    if (r.code) node.background = "#eceff4";
    if (r.link) {
      node.link = r.link;
      node.color = LINK;
      node.decoration = r.strike ? ["underline", "lineThrough"] : "underline";
    }
    return node as unknown as Content;
  });
}

function textNode(runs: Inline[], extra: Record<string, unknown> = {}): Content {
  return { text: runsToContent(runs), ...extra } as Content;
}

function blocksToContent(blocks: Block[], contentWidth: number): Content[] {
  const out: Content[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        out.push(textNode(b.runs, { fontSize: HEADING_SIZE[b.level], bold: true, margin: [0, b.level <= 2 ? 14 : 10, 0, 6], headlineLevel: b.level, keepWithNext: true } as Record<string, unknown>));
        break;
      case "paragraph":
        out.push(textNode(b.runs, { margin: [0, 0, 0, 8], lineHeight: 1.3 }));
        break;
      case "list": {
        const items = b.items.map((it) => {
          const head = textNode(it.runs, { lineHeight: 1.25 });
          if (!it.children?.length) return head;
          return { stack: [head, ...blocksToContent(it.children, contentWidth - 18)] } as Content;
        });
        out.push((b.ordered ? { ol: items, margin: [0, 0, 0, 8] } : { ul: items, margin: [0, 0, 0, 8] }) as Content);
        break;
      }
      case "code": {
        const lines = b.text.split("\n");
        out.push({
          margin: [0, 0, 0, 8],
          table: { widths: ["*"], body: lines.map((l) => [{ text: l.length ? l : " ", preserveLeadingSpaces: true, fontSize: 9, lineHeight: 1.15 }]) },
          layout: { fillColor: () => "#f1f3f7", hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 0.5, paddingBottom: () => 0.5 },
        } as Content);
        break;
      }
      case "quote":
        out.push({ stack: blocksToContent(b.blocks, contentWidth - 18), margin: [18, 0, 0, 4], color: "#4b5563", italics: true } as Content);
        break;
      case "rule":
        out.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 0.8, lineColor: "#9ca3af" }], margin: [0, 6, 0, 10] } as Content);
        break;
      case "table": {
        const cols = Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length), 1);
        const size = tableFontSize(cols);
        const pad = cols > 9 ? 2 : 4;
        const widths = absoluteWidths(columnWeights(b), contentWidth, Math.min(34, contentWidth / cols));
        const cell = (runs: Inline[], header: boolean, c: number) => ({
          text: runs.length ? runsToContent(runs) : "",
          bold: header,
          fontSize: size,
          alignment: b.align?.[c] ?? "left",
        });
        const body = [
          ...(b.header ? [b.header.map((r, c) => cell(r, true, c))] : []),
          ...b.rows.map((row) => row.map((r, c) => cell(r, false, c))),
        ];
        out.push({
          margin: [0, 2, 0, 10],
          table: { headerRows: b.header ? 1 : 0, widths, body },
          layout: {
            fillColor: (row: number) => (b.header && row === 0 ? "#e8ecfb" : row % 2 === 0 ? "#f7f8fb" : null),
            hLineColor: () => "#cfd4e0",
            vLineColor: () => "#cfd4e0",
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            paddingLeft: () => pad,
            paddingRight: () => pad,
            paddingTop: () => pad - 1,
            paddingBottom: () => pad - 1,
          },
        } as Content);
        break;
      }
    }
  }
  return out;
}

/** Image bytes must be passed to pdfmake as a data URI. */
function toDataUri(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

export interface PdfOutput {
  bytes: Uint8Array;
  pageCount: number;
}

export async function renderTextPdf(doc: NormalizedDoc, settings: PageSettings, title: string): Promise<PdfOutput> {
  ensureFonts();
  const orientation: Orientation = settings.orientation === "landscape" ? "landscape" : "portrait";
  const dims = pageDims(settings, orientation);
  let pageCount = 0;
  const def: TDocumentDefinitions = {
    info: { title, creator: "FileForge", producer: "FileForge" },
    pageSize: { width: dims.width, height: dims.height },
    pageMargins: [dims.margin, dims.margin, dims.margin, Math.max(dims.margin, 40)],
    defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.25 },
    content: blocksToContent(doc.blocks, dims.contentWidth),
    footer: (current: number, count: number) => {
      pageCount = count;
      return { text: `${current} / ${count}`, alignment: "center", fontSize: 8, color: "#6b7280", margin: [0, 14, 0, 0] };
    },
  };
  const bytes = await pdfMake.createPdf(def).getBuffer();
  return { bytes: new Uint8Array(bytes), pageCount };
}

export async function renderImagePdf(image: PreparedImage, settings: PageSettings, title: string): Promise<PdfOutput> {
  ensureFonts();
  let pageW: number;
  let pageH: number;
  let margin: number;
  let imgW: number;
  let imgH: number;
  let x: number;
  let y: number;
  if (settings.imageFit === "match") {
    // 1 px = 0.75 pt (96 dpi); PDF viewers cap pages at 14,400 pt.
    const scale = Math.min(0.75, 14400 / Math.max(image.width, image.height));
    pageW = imgW = image.width * scale;
    pageH = imgH = image.height * scale;
    margin = 0;
    x = 0;
    y = 0;
  } else {
    const orientation: Orientation = settings.orientation === "auto" ? (image.width > image.height ? "landscape" : "portrait") : settings.orientation;
    const dims = pageDims(settings, orientation);
    pageW = dims.width;
    pageH = dims.height;
    margin = dims.margin;
    const scale = Math.min(dims.contentWidth / image.width, dims.contentHeight / image.height);
    imgW = image.width * scale;
    imgH = image.height * scale;
    x = margin + (dims.contentWidth - imgW) / 2;
    y = margin + (dims.contentHeight - imgH) / 2;
  }
  const def: TDocumentDefinitions = {
    info: { title, creator: "FileForge", producer: "FileForge" },
    pageSize: { width: pageW, height: pageH },
    pageMargins: [margin, margin, margin, margin],
    content: [{ image: "src", width: imgW, height: imgH, absolutePosition: { x, y } } as Content],
    images: { src: toDataUri(image.bytes, image.mime) },
  };
  const bytes = await pdfMake.createPdf(def).getBuffer();
  return { bytes: new Uint8Array(bytes), pageCount: 1 };
}

export { textOf };
