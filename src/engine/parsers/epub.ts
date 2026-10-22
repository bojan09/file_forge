import { PROCESSING_LIMITS } from "../registry";
import { FileForgeError, type Block, type ConversionWarning, type DocMeta, type Processing } from "../types";
import { finalizeDoc, warn } from "./common";
import { OfficeZip, decodeXml, resolveTarget } from "./zip-safe";
import { parseHtml } from "./html";
import type { ParsedBinary } from "./binary";

const MAX_CHAPTERS = 3000;
const MAX_IMAGES = 600;
const MAX_IMAGE_BYTES_TOTAL = 80 * 1024 * 1024;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Font obfuscation is not encryption: the fonts are ignored anyway, so text stays readable. */
const FONT_OBFUSCATION = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.[2] ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag)?.[1];

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Text of the first element named `local` (any namespace prefix), entities decoded. */
function firstText(xml: string, local: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${local}>`, "i").exec(xml);
  if (!m) return undefined;
  const t = decodeXml(m[1]!.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return t || undefined;
}
function allText(xml: string, local: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${local}>`, "gi"))) {
    const t = decodeXml(m[1]!.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Chapters are XHTML. The HTML parser would treat an XML-style empty element such as `<div/>` as an open tag and nest the
 * rest of the chapter inside it, so those are expanded first.
 */
function normalizeXhtml(src: string): string {
  return stripBom(src).replace(/<([a-zA-Z][\w:-]*)((?:\s[^<>]*?)?)\s*\/>/g, (all, tag: string, rest: string) => (VOID.has(tag.toLowerCase()) ? all : `<${tag}${rest}></${tag}>`));
}

interface ImageState {
  count: number;
  bytes: number;
  skipped: number;
  unsupported: number;
}

/** Replaces image references that point into the package with data URIs, so the HTML parser can embed them safely. */
function inlineImages(html: string, chapterPath: string, zip: OfficeZip, state: ImageState): string {
  const inline = (href: string | undefined): string | undefined => {
    if (!href || /^(data:|https?:|\/\/)/i.test(href.trim())) return undefined;
    const path = resolveTarget(chapterPath, decodeURIComponent(href.split("#")[0]!.split("?")[0]!));
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const bytes = zip.bytes(path);
    if (!bytes) return undefined;
    const mime = IMAGE_TYPES[ext];
    if (!mime) {
      state.unsupported++;
      return undefined;
    }
    if (state.count >= MAX_IMAGES || state.bytes + bytes.length > MAX_IMAGE_BYTES_TOTAL) {
      state.skipped++;
      return undefined;
    }
    state.count++;
    state.bytes += bytes.length;
    return `data:${mime};base64,${toBase64(bytes)}`;
  };
  return html
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const uri = inline(attr(tag, "src"));
      return uri ? tag.replace(/\bsrc\s*=\s*("[^"]*"|'[^']*')/i, `src="${uri}"`) : tag;
    })
    // Cover pages are often an SVG wrapper around <image xlink:href="...">.
    .replace(/<image\b[^>]*>/gi, (tag) => {
      const uri = inline(attr(tag, "xlink:href") ?? attr(tag, "href"));
      return uri ? `<img src="${uri}" alt="">` : "";
    });
}

export function parseEpub(bytes: Uint8Array, processing: Processing): ParsedBinary {
  const limits = PROCESSING_LIMITS[processing];
  // Fonts and media are never read: only markup, metadata and the two raster image types the converter can embed.
  const zip = OfficeZip.open(bytes, (n) => !/\.(ttf|otf|woff2?|mp3|mp4|m4a|ogg|wav|webm|mov)$/i.test(n), { maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: 400 * 1024 * 1024, maxEntries: 20000 });

  const container = zip.text("META-INF/container.xml");
  const opfPath = container ? decodeXml(attr(/<rootfile\b[^>]*>/i.exec(container)?.[0] ?? "", "full-path") ?? "") : "";
  if (!container || !opfPath || !zip.has(opfPath)) throw new FileForgeError("epub-invalid", "This file isn't a valid EPUB: its package description is missing. It may be damaged or have the wrong extension.");

  const enc = zip.text("META-INF/encryption.xml");
  if (enc) {
    const algorithms = [...enc.matchAll(/<(?:[\w-]+:)?EncryptionMethod\b[^>]*>/gi)].map((m) => attr(m[0], "Algorithm") ?? "");
    if (algorithms.some((a) => !FONT_OBFUSCATION.includes(a))) {
      throw new FileForgeError("epub-drm", "This EPUB is protected (DRM) and can't be read. FileForge never removes protection. Use a copy you are allowed to open without protection.");
    }
  }

  const opf = stripBom(zip.text(opfPath)!);
  const manifest = new Map<string, { href: string; type: string }>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(m[0], "id");
    const href = attr(m[0], "href");
    if (id && href) manifest.set(id, { href: decodeXml(href), type: attr(m[0], "media-type") ?? "" });
  }
  const spine: string[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = attr(m[0], "idref");
    const item = idref ? manifest.get(idref) : undefined;
    if (item && /x?html/i.test(item.type + item.href)) spine.push(resolveTarget(opfPath, decodeURIComponent(item.href)));
  }
  if (!spine.length) throw new FileForgeError("epub-invalid", "This EPUB lists no readable chapters.");
  if (spine.length > MAX_CHAPTERS) throw new FileForgeError("epub-too-large", `This EPUB has ${spine.length.toLocaleString()} content files, above the ${MAX_CHAPTERS.toLocaleString()} limit.`);

  const title = firstText(opf, "title");
  const authors = allText(opf, "creator");
  const meta: DocMeta = {
    title,
    author: authors.length ? authors.slice(0, 3).join(", ") : undefined,
    subject: firstText(opf, "description")?.slice(0, 300),
    keywords: allText(opf, "subject").slice(0, 20),
  };
  if (!meta.keywords?.length) meta.keywords = undefined;

  const blocks: Block[] = [];
  const warnings = new Map<string, ConversionWarning>();
  const imageState: ImageState = { count: 0, bytes: 0, skipped: 0, unsupported: 0 };
  let read = 0;
  let missing = 0;
  let empty = 0;
  for (const path of spine) {
    const raw = zip.text(path);
    if (raw === undefined) {
      missing++;
      continue;
    }
    const html = inlineImages(normalizeXhtml(raw), path, zip, imageState);
    let chapter;
    try {
      chapter = parseHtml(html, processing);
    } catch (e) {
      // A chapter that is only a picture or an empty page is not an error for a book.
      if (e instanceof FileForgeError && e.code === "no-content") {
        empty++;
        continue;
      }
      throw e;
    }
    read++;
    if (blocks.length) blocks.push({ type: "pagebreak" });
    blocks.push(...chapter.blocks);
    for (const w of chapter.warnings) if (w.code !== "approximate" && !warnings.has(w.code)) warnings.set(w.code, w);
    // Keep the guard cheap: stop reading further chapters once the book is clearly beyond the page limit.
    if (blocks.length > 400_000) throw new FileForgeError("doc-too-long", `This book is longer than ${limits.docMaxPages.toLocaleString()} pages. Split it into parts and convert them one at a time.`);
  }
  if (!read) throw new FileForgeError("no-content", "No readable text was found in this EPUB.");

  const out: ConversionWarning[] = [warn("approximate", `EPUB conversion is approximate. ${read.toLocaleString()} chapter${read === 1 ? "" : "s"} were read in book order; the book's own fonts, colors, spacing and page layout are not reproduced.`, "info")];
  // Warnings from the HTML parser describe CSS the book carries; per-chapter counts would be misleading, so each kind is shown once.
  for (const w of warnings.values()) if (w.code !== "images-embedded") out.push(w);
  if (imageState.count) out.push(warn("images-embedded", `${imageState.count.toLocaleString()} image${imageState.count === 1 ? "" : "s"} included.`, "info"));
  if (imageState.skipped) out.push(warn("images-skipped", `${imageState.skipped.toLocaleString()} image${imageState.skipped === 1 ? "" : "s"} left out to keep the conversion within memory limits.`));
  if (imageState.unsupported) out.push(warn("images-format", `${imageState.unsupported.toLocaleString()} image${imageState.unsupported === 1 ? "" : "s"} in formats other than JPEG or PNG (such as GIF or SVG) were left out.`));
  if (missing) out.push(warn("epub-missing", `${missing.toLocaleString()} listed chapter${missing === 1 ? " is" : "s are"} missing from the file and were skipped.`));
  if (empty) out.push(warn("epub-empty", `${empty.toLocaleString()} page${empty === 1 ? "" : "s"} without text (covers, image-only pages) were left out.`, "info"));
  if (zip.allNames.some((n) => /(^|\/)nav\.x?html$|toc\.ncx$/i.test(n))) out.push(warn("epub-toc", "The book's table of contents page is included as text; its links are not clickable.", "info"));

  const doc = finalizeDoc(blocks, out, title, meta);
  return { doc, suggested: { style: undefined } };
}
