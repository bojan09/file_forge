import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import { PAGE_POINTS, absoluteWidths, columnWeights, numericColumns, pageDims, tableFontSize } from "./page";
import { autoOrientation, resolveStyle } from "./style";
import type { Align, Block, FontFamilyName, Inline, NormalizedDoc, PageSettings, StyleSettings } from "./types";

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const HEADING_RATIO = [2, 1.64, 1.36, 1.18, 1.05, 1];
const MAX_LIST_LEVEL = 8;
/** Fonts Word and LibreOffice both resolve to metric-compatible faces. */
const FONT_NAMES: Record<FontFamilyName, string> = { sans: "Calibri", serif: "Times New Roman", mono: "Courier New" };

interface Ctx {
  style: StyleSettings;
  orderedRefs: string[];
  contentTwips: number;
  contentPt: number;
  contentHeightPt: number;
  pendingBreak: boolean;
}

const ALIGN: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const hex = (c?: string) => (c ? c.replace("#", "").toUpperCase() : undefined);

function runsToChildren(runs: Inline[], ctx: Ctx, opts: { size?: number; bold?: boolean } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const r of runs) {
    const parts = r.text.split("\n");
    parts.forEach((part, i) => {
      const common = {
        bold: r.bold || opts.bold || undefined,
        italics: r.italic || undefined,
        strike: r.strike || undefined,
        underline: r.underline && !r.link ? { type: UnderlineType.SINGLE } : undefined,
        color: r.link ? undefined : hex(r.color),
        size: opts.size ? Math.round(opts.size * 2) : undefined,
        ...(r.code ? { font: FONT_NAMES.mono, shading: { type: ShadingType.CLEAR, fill: "ECEFF4", color: "auto" } } : {}),
      };
      const run = new TextRun({ ...common, text: part, break: i > 0 ? 1 : undefined, ...(r.link ? { style: "Hyperlink" } : {}) });
      out.push(r.link ? new ExternalHyperlink({ link: r.link, children: [run] }) : run);
    });
  }
  return out;
}

/** Creates a paragraph, starting a new page first when a page break is pending. */
function para(ctx: Ctx, opts: IParagraphOptions): Paragraph {
  if (ctx.pendingBreak) {
    ctx.pendingBreak = false;
    return new Paragraph({ ...opts, pageBreakBefore: true });
  }
  return new Paragraph(opts);
}

function listParagraphs(block: Extract<Block, { type: "list" }>, level: number, ref: string, ctx: Ctx): Paragraph[] {
  const out: Paragraph[] = [];
  const lvl = Math.min(level, MAX_LIST_LEVEL);
  for (const item of block.items) {
    out.push(
      para(ctx, block.plain
        ? { children: runsToChildren(item.runs, ctx), indent: { left: 540 + lvl * 360 }, spacing: { after: 60 } }
        : { children: runsToChildren(item.runs, ctx), numbering: { reference: ref, level: lvl }, spacing: { after: 60 } }),
    );
    for (const child of item.children ?? []) {
      if (child.type === "list") {
        const childRef = child.ordered ? newOrdered(ctx) : "bullets";
        out.push(...listParagraphs(child, level + 1, childRef, ctx));
      } else {
        out.push(...(blockToDocx(child, ctx, level + 1) as Paragraph[]).filter((p) => p instanceof Paragraph));
      }
    }
  }
  return out;
}

function newOrdered(ctx: Ctx): string {
  const ref = `ordered-${ctx.orderedRefs.length}`;
  ctx.orderedRefs.push(ref);
  return ref;
}

type Out = Paragraph | Table;

function blockToDocx(b: Block, ctx: Ctx, indentLevel = 0): Out[] {
  const indent = indentLevel > 0 ? { left: 360 * indentLevel + 360 } : undefined;
  switch (b.type) {
    case "heading":
      return [para(ctx, { heading: HEADINGS[b.level - 1], alignment: b.align ? ALIGN[b.align] : undefined, children: runsToChildren(b.runs, ctx) })];
    case "paragraph":
      return [para(ctx, { children: runsToChildren(b.runs, ctx), alignment: b.align ? ALIGN[b.align] : undefined, spacing: { after: 140 }, indent })];
    case "pagebreak":
      if (indentLevel === 0) ctx.pendingBreak = true;
      return [];
    case "image": {
      const scale = Math.min(1, ctx.contentPt / b.image.width / 0.75, (ctx.contentHeightPt * 0.92) / b.image.height / 0.75);
      const width = Math.max(1, Math.round(b.image.width * 0.75 * scale * (96 / 72)));
      const height = Math.max(1, Math.round(b.image.height * 0.75 * scale * (96 / 72)));
      const alt = b.image.alt?.trim() || "Image";
      return [
        para(ctx, {
          alignment: b.align ? ALIGN[b.align] : undefined,
          spacing: { after: 140 },
          indent,
          children: [
            new ImageRun({
              type: b.image.mime === "image/png" ? "png" : "jpg",
              data: b.image.bytes,
              transformation: { width, height },
              altText: { name: alt.slice(0, 60), description: alt, title: alt.slice(0, 60) },
            }),
          ],
        }),
      ];
    }
    case "list":
      return listParagraphs(b, 0, b.ordered ? newOrdered(ctx) : "bullets", ctx);
    case "code":
      return [
        para(ctx, {
          children: runsToChildren([{ text: b.text, code: true }], ctx, { size: Math.round(ctx.style.fontSize * 0.86 * 2) / 2 }),
          shading: { type: ShadingType.CLEAR, fill: "F1F3F7", color: "auto" },
          spacing: { after: 140 },
          indent,
        }),
      ];
    case "quote":
      return quoteWrap(b, ctx, indentLevel);
    case "rule":
      return [para(ctx, { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "9CA3AF", space: 1 } }, spacing: { before: 120, after: 200 } })];
    case "table":
      return tableToDocx(b, ctx);
  }
}

function quoteWrap(b: Extract<Block, { type: "quote" }>, ctx: Ctx, indentLevel: number): Out[] {
  const out: Out[] = [];
  for (const inner of b.blocks) {
    if (inner.type === "paragraph" || inner.type === "heading") {
      out.push(
        para(ctx, {
          children: runsToChildren(inner.runs, ctx, { bold: inner.type === "heading" }),
          indent: { left: 360 * (indentLevel + 1) + 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: "9CA3AF", space: 10 } },
          spacing: { after: 120 },
        }),
      );
    } else out.push(...blockToDocx(inner, ctx, indentLevel + 1));
  }
  return out;
}

function tableToDocx(b: Extract<Block, { type: "table" }>, ctx: Ctx): Out[] {
  const { tableZebra, tableBorders, tableHeaderFill, columnSizing, numberAlign, tableFontScale } = ctx.style;
  const cols = Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length), 1);
  const size = Math.round((tableFontSize(cols) + 1) * (ctx.style.fontSize / 11) * tableFontScale * 2) / 2;
  const weights = columnSizing === "equal" ? Array(cols).fill(1) : columnWeights(b);
  const twips = absoluteWidths(weights, ctx.contentTwips, Math.min(700, ctx.contentTwips / cols)).map(Math.floor);
  const line = { style: BorderStyle.SINGLE, size: 4, color: "CFD4E0" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const numeric = b.autoAlign && numberAlign === "auto" ? numericColumns(b) : [];
  const alignOf = (c: number) => {
    const a = b.align?.[c];
    if (a && a !== "left") return ALIGN[a];
    return numeric[c] ? AlignmentType.RIGHT : AlignmentType.LEFT;
  };
  // A table has no paragraph of its own to carry a page break, so a pending one goes on a small empty paragraph.
  const lead: Out[] = ctx.pendingBreak ? [para(ctx, { spacing: { after: 0, line: 20, lineRule: LineRuleType.EXACT } })] : [];
  const makeRow = (cells: Inline[][], header: boolean, rowIndex: number) =>
    new TableRow({
      tableHeader: header,
      cantSplit: true,
      children: Array.from({ length: cols }, (_, c) => {
        const runs = cells[c] ?? [];
        const fill = header ? (tableHeaderFill ? "E8ECFB" : undefined) : tableZebra && rowIndex % 2 === 1 ? "F7F8FB" : undefined;
        return new TableCell({
          width: { size: twips[c] ?? 1000, type: WidthType.DXA },
          shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          children: [new Paragraph({ alignment: alignOf(c), spacing: { line: Math.round(240 * Math.min(ctx.style.lineSpacing, 1.3)), lineRule: LineRuleType.AUTO }, children: runsToChildren(runs, ctx, { size, bold: header }) })],
        });
      }),
    });
  const borders =
    tableBorders === "grid"
      ? { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line }
      : tableBorders === "horizontal"
        ? { top: line, bottom: line, left: none, right: none, insideHorizontal: line, insideVertical: none }
        : { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  const table = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: twips.reduce((a, c) => a + c, 0), type: WidthType.DXA },
    columnWidths: twips,
    borders,
    rows: [...(b.header ? [makeRow(b.header, true, 0)] : []), ...b.rows.map((r, i) => makeRow(r, false, i))],
  });
  return [...lead, table];
}

const BULLETS = ["•", "◦", "▪", "•", "◦", "▪", "•", "◦", "▪"];

function pageNumberChildren(style: StyleSettings["pageNumbers"], size: number) {
  const run = (o: Record<string, unknown>) => new TextRun({ size, color: "6B7280", ...o });
  switch (style) {
    case "n":
      return [run({ children: [PageNumber.CURRENT] })];
    case "n-of-N":
      return [run({ children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES] })];
    case "page-n-of-N":
      return [run({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] })];
    default:
      return [];
  }
}

export async function renderDocx(doc: NormalizedDoc, settings: PageSettings, title: string): Promise<Uint8Array> {
  const style = resolveStyle(settings.style);
  const requested = settings.orientation === "auto" ? autoOrientation(doc) : settings.orientation;
  const orientation = requested === "landscape" ? "landscape" : "portrait";
  const dims = pageDims(settings, orientation);
  const ctx: Ctx = { style, orderedRefs: [], contentTwips: Math.floor(dims.contentWidth * 20), contentPt: dims.contentWidth, contentHeightPt: dims.contentHeight, pendingBreak: false };
  const children: Out[] = doc.blocks.flatMap((b) => blockToDocx(b, ctx));
  if (!children.length) children.push(new Paragraph({}));

  const levels = (fmt: (typeof LevelFormat)[keyof typeof LevelFormat], text: (l: number) => string) =>
    Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, l) => ({
      level: l,
      format: fmt,
      text: text(l),
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 540 + l * 360, hanging: 360 } } },
    }));

  const font = FONT_NAMES[style.fontFamily];
  const half = Math.round(style.fontSize * 2);
  const meta = doc.meta;
  const wantFooter = style.pageNumbers !== "none" || style.footerText;
  const footerKids: ParagraphChild[] = [];
  if (style.footerText) footerKids.push(new TextRun({ text: style.footerText, size: 16, color: "6B7280" }));
  if (style.footerText && style.pageNumbers !== "none") footerKids.push(new TextRun({ text: "\t", size: 16 }));
  footerKids.push(...pageNumberChildren(style.pageNumbers, 16));
  const rightTab = Math.round(dims.contentWidth * 20);

  const out = new Document({
    creator: meta?.author || "FileForge",
    lastModifiedBy: "FileForge",
    title: meta?.title || title,
    subject: meta?.subject,
    keywords: meta?.keywords?.join(", "),
    description: "Converted locally in the browser with FileForge",
    styles: {
      default: {
        document: { run: { font, size: half }, paragraph: { spacing: { line: Math.round(240 * style.lineSpacing), lineRule: LineRuleType.AUTO } } },
        heading1: headingStyle(0, font, half),
        heading2: headingStyle(1, font, half),
        heading3: headingStyle(2, font, half),
        heading4: headingStyle(3, font, half),
        heading5: headingStyle(4, font, half),
        heading6: headingStyle(5, font, half),
      },
      characterStyles: [{ id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", run: { color: "1D4ED8", underline: { type: UnderlineType.SINGLE } } }],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: levels(LevelFormat.BULLET, (l) => BULLETS[l] ?? "•") },
        ...ctx.orderedRefs.map((reference) => ({ reference, levels: levels(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) })),
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              // docx swaps width/height itself when orientation is landscape, so pass portrait dimensions.
              width: Math.round(PAGE_POINTS[settings.pageSize].width * 20),
              height: Math.round(PAGE_POINTS[settings.pageSize].height * 20),
              orientation: orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: { top: dims.margin * 20, bottom: dims.margin * 20, left: dims.margin * 20, right: dims.margin * 20, header: 540, footer: 540 },
          },
        },
        headers: style.headerText
          ? { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: style.headerText, size: 17, color: "6B7280" })] })] }) }
          : undefined,
        footers: wantFooter
          ? {
              default: new Footer({
                children: [
                  new Paragraph(
                    style.footerText && style.pageNumbers !== "none"
                      ? { tabStops: [{ type: "right", position: rightTab }], children: footerKids }
                      : { alignment: AlignmentType.CENTER, children: footerKids },
                  ),
                ],
              }),
            }
          : undefined,
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(out));
}

function headingStyle(i: number, font: string, baseHalfPts: number) {
  return {
    run: { font, bold: true, size: Math.round(baseHalfPts * HEADING_RATIO[i]!) },
    paragraph: { spacing: { before: i < 2 ? 280 : 200, after: 120 } },
  };
}
