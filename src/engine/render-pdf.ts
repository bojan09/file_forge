import * as pdfMakeNs from "pdfmake/build/pdfmake";
import vfsNs from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { FAMILY_FILES, loadFamily } from "./fonts";
import { absoluteWidths, columnWeights, numericColumns, pageDims, tableFontSize, textOf } from "./page";
import { autoOrientation, pageNumberLabel, resolveStyle } from "./style";
import type { Block, FontFamilyName, Inline, NormalizedDoc, Orientation, PageSettings, PreparedImage, StyleSettings } from "./types";

// The UMD bundle is CommonJS: depending on the bundler, the live module object is the namespace or its `default`.
const pdfMake = ((pdfMakeNs as unknown as { default?: typeof pdfMakeNs }).default ?? pdfMakeNs) as typeof pdfMakeNs;
const vfs = ((vfsNs as unknown as { default?: typeof vfsNs }).default ?? vfsNs) as typeof vfsNs;

let robotoReady = false;
const registered = new Set<string>();
function ensureRoboto() {
  if (robotoReady) return;
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addFonts({
    Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Medium.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-MediumItalic.ttf" },
  });
  robotoReady = true;
}
/** Image PDFs only need the bundled font (page labels); kept for the image renderers. */
const ensureFonts = ensureRoboto;

/** Registers a Liberation family on demand. Returns the pdfmake font name, or null if it could not be loaded. */
async function ensureFamily(family: FontFamilyName): Promise<string | null> {
  ensureRoboto();
  if (family === "sans") return "Roboto";
  const files = FAMILY_FILES[family];
  if (registered.has(files.name)) return files.name;
  try {
    const { vfs: faces } = await loadFamily(family);
    pdfMake.addVirtualFileSystem(faces);
    pdfMake.addFonts({ [files.name]: { normal: files.normal, bold: files.bold, italics: files.italics, bolditalics: files.bolditalics } });
    registered.add(files.name);
    return files.name;
  } catch {
    return null;
  }
}

const LINK = "#1d4ed8";
const HEADING_RATIO = { 1: 2, 2: 1.64, 3: 1.36, 4: 1.18, 5: 1.05, 6: 1 } as const;

interface Ctx {
  style: StyleSettings;
  contentWidth: number;
  contentHeight: number;
  /** pdfmake font name for body text and for code. */
  body: string;
  mono: string;
  images: Record<string, string>;
  pendingBreak: boolean;
}

function runsToContent(runs: Inline[], ctx: Ctx): Content[] {
  return runs.map((r) => {
    const node: Record<string, unknown> = { text: r.text };
    if (r.bold) node.bold = true;
    if (r.italic) node.italics = true;
    const deco: string[] = [];
    if (r.strike) deco.push("lineThrough");
    if (r.underline || r.link) deco.push("underline");
    if (deco.length) node.decoration = deco.length === 1 ? deco[0] : deco;
    if (r.color) node.color = r.color;
    if (r.code) {
      node.background = "#eceff4";
      node.font = ctx.mono;
      node.fontSize = Math.round(ctx.style.fontSize * 0.92 * 10) / 10;
    }
    if (r.link) {
      node.link = r.link;
      node.color = r.color ?? LINK;
    }
    return node as unknown as Content;
  });
}

function textNode(runs: Inline[], ctx: Ctx, extra: Record<string, unknown> = {}): Content {
  return { text: runsToContent(runs, ctx), lineHeight: ctx.style.lineSpacing, ...extra } as Content;
}

/** Marks the next emitted node to start on a new page (a trailing page break does nothing). */
function take(ctx: Ctx, node: Content): Content {
  if (ctx.pendingBreak) {
    ctx.pendingBreak = false;
    (node as unknown as Record<string, unknown>).pageBreak = "before";
  }
  return node;
}

function tableLayout(b: Extract<Block, { type: "table" }>, ctx: Ctx, pad: number) {
  const { tableZebra, tableBorders, tableHeaderFill } = ctx.style;
  const line = "#cfd4e0";
  return {
    fillColor: (row: number) => {
      if (b.header && row === 0) return tableHeaderFill ? "#e8ecfb" : null;
      if (!tableZebra) return null;
      return (b.header ? row : row + 1) % 2 === 0 ? "#f7f8fb" : null;
    },
    hLineColor: () => line,
    vLineColor: () => line,
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
      tableBorders === "none" ? 0 : tableBorders === "horizontal" ? (i === 0 || i === node.table.body.length ? 0.8 : 0.5) : 0.5,
    vLineWidth: () => (tableBorders === "grid" ? 0.5 : 0),
    paddingLeft: () => pad,
    paddingRight: () => pad,
    paddingTop: () => pad - 1,
    paddingBottom: () => pad - 1,
  };
}

function blocksToContent(blocks: Block[], ctx: Ctx, width: number, nested = false): Content[] {
  const out: Content[] = [];
  const fs = ctx.style.fontSize;
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        out.push(
          take(
            ctx,
            textNode(b.runs, ctx, {
              fontSize: Math.round(fs * HEADING_RATIO[b.level] * 10) / 10,
              bold: true,
              alignment: b.align ?? "left",
              margin: [0, b.level <= 2 ? 14 : 10, 0, 6],
              headlineLevel: b.level,
              keepWithNext: true,
              lineHeight: Math.max(1.1, ctx.style.lineSpacing - 0.1),
            } as Record<string, unknown>),
          ),
        );
        break;
      case "paragraph":
        out.push(take(ctx, textNode(b.runs, ctx, { margin: [0, 0, 0, b.cont ? 0 : 8], alignment: b.align ?? "left" })));
        break;
      case "pagebreak":
        if (!nested) ctx.pendingBreak = true;
        break;
      case "image": {
        const key = `img${Object.keys(ctx.images).length}`;
        ctx.images[key] = toDataUri(b.image.bytes, b.image.mime);
        // 1 px = 0.75 pt; never wider than the text column or taller than the page body.
        const scale = Math.min(0.75, width / b.image.width, (ctx.contentHeight * 0.92) / b.image.height);
        out.push(take(ctx, { image: key, width: b.image.width * scale, height: b.image.height * scale, alignment: b.align ?? "left", margin: [0, 2, 0, 8] } as Content));
        break;
      }
      case "list": {
        const items = b.items.map((it) => {
          const head = textNode(it.runs, ctx);
          if (!it.children?.length) return head;
          return { stack: [head, ...blocksToContent(it.children, ctx, width - 18, true)] } as Content;
        });
        out.push(take(ctx, (b.plain ? { ul: items, type: "none", margin: [0, 0, 0, 8] } : b.ordered ? { ol: items, margin: [0, 0, 0, 8] } : { ul: items, margin: [0, 0, 0, 8] }) as Content));
        break;
      }
      case "code": {
        const lines = b.text.split("\n");
        const size = Math.round(fs * 0.82 * 10) / 10;
        out.push(
          take(ctx, {
            margin: [0, 0, 0, 8],
            table: { widths: ["*"], body: lines.map((l) => [{ text: l.length ? l : " ", preserveLeadingSpaces: true, fontSize: size, font: ctx.mono, lineHeight: 1.15 }]) },
            layout: { fillColor: () => "#f1f3f7", hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 0.5, paddingBottom: () => 0.5 },
          } as Content),
        );
        break;
      }
      case "quote": {
        const inner = blocksToContent(b.blocks, ctx, width - 18, true);
        out.push(take(ctx, { stack: inner, margin: [18, 0, 0, 4], color: "#4b5563", italics: true } as Content));
        break;
      }
      case "rule":
        out.push(take(ctx, { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.8, lineColor: "#9ca3af" }], margin: [0, 6, 0, 10] } as Content));
        break;
      case "table": {
        const cols = Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length), 1);
        const size = Math.round(tableFontSize(cols) * (fs / 11) * ctx.style.tableFontScale * 10) / 10;
        const pad = cols > 9 ? 2 : 4;
        // pdfmake adds cell padding and borders on top of column widths, so reserve room for them.
        const available = width - cols * pad * 2 - (cols + 1) * 0.5;
        const weights = ctx.style.columnSizing === "equal" ? Array(cols).fill(1) : columnWeights(b);
        const widths = absoluteWidths(weights, available, Math.min(30, available / cols));
        const numeric = b.autoAlign && ctx.style.numberAlign === "auto" ? numericColumns(b) : [];
        const alignOf = (c: number, header: boolean) => {
          const a = b.align?.[c];
          if (a && a !== "left") return a;
          return numeric[c] ? "right" : header ? "left" : (a ?? "left");
        };
        const cell = (runs: Inline[], header: boolean, c: number) => ({
          text: runs.length ? runsToContent(runs, ctx) : "",
          bold: header,
          fontSize: size,
          lineHeight: Math.min(ctx.style.lineSpacing, 1.3),
          alignment: alignOf(c, header),
        });
        const body = [...(b.header ? [b.header.map((r, c) => cell(r, true, c))] : []), ...b.rows.map((row) => row.map((r, c) => cell(r, false, c)))];
        out.push(take(ctx, { margin: [0, 2, 0, 10], table: { headerRows: b.header ? 1 : 0, widths, body }, layout: tableLayout(b, ctx, pad) } as Content));
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
  /** Set when the requested font could not be loaded and the bundled sans font was used instead. */
  fontFallback?: FontFamilyName;
}

function needsMono(doc: NormalizedDoc): boolean {
  const walk = (blocks: Block[]): boolean =>
    blocks.some((b) => {
      if (b.type === "code") return true;
      if (b.type === "heading" || b.type === "paragraph") return b.runs.some((r) => r.code);
      if (b.type === "quote") return walk(b.blocks);
      if (b.type === "list") return b.items.some((it) => it.runs.some((r) => r.code) || (it.children ? walk(it.children) : false));
      if (b.type === "table") return [...(b.header ? [b.header] : []), ...b.rows].some((row) => row.some((cell) => cell.some((r) => r.code)));
      return false;
    });
  return walk(doc.blocks);
}

export async function renderTextPdf(doc: NormalizedDoc, settings: PageSettings, title: string): Promise<PdfOutput> {
  const style = resolveStyle(settings.style);
  const requested = settings.orientation === "auto" ? autoOrientation(doc) : settings.orientation;
  const orientation: Orientation = requested === "landscape" ? "landscape" : "portrait";
  const dims = pageDims(settings, orientation);

  let body = await ensureFamily(style.fontFamily);
  const fontFallback = body === null && style.fontFamily !== "sans" ? style.fontFamily : undefined;
  body ??= await ensureFamily("sans");
  let mono = "Roboto";
  if (style.fontFamily === "mono") mono = body ?? "Roboto";
  else if (needsMono(doc)) mono = (await ensureFamily("mono")) ?? "Roboto";

  const ctx: Ctx = { style, contentWidth: dims.contentWidth, contentHeight: dims.contentHeight, body: body ?? "Roboto", mono, images: {}, pendingBreak: false };
  let pageCount = 0;
  const hasFooter = style.pageNumbers !== "none" || style.footerText;
  const bottom = hasFooter ? Math.max(dims.margin, 40) : dims.margin;
  const top = style.headerText ? Math.max(dims.margin, 40) : dims.margin;
  const meta = doc.meta;
  const def: TDocumentDefinitions = {
    info: {
      title: meta?.title || title,
      author: meta?.author,
      subject: meta?.subject,
      keywords: meta?.keywords?.join(", "),
      creator: "FileForge",
      producer: "FileForge",
    },
    pageSize: { width: dims.width, height: dims.height },
    pageMargins: [dims.margin, top, dims.margin, bottom],
    defaultStyle: { font: ctx.body, fontSize: style.fontSize, lineHeight: style.lineSpacing },
    content: blocksToContent(doc.blocks, ctx, dims.contentWidth),
    images: ctx.images,
    header: style.headerText ? () => ({ text: style.headerText, alignment: "center", fontSize: 8.5, color: "#6b7280", margin: [dims.margin, 18, dims.margin, 0] }) : undefined,
    footer: !hasFooter ? undefined : (current: number, count: number) => {
      pageCount = count;
      const label = pageNumberLabel(style.pageNumbers, current, count);
      const gray = { fontSize: 8, color: "#6b7280" };
      if (style.footerText && label) {
        return { columns: [{ text: style.footerText, alignment: "left", ...gray }, { text: label, alignment: "right", width: "auto", ...gray }], margin: [dims.margin, 14, dims.margin, 0] } as Content;
      }
      return { text: style.footerText || label, alignment: "center", ...gray, margin: [dims.margin, 14, dims.margin, 0] } as Content;
    },
  };
  const bytes = await pdfMake.createPdf(def).getBuffer();
  // pdfmake only calls the footer callback when there is something to draw; fall back to a count from the file.
  if (!pageCount) pageCount = countPages(bytes);
  return { bytes: new Uint8Array(bytes), pageCount, fontFallback };
}

function countPages(bytes: Uint8Array): number {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return (s.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
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

/**
 * One image per page, in order. Pages use a named paper size with per-page orientation, so
 * portrait and landscape images can share a document. Images are centered inside the margins with
 * their aspect ratio preserved; "fill" images are cropped to the content area beforehand (see prepareImage).
 */
export async function renderImagesPdf(images: PreparedImage[], settings: PageSettings, title: string): Promise<PdfOutput> {
  ensureFonts();
  const named = settings.pageSize;
  const orientationOf = (img: PreparedImage): Orientation => (settings.orientation === "auto" ? (img.width > img.height ? "landscape" : "portrait") : settings.orientation);
  const imageMap: Record<string, string> = {};
  const content: Content[] = images.map((img, i) => {
    const o = orientationOf(img);
    const dims = pageDims(settings, o);
    // 0.5% slack keeps the image from spilling a hair past the content box and creating an empty page.
    const scale = Math.min(dims.contentWidth / img.width, dims.contentHeight / img.height) * 0.995;
    const w = img.width * scale;
    const h = img.height * scale;
    imageMap[`img${i}`] = toDataUri(img.bytes, img.mime);
    const node: Record<string, unknown> = { image: `img${i}`, width: w, height: h, margin: [(dims.contentWidth - w) / 2, (dims.contentHeight - h) / 2, 0, 0] };
    if (i > 0) {
      node.pageBreak = "before";
      node.pageOrientation = o;
    }
    return node as unknown as Content;
  });
  const def: TDocumentDefinitions = {
    info: { title, creator: "FileForge", producer: "FileForge" },
    pageSize: named,
    pageOrientation: orientationOf(images[0]!),
    pageMargins: pageDims(settings, "portrait").margin,
    content,
    images: imageMap,
  };
  const bytes = await pdfMake.createPdf(def).getBuffer();
  return { bytes: new Uint8Array(bytes), pageCount: images.length };
}

export { textOf };
