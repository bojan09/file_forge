import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import { PAGE_POINTS, absoluteWidths, columnWeights, pageDims, tableFontSize } from "./page";
import type { Block, Inline, NormalizedDoc, PageSettings } from "./types";

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const HEADING_PT = [22, 18, 15, 13, 11.5, 11];
const MAX_LIST_LEVEL = 8;

interface Ctx {
  orderedRefs: string[];
  contentTwips: number;
}

function runsToChildren(runs: Inline[], opts: { size?: number; bold?: boolean } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const r of runs) {
    const parts = r.text.split("\n");
    parts.forEach((part, i) => {
      const common = {
        bold: r.bold || opts.bold || undefined,
        italics: r.italic || undefined,
        strike: r.strike || undefined,
        size: opts.size ? Math.round(opts.size * 2) : undefined,
        ...(r.code ? { font: "Courier New", shading: { type: ShadingType.CLEAR, fill: "ECEFF4", color: "auto" } } : {}),
      };
      const run = new TextRun({ ...common, text: part, break: i > 0 ? 1 : undefined, ...(r.link ? { style: "Hyperlink" } : {}) });
      out.push(r.link ? new ExternalHyperlink({ link: r.link, children: [run] }) : run);
    });
  }
  return out;
}

function listParagraphs(block: Extract<Block, { type: "list" }>, level: number, ref: string, ctx: Ctx): Paragraph[] {
  const out: Paragraph[] = [];
  const lvl = Math.min(level, MAX_LIST_LEVEL);
  for (const item of block.items) {
    out.push(new Paragraph({ children: runsToChildren(item.runs), numbering: { reference: ref, level: lvl }, spacing: { after: 60 } }));
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
      return [new Paragraph({ heading: HEADINGS[b.level - 1], children: runsToChildren(b.runs, { size: HEADING_PT[b.level - 1] }), spacing: { before: 240, after: 120 } })];
    case "paragraph":
      return [new Paragraph({ children: runsToChildren(b.runs), spacing: { after: 140 }, indent })];
    case "list":
      return listParagraphs(b, 0, b.ordered ? newOrdered(ctx) : "bullets", ctx);
    case "code":
      return [
        new Paragraph({
          children: runsToChildren([{ text: b.text, code: true }], { size: 9.5 }),
          shading: { type: ShadingType.CLEAR, fill: "F1F3F7", color: "auto" },
          spacing: { after: 140 },
          indent,
        }),
      ];
    case "quote":
      return quoteWrap(b, ctx, indentLevel);
    case "rule":
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "9CA3AF", space: 1 } }, spacing: { before: 120, after: 200 } })];
    case "table":
      return [tableToDocx(b, ctx)];
  }
}

function quoteWrap(b: Extract<Block, { type: "quote" }>, ctx: Ctx, indentLevel: number): Out[] {
  const out: Out[] = [];
  for (const inner of b.blocks) {
    if (inner.type === "paragraph" || inner.type === "heading") {
      out.push(
        new Paragraph({
          children: runsToChildren(inner.runs, { bold: inner.type === "heading" }),
          indent: { left: 360 * (indentLevel + 1) + 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: "9CA3AF", space: 10 } },
          spacing: { after: 120 },
        }),
      );
    } else out.push(...blockToDocx(inner, ctx, indentLevel + 1));
  }
  return out;
}

function tableToDocx(b: Extract<Block, { type: "table" }>, ctx: Ctx): Table {
  const cols = Math.max(b.header?.length ?? 0, ...b.rows.map((r) => r.length), 1);
  const size = tableFontSize(cols) + 1;
  const twips = absoluteWidths(columnWeights(b), ctx.contentTwips, Math.min(700, ctx.contentTwips / cols)).map(Math.floor);
  const border = { style: BorderStyle.SINGLE, size: 4, color: "CFD4E0" };
  const makeRow = (cells: Inline[][], header: boolean) =>
    new TableRow({
      tableHeader: header,
      cantSplit: true,
      children: Array.from({ length: cols }, (_, c) => {
        const runs = cells[c] ?? [];
        return new TableCell({
          width: { size: twips[c] ?? 1000, type: WidthType.DXA },
          shading: header ? { type: ShadingType.CLEAR, fill: "E8ECFB", color: "auto" } : undefined,
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          children: [
            new Paragraph({
              alignment: b.align?.[c] === "center" ? AlignmentType.CENTER : b.align?.[c] === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: runsToChildren(runs, { size, bold: header }),
            }),
          ],
        });
      }),
    });
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: twips.reduce((a, c) => a + c, 0), type: WidthType.DXA },
    columnWidths: twips,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [...(b.header ? [makeRow(b.header, true)] : []), ...b.rows.map((r) => makeRow(r, false))],
  });
}

const BULLETS = ["•", "◦", "▪", "•", "◦", "▪", "•", "◦", "▪"];

export async function renderDocx(doc: NormalizedDoc, settings: PageSettings, title: string): Promise<Uint8Array> {
  const orientation = settings.orientation === "landscape" ? "landscape" : "portrait";
  const dims = pageDims(settings, orientation);
  const ctx: Ctx = { orderedRefs: [], contentTwips: Math.floor(dims.contentWidth * 20) };
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

  const out = new Document({
    creator: "FileForge",
    title,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      characterStyles: [{ id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", run: { color: "1D4ED8", underline: { type: "single" } } }],
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
            margin: { top: dims.margin * 20, bottom: dims.margin * 20, left: dims.margin * 20, right: dims.margin * 20 },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(out));
}
