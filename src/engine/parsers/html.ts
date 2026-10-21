import DOMPurify from "dompurify";
import { PROCESSING_LIMITS } from "../registry";
import { FileForgeError, type Block, type ConversionWarning, type Inline, type ListItem, type Processing } from "../types";
import { finalizeDoc, mergeRuns, safeLink, stripControl, trimRuns, warn } from "./common";

/** Elements dropped together with their content. Reported to the user when meaningful. */
const SKIP = new Set(["script", "style", "template", "noscript", "head", "title", "meta", "link", "base"]);
const MEDIA = new Set(["iframe", "object", "embed", "video", "audio", "canvas", "svg", "math", "picture", "map"]);
const CONTROLS = new Set(["input", "button", "select", "textarea", "option", "datalist", "progress", "meter"]);
const CONTAINERS = new Set([
  "body", "div", "section", "article", "main", "header", "footer", "nav", "aside", "figure", "figcaption", "address",
  "details", "summary", "form", "fieldset", "center", "dl", "dt", "dd", "hgroup", "legend",
]);

interface Fmt {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
}

interface Ctx {
  images: number;
  mediaCounts: Map<string, number>;
  controls: number;
  nestedTables: number;
  droppedLinks: number;
  depth: number;
}

const MAX_DEPTH = 60;

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}

/** Collects inline runs from a node subtree. Block children inside inline context are flattened with line breaks. */
function collectInline(node: Node, fmt: Fmt, out: Inline[], ctx: Ctx, pre: boolean) {
  if (ctx.depth > MAX_DEPTH) return;
  ctx.depth++;
  try {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        let text = child.textContent ?? "";
        if (!pre) text = text.replace(/[ \t\r\n\f]+/g, " ");
        if (text) out.push({ text: stripControl(text), ...fmt });
        continue;
      }
      if (!isElement(child)) continue;
      const tag = child.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      if (MEDIA.has(tag)) {
        ctx.mediaCounts.set(tag, (ctx.mediaCounts.get(tag) ?? 0) + 1);
        continue;
      }
      if (CONTROLS.has(tag)) {
        ctx.controls++;
        continue;
      }
      switch (tag) {
        case "br":
          out.push({ text: "\n", ...fmt });
          break;
        case "img": {
          ctx.images++;
          const alt = (child.getAttribute("alt") ?? "").trim();
          out.push({ text: alt ? `[image: ${alt}]` : "[image]", ...fmt, italic: true });
          break;
        }
        case "a": {
          const href = safeLink(child.getAttribute("href"));
          if (!href && child.getAttribute("href")) ctx.droppedLinks++;
          collectInline(child, { ...fmt, link: href ?? fmt.link }, out, ctx, pre);
          break;
        }
        case "strong":
        case "b":
          collectInline(child, { ...fmt, bold: true }, out, ctx, pre);
          break;
        case "em":
        case "i":
        case "cite":
        case "dfn":
        case "var":
          collectInline(child, { ...fmt, italic: true }, out, ctx, pre);
          break;
        case "s":
        case "strike":
        case "del":
          collectInline(child, { ...fmt, strike: true }, out, ctx, pre);
          break;
        case "code":
        case "kbd":
        case "samp":
        case "tt":
          collectInline(child, { ...fmt, code: true }, out, ctx, pre);
          break;
        case "table":
          ctx.nestedTables++;
          collectInline(child, fmt, out, ctx, pre);
          out.push({ text: "\n", ...fmt });
          break;
        case "tr":
        case "li":
        case "p":
        case "div":
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
        case "blockquote":
        case "pre":
        case "ul":
        case "ol":
          out.push({ text: "\n", ...fmt });
          collectInline(child, fmt, out, ctx, pre || tag === "pre");
          out.push({ text: "\n", ...fmt });
          break;
        case "td":
        case "th":
          collectInline(child, fmt, out, ctx, pre);
          out.push({ text: " ", ...fmt });
          break;
        default:
          collectInline(child, fmt, out, ctx, pre);
      }
    }
  } finally {
    ctx.depth--;
  }
}

/** Normalises whitespace across adjacent runs, e.g. collapsing a space that follows a newline or space. */
function tidy(runs: Inline[], pre = false): Inline[] {
  if (pre) return mergeRuns(runs);
  const out: Inline[] = [];
  let prevEndsSpace = true;
  for (const r of runs) {
    let t = r.text;
    if (prevEndsSpace) t = t.replace(/^ +/, "");
    t = t.replace(/ *\n */g, "\n");
    if (!t) continue;
    out.push({ ...r, text: t });
    prevEndsSpace = /[ \n]$/.test(t);
  }
  return trimRuns(mergeRuns(out));
}

function inlineOf(node: Node, ctx: Ctx, pre = false): Inline[] {
  const out: Inline[] = [];
  collectInline(node, {}, out, ctx, pre);
  return tidy(out, pre);
}

function parseTable(el: Element, ctx: Ctx, warnings: ConversionWarning[]): Block | null {
  const trs = Array.from(el.querySelectorAll("tr")).filter((tr) => tr.closest("table") === el);
  if (!trs.length) return null;
  const rows: Inline[][][] = [];
  let header: Inline[][] | null = null;
  let spanWarned = false;
  for (let idx = 0; idx < trs.length; idx++) {
    const tr = trs[idx]!;
    const cells = Array.from(tr.children).filter((c) => /^(td|th)$/i.test(c.tagName));
    if (!cells.length) continue;
    const row = cells.map((c) => {
      if (!spanWarned && ((Number(c.getAttribute("colspan")) || 1) > 1 || (Number(c.getAttribute("rowspan")) || 1) > 1)) {
        spanWarned = true;
        warnings.push(warn("table-spans", "Merged table cells (colspan/rowspan) are not supported; those cells are shown as single cells."));
      }
      return inlineOf(c, ctx);
    });
    const allTh = cells.every((c) => c.tagName.toLowerCase() === "th");
    const inThead = tr.parentElement?.tagName.toLowerCase() === "thead";
    if (!header && idx === 0 && (allTh || inThead)) header = row;
    else rows.push(row);
  }
  const width = Math.max(header?.length ?? 0, ...rows.map((r) => r.length));
  const pad = (r: Inline[][]) => {
    while (r.length < width) r.push([]);
    return r;
  };
  if (header) pad(header);
  rows.forEach(pad);
  return { type: "table", header, rows, align: Array(width).fill("left") };
}

function parseList(el: Element, ctx: Ctx, warnings: ConversionWarning[]): Block {
  const ordered = el.tagName.toLowerCase() === "ol";
  const items: ListItem[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const blocks = parseChildren(li, ctx, warnings);
    let runs: Inline[] = [];
    let children = blocks;
    const first = children[0];
    if (first && first.type === "paragraph") {
      runs = first.runs;
      children = children.slice(1);
    }
    items.push({ runs, children: children.length ? children : undefined });
  }
  return { type: "list", ordered, items };
}

/** Walks block-level children, flushing loose inline content into paragraphs. */
function parseChildren(parent: Node, ctx: Ctx, warnings: ConversionWarning[]): Block[] {
  const blocks: Block[] = [];
  let pending: Node[] = [];
  const flush = () => {
    if (!pending.length) return;
    const out: Inline[] = [];
    for (const n of pending) collectInlineNode(n, {}, out, ctx);
    pending = [];
    const runs = tidy(out);
    if (runs.length) blocks.push({ type: "paragraph", runs });
  };
  if (ctx.depth > MAX_DEPTH) return blocks;
  ctx.depth++;
  try {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3) {
        pending.push(child);
        continue;
      }
      if (!isElement(child)) continue;
      const tag = child.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      if (MEDIA.has(tag)) {
        ctx.mediaCounts.set(tag, (ctx.mediaCounts.get(tag) ?? 0) + 1);
        continue;
      }
      if (CONTROLS.has(tag)) {
        ctx.controls++;
        continue;
      }
      if (/^h[1-6]$/.test(tag)) {
        flush();
        const runs = inlineOf(child, ctx);
        if (runs.length) blocks.push({ type: "heading", level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, runs });
      } else if (tag === "p") {
        flush();
        const runs = inlineOf(child, ctx);
        if (runs.length) blocks.push({ type: "paragraph", runs });
      } else if (tag === "ul" || tag === "ol") {
        flush();
        blocks.push(parseList(child, ctx, warnings));
      } else if (tag === "table") {
        flush();
        const t = parseTable(child, ctx, warnings);
        if (t) blocks.push(t);
      } else if (tag === "pre") {
        flush();
        const text = stripControl(child.textContent ?? "").replace(/^\n/, "").replace(/\n+$/, "");
        if (text.trim()) blocks.push({ type: "code", text });
      } else if (tag === "blockquote") {
        flush();
        const inner = parseChildren(child, ctx, warnings);
        if (inner.length) blocks.push({ type: "quote", blocks: inner });
      } else if (tag === "hr") {
        flush();
        blocks.push({ type: "rule" });
      } else if (CONTAINERS.has(tag)) {
        flush();
        blocks.push(...parseChildren(child, ctx, warnings));
      } else {
        // Inline element or unknown element: accumulate into the current paragraph.
        pending.push(child);
      }
    }
    flush();
  } finally {
    ctx.depth--;
  }
  return blocks;
}

function collectInlineNode(n: Node, fmt: Fmt, out: Inline[], ctx: Ctx) {
  if (n.nodeType === 3) {
    const text = (n.textContent ?? "").replace(/[ \t\r\n\f]+/g, " ");
    if (text) out.push({ text: stripControl(text), ...fmt });
    return;
  }
  // Reuse collectInline by treating the node as a one-child parent.
  const holder = { childNodes: [n] } as unknown as Node;
  collectInline(holder, fmt, out, ctx, false);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function parseHtml(source: string, processing: Processing) {
  const limits = PROCESSING_LIMITS[processing];
  // DOMParser documents are inert: no scripts run and no subresources are fetched.
  const inert = new DOMParser().parseFromString(source, "text/html");
  const nodeCount = inert.getElementsByTagName("*").length;
  if (nodeCount > limits.htmlMaxNodes) {
    throw new FileForgeError(
      "html-too-complex",
      `This HTML has ${nodeCount.toLocaleString()} elements, above the ${limits.htmlMaxNodes.toLocaleString()} limit${processing === "conservative" ? " for conservative mode" : ""}. Simplify or split the document.`,
    );
  }

  const warnings: ConversionWarning[] = [];
  const title = (inert.title || "").trim() || undefined;

  const styled = inert.querySelectorAll("style, link[rel~='stylesheet']").length + inert.querySelectorAll("[style]").length;
  if (styled) warnings.push(warn("css-ignored", "CSS styling was ignored. Fonts, colors, spacing and layout from the original page are not reproduced."));
  const scripts = inert.querySelectorAll("script").length;
  if (scripts) warnings.push(warn("scripts-removed", `${plural(scripts, "script")} removed. Nothing in the file was executed.`, "info"));

  let remote = 0;
  inert.querySelectorAll("img[src], source[src], video[src], audio[src], iframe[src], script[src], link[href], embed[src], object[data]").forEach((el) => {
    const v = el.getAttribute("src") ?? el.getAttribute("href") ?? el.getAttribute("data") ?? "";
    if (/^\s*(https?:)?\/\//i.test(v)) remote++;
  });
  if (remote) warnings.push(warn("remote-skipped", `${plural(remote, "remote resource")} (images, stylesheets, scripts or fonts) were not loaded. FileForge never fetches anything referenced by your file.`));

  const clean = DOMPurify.sanitize(source, {
    RETURN_DOM: true,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed"],
    FORBID_ATTR: ["style", "srcset", "onerror", "onload"],
  }) as unknown as HTMLElement;

  const ctx: Ctx = { images: 0, mediaCounts: new Map(), controls: 0, nestedTables: 0, droppedLinks: 0, depth: 0 };
  const blocks = parseChildren(clean, ctx, warnings);

  // Media elements were forbidden/removed by the sanitizer; count them from the inert document for the report.
  for (const tag of MEDIA) {
    const n = inert.getElementsByTagName(tag).length;
    if (n) ctx.mediaCounts.set(tag, n);
  }
  if (ctx.images) warnings.push(warn("images-skipped", `${plural(ctx.images, "image")} not included. Images in HTML are never loaded; alt text is kept as a placeholder.`));
  if (ctx.mediaCounts.size) {
    const list = Array.from(ctx.mediaCounts.entries()).map(([t, n]) => `${n}× <${t}>`).join(", ");
    warnings.push(warn("media-skipped", `Unsupported embedded content was left out: ${list}.`));
  }
  if (ctx.controls) warnings.push(warn("controls-skipped", `${plural(ctx.controls, "form control")} left out.`, "info"));
  if (ctx.nestedTables) warnings.push(warn("nested-tables", `${plural(ctx.nestedTables, "nested table")} flattened to text.`));
  if (ctx.droppedLinks) warnings.push(warn("links-dropped", `${plural(ctx.droppedLinks, "link")} with relative or unsafe addresses kept as plain text.`, "info"));
  warnings.unshift(warn("approximate", "HTML conversion is approximate. Complex layouts are flattened into reading order.", "info"));

  const doc = finalizeDoc(blocks, warnings, title);
  if (!doc.charCount) throw new FileForgeError("no-content", "No convertible text was found in this HTML file.");
  return doc;
}
