import DOMPurify from "dompurify";
import { PROCESSING_LIMITS } from "../registry";
import { FileForgeError, type Align, type Block, type ConversionWarning, type DocMeta, type Inline, type ListItem, type Processing } from "../types";
import { describeRejected, embedDataUri, finalizeDoc, mergeRuns, newImageBudget, normalizeColor, parseAlign, safeLink, stripControl, trimRuns, warn, type ImageBudget, type ImageRejection } from "./common";

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
  underline?: boolean;
  code?: boolean;
  color?: string;
  link?: string;
}

/** CSS properties that are read from inline style attributes. Everything else is counted and reported. */
const SUPPORTED_CSS = new Set(["color", "text-align", "font-weight", "font-style", "text-decoration", "text-decoration-line", "page-break-before", "page-break-after", "break-before", "break-after"]);
const MAX_STYLE_CHARS = 2000;

interface Css {
  fmt: Fmt;
  align?: Align;
  breakBefore?: boolean;
  breakAfter?: boolean;
}

interface Ctx {
  /** Each element's style is parsed once, so declarations are counted once. */
  styleCache: WeakMap<Element, Css>;
  cssDeclarations: number;
  cssDropped: Map<string, number>;
  lightColors: number;
  images: number;
  imageBudget: ImageBudget;
  rejected: Map<ImageRejection, number>;
  embedded: number;
  inlineImages: number;
  mediaCounts: Map<string, number>;
  controls: number;
  nestedTables: number;
  depth: number;
  tooDeep: boolean;
}

// Browsers cap HTML nesting at 512; allow a margin and report (never silently drop) anything deeper.
const MAX_DEPTH = 700;

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}

/** Reads the supported subset of an element's inline style; counts every other declaration for the report. */
function readStyle(el: Element, ctx: Ctx): Css {
  const cached = ctx.styleCache.get(el);
  if (cached) return cached;
  const out: Css = { fmt: {} };
  ctx.styleCache.set(el, out);
  const raw = el.getAttribute("style");
  if (raw) {
    for (const decl of raw.slice(0, MAX_STYLE_CHARS).split(";")) {
      const i = decl.indexOf(":");
      if (i < 1) continue;
      const name = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).replace(/!important/i, "").trim().toLowerCase();
      if (!name || !value) continue;
      ctx.cssDeclarations++;
      if (!SUPPORTED_CSS.has(name)) {
        ctx.cssDropped.set(name, (ctx.cssDropped.get(name) ?? 0) + 1);
        continue;
      }
      switch (name) {
        case "color": {
          const c = normalizeColor(value);
          if (c) out.fmt.color = c;
          else if (/^#|^rgb|^[a-z]+$/.test(value)) ctx.lightColors++;
          break;
        }
        case "text-align":
          out.align = parseAlign(value);
          break;
        case "font-weight":
          if (value === "bold" || value === "bolder" || Number(value) >= 600) out.fmt.bold = true;
          break;
        case "font-style":
          if (value === "italic" || value === "oblique") out.fmt.italic = true;
          break;
        case "text-decoration":
        case "text-decoration-line":
          if (value.includes("underline")) out.fmt.underline = true;
          if (value.includes("line-through")) out.fmt.strike = true;
          break;
        case "page-break-before":
        case "break-before":
          if (value === "always" || value === "page" || value === "left" || value === "right") out.breakBefore = true;
          break;
        case "page-break-after":
        case "break-after":
          if (value === "always" || value === "page" || value === "left" || value === "right") out.breakAfter = true;
          break;
      }
    }
  }
  return out;
}

function alignOfElement(el: Element, ctx: Ctx, inherited?: Align): Align | undefined {
  const css = readStyle(el, ctx);
  return css.align ?? parseAlign(el.getAttribute("align")) ?? (el.tagName.toLowerCase() === "center" ? "center" : undefined) ?? inherited;
}

/** Collects inline runs from a node subtree. Block children inside inline context are flattened with line breaks. */
function collectInline(node: Node, fmtIn: Fmt, out: Inline[], ctx: Ctx, pre: boolean) {
  let fmt = fmtIn;
  if (ctx.depth > MAX_DEPTH) {
    ctx.tooDeep = true;
    return;
  }
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
      const outer = fmt;
      fmt = { ...outer, ...readStyle(child, ctx).fmt };
      if (tag === "font") {
        const c = normalizeColor(child.getAttribute("color"));
        if (c) fmt = { ...fmt, color: c };
      }
      try {
      switch (tag) {
        case "br":
          out.push({ text: "\n", ...fmt });
          break;
        case "img": {
          // Images that are not at block level (inside headings, table cells, runs of text) stay as alt-text placeholders.
          ctx.inlineImages++;
          const alt = (child.getAttribute("alt") ?? "").trim();
          out.push({ text: alt ? `[image: ${alt}]` : "[image]", ...fmt, italic: true });
          break;
        }
        case "u":
        case "ins":
          collectInline(child, { ...fmt, underline: true }, out, ctx, pre);
          break;
        case "a": {
          const href = safeLink(child.getAttribute("href"));
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
      } finally {
        fmt = outer;
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
  collectInline(node, isElement(node) ? readStyle(node, ctx).fmt : {}, out, ctx, pre);
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
  // Column alignment comes from the cells of the first row that declare one (align attribute or text-align).
  const align: Align[] = Array(width).fill("left");
  let declared = false;
  const firstCells = Array.from(trs[0]!.children).filter((c) => /^(td|th)$/i.test(c.tagName));
  firstCells.forEach((c, i) => {
    const a = parseAlign(c.getAttribute("align")) ?? readStyle(c, ctx).align;
    if (a && i < width) {
      align[i] = a;
      declared = true;
    }
  });
  return { type: "table", header, rows, align, autoAlign: !declared };
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

function containsImg(el: Element): boolean {
  return el.getElementsByTagName("img").length > 0;
}

function pushImage(el: Element, ctx: Ctx, blocks: Block[], align?: Align) {
  const src = (el.getAttribute("src") ?? "").trim();
  const alt = (el.getAttribute("alt") ?? "").trim();
  ctx.images++;
  if (!src) {
    ctx.rejected.set("decode", (ctx.rejected.get("decode") ?? 0) + 1);
    return;
  }
  const res = embedDataUri(src, alt, ctx.imageBudget);
  if ("image" in res) {
    ctx.embedded++;
    blocks.push({ type: "image", image: res.image, align });
  } else {
    ctx.rejected.set(res.rejected, (ctx.rejected.get(res.rejected) ?? 0) + 1);
    // Keep a visible placeholder so nothing disappears silently.
    blocks.push({ type: "paragraph", runs: [{ text: alt ? `[image: ${alt}]` : "[image]", italic: true }], align });
  }
}

/** Walks block-level children, flushing loose inline content into paragraphs. */
function parseChildren(parent: Node, ctx: Ctx, warnings: ConversionWarning[], inherited?: Align): Block[] {
  const blocks: Block[] = [];
  let pending: Node[] = [];
  const flush = () => {
    if (!pending.length) return;
    const out: Inline[] = [];
    for (const n of pending) collectInlineNode(n, {}, out, ctx);
    pending = [];
    const runs = tidy(out);
    if (runs.length) blocks.push({ type: "paragraph", runs, align: inherited });
  };
  if (ctx.depth > MAX_DEPTH) {
    ctx.tooDeep = true;
    return blocks;
  }
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
      const isBlockTag = /^h[1-6]$/.test(tag) || tag === "p" || tag === "ul" || tag === "ol" || tag === "table" || tag === "pre" || tag === "blockquote" || tag === "hr" || tag === "img" || CONTAINERS.has(tag);
      const css = isBlockTag ? readStyle(child, ctx) : null;
      if (css?.breakBefore) {
        flush();
        blocks.push({ type: "pagebreak" });
      }
      const align = isBlockTag ? alignOfElement(child, ctx, inherited) : inherited;
      if (/^h[1-6]$/.test(tag)) {
        flush();
        const runs = inlineOf(child, ctx);
        if (runs.length) blocks.push({ type: "heading", level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, runs, align });
      } else if (tag === "img") {
        flush();
        pushImage(child, ctx, blocks, align);
      } else if (tag === "p") {
        flush();
        if (containsImg(child)) blocks.push(...parseChildren(child, ctx, warnings, align));
        else {
          const runs = inlineOf(child, ctx);
          if (runs.length) blocks.push({ type: "paragraph", runs, align });
        }
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
        const inner = parseChildren(child, ctx, warnings, align);
        if (inner.length) blocks.push({ type: "quote", blocks: inner });
      } else if (tag === "hr") {
        flush();
        blocks.push({ type: "rule" });
      } else if (CONTAINERS.has(tag)) {
        flush();
        blocks.push(...parseChildren(child, ctx, warnings, align));
      } else if (containsImg(child)) {
        // An inline wrapper (a, span, font) around an image: lift the image to block level.
        flush();
        blocks.push(...parseChildren(child, ctx, warnings, inherited));
      } else {
        // Inline element or unknown element: accumulate into the current paragraph.
        pending.push(child);
      }
      if (css?.breakAfter) {
        flush();
        blocks.push({ type: "pagebreak" });
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
  const metaTag = (name: string) => (inert.querySelector(`meta[name="${name}" i]`)?.getAttribute("content") ?? "").trim().slice(0, 300) || undefined;
  const keywords = metaTag("keywords")?.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 20);
  const meta: DocMeta = { title, author: metaTag("author"), subject: metaTag("description"), keywords: keywords?.length ? keywords : undefined };

  const sheets = inert.querySelectorAll("style, link[rel~='stylesheet']").length;
  const scripts = inert.querySelectorAll("script").length;
  if (scripts) warnings.push(warn("scripts-removed", `${plural(scripts, "script")} removed. Nothing in the file was executed.`, "info"));

  let remote = 0;
  inert.querySelectorAll("source[src], video[src], audio[src], iframe[src], script[src], link[href], embed[src], object[data]").forEach((el) => {
    const v = el.getAttribute("src") ?? el.getAttribute("href") ?? el.getAttribute("data") ?? "";
    if (/^\s*(https?:)?\/\//i.test(v)) remote++;
  });
  if (remote) warnings.push(warn("remote-skipped", `${plural(remote, "remote resource")} (stylesheets, scripts, frames or media) were not loaded. FileForge never fetches anything referenced by your file.`));

  // Inline styles are read from the sanitized DOM only for a fixed list of properties; no CSS is ever applied or emitted.
  const clean = DOMPurify.sanitize(source, {
    RETURN_DOM: true,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcset", "onerror", "onload"],
  }) as unknown as HTMLElement;

  const ctx: Ctx = {
    styleCache: new WeakMap(),
    cssDeclarations: 0,
    cssDropped: new Map(),
    lightColors: 0,
    images: 0,
    imageBudget: newImageBudget(limits.imageMaxMegapixels),
    rejected: new Map(),
    embedded: 0,
    inlineImages: 0,
    mediaCounts: new Map(),
    controls: 0,
    nestedTables: 0,
    depth: 0,
    tooDeep: false,
  };
  const blocks = parseChildren(clean, ctx, warnings);

  // Media elements were forbidden/removed by the sanitizer; count them from the inert document for the report.
  for (const tag of MEDIA) {
    const n = inert.getElementsByTagName(tag).length;
    if (n) ctx.mediaCounts.set(tag, n);
  }

  const droppedCss = Array.from(ctx.cssDropped.values()).reduce((a, b) => a + b, 0);
  if (droppedCss || sheets) {
    const names = Array.from(ctx.cssDropped.entries()).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k]) => k);
    const parts: string[] = [];
    if (sheets) parts.push(`${plural(sheets, "stylesheet or <style> block")} (class and tag rules are not applied)`);
    if (droppedCss) parts.push(`${droppedCss.toLocaleString()} inline style declaration${droppedCss > 1 ? "s" : ""} (${names.join(", ")}${ctx.cssDropped.size > names.length ? ", …" : ""})`);
    warnings.push(warn("css-ignored", `Some CSS was ignored: ${parts.join("; ")}. Supported inline: color, text-align, bold, italic, underline, strike-through and page breaks. Fonts, sizes, spacing, backgrounds and layout are not reproduced.`));
  }
  if (ctx.lightColors) warnings.push(warn("light-colors", `${plural(ctx.lightColors, "very light text color")} ignored, because page backgrounds are not reproduced and the text would be invisible.`, "info"));
  if (ctx.embedded) warnings.push(warn("images-embedded", `${plural(ctx.embedded, "embedded image")} included.`, "info"));
  for (const m of describeRejected(ctx.rejected, ctx.images)) warnings.push(warn("images-skipped", m));
  if (ctx.inlineImages) warnings.push(warn("images-inline", `${plural(ctx.inlineImages, "image")} inside headings, tables or other inline text shown as alt-text placeholders.`));
  if (ctx.mediaCounts.size) {
    const list = Array.from(ctx.mediaCounts.entries()).map(([t, n]) => `${n}× <${t}>`).join(", ");
    warnings.push(warn("media-skipped", `Unsupported embedded content was left out: ${list}.`));
  }
  if (ctx.controls) warnings.push(warn("controls-skipped", `${plural(ctx.controls, "form control")} left out.`, "info"));
  if (ctx.nestedTables) warnings.push(warn("nested-tables", `${plural(ctx.nestedTables, "nested table")} flattened to text.`));
  let droppedLinks = 0;
  inert.querySelectorAll("a[href]").forEach((a) => {
    const href = (a.getAttribute("href") ?? "").trim();
    if (href && !href.startsWith("#") && !safeLink(href)) droppedLinks++;
  });
  if (droppedLinks) warnings.push(warn("links-dropped", `${plural(droppedLinks, "link")} with relative or unsafe addresses kept as plain text.`, "info"));
  if (ctx.tooDeep) warnings.push(warn("nesting-truncated", "Some extremely deeply nested content was left out."));
  warnings.unshift(warn("approximate", "HTML conversion is approximate. Complex layouts are flattened into reading order.", "info"));

  const doc = finalizeDoc(blocks, warnings, title, meta);
  if (!doc.charCount && !doc.imageCount) throw new FileForgeError("no-content", "No convertible text was found in this HTML file.");
  return doc;
}
