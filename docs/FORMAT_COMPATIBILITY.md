# Format compatibility

Source of truth in code: `src/engine/registry.ts`. The Formats page in the app is generated from the same registry.

## Matrix

| Input | Extensions | PDF | DOCX | Max size |
|---|---|---|---|---|
| Plain text | `.txt` | High | High | 100 MB (≈3,000 pages) |
| Markdown | `.md`, `.markdown` | High | High | 100 MB (≈3,000 pages) |
| HTML | `.html`, `.htm` | Approximate | Approximate | 100 MB (100,000 elements) |
| CSV | `.csv` | Approximate | Approximate | 100 MB (20,000 rows) |
| Images | `.jpg`, `.jpeg`, `.png`, `.webp` | High (picture PDF) | Not supported | 100 MB, 25 MP |
| Word | `.docx` | Experimental | Not supported | 100 MB |
| Excel | `.xlsx` | Experimental | Not supported | 100 MB (20,000 rows) |
| EPUB | `.epub` | High | High | 100 MB (≈3,000 pages) |
| PDF with text | `.pdf` | Not supported | Experimental | 100 MB (1,000 pages) |

Every format accepts files up to 100 MB; the practical limits are the page, row and element counts shown. Conservative mode (low-memory devices) lowers them (documents 1,000 pages, PDFs 300 pages, CSV and Excel 5,000 rows, HTML 30,000 elements) and caps files at 30 MB. A file within the size limit but beyond its page limit is refused with a message that says so.

Anything else (for example `.zip`, `.mobi`, `.pptx`) is rejected with an explanation. Only one file is converted at a time.

## What the outputs contain

**Searchable PDF (TXT, MD, HTML, CSV).** Text is embedded with the Roboto font, so it can be selected, copied and searched. Verified in tests by extracting text with pdf.js. Pages are paginated with page numbers in the footer. Table header rows repeat on each page.

**Picture PDF (images).** One image per page. The PDF contains a picture; text inside the image is not selectable (there is no OCR). The result screen says so.

**Editable DOCX (TXT, MD, HTML, CSV).** Real Word paragraphs, heading styles, bullet and numbered lists (numbering restarts for separate lists), tables with header rows, hyperlinks, bold/italic/strike, code runs. The package contains no images, so it is never a screenshot of a page. Verified by unzipping the file, checking `document.xml`, and opening samples in LibreOffice. Not verified in Microsoft Word.

## Per-format behavior

### TXT
- Blank lines separate paragraphs; single line breaks inside a paragraph are kept.
- Tabs become four spaces; control characters are removed.
- UTF-8 (with or without BOM) and UTF-16 (with BOM) are decoded. Invalid UTF-8 sequences show a warning.
- Binary files (NUL bytes) are rejected.
- Not preserved: fixed-width alignment.

### Markdown
- Supported: headings, paragraphs, nested bullet and numbered lists, block quotes, fenced and indented code, horizontal rules, tables (with column alignment), bold, italic, strikethrough, inline code, links, autolinked URLs.
- Raw HTML in Markdown is not interpreted. It appears as text and is counted in a note; `<br>` is honoured and HTML comments are removed.
- Images embedded as `data:image/png|jpeg;base64` are included (own paragraph or lifted out of text). Linked images are never fetched: the alt text stays as `[image: alt]` and a warning says so.
- Task lists (`- [x]`) render as ● / ○ markers without a bullet (the bundled fonts have no checkbox glyph).
- Front matter (`title`, `author`, `description`, `keywords`) becomes document properties. `<!-- pagebreak -->`, `\newpage` start a new page.
- "Source text" mode keeps the Markdown unformatted in a monospaced block.
- Links are kept only for `http:`, `https:` and `mailto:`. Others become plain text.

### HTML (approximate)
- Pipeline: inert `DOMParser` document, then DOMPurify, then a walk over a documented element subset.
- Supported: `h1`-`h6`, `p`, `div` and sectioning elements, `ul`/`ol`/`li` (nested), `table` (`thead`, `th`, `td`), `pre`, `blockquote`, `hr`, `a`, `strong`/`b`, `em`/`i`, `u`/`ins`, `s`/`del`, `code`/`kbd`/`samp`, `font color`, `center`, `br`, `img` with a `data:` PNG/JPEG source.
- Inline `style` properties read: `color` (near-white is ignored), `text-align`, `font-weight`, `font-style`, `text-decoration`, `page-break-before/after`, `break-before/after`. The `align` attribute is honoured. Every other property is counted and named in a warning; class and tag rules from `<style>` are not applied.
- Images: data-URI PNG/JPEG up to 4 MB each, 20 MB and 100 images in total, within the megapixel limit, with a valid PNG chunk structure. Anything else (remote, relative, SVG, WebP, corrupt, too large) leaves an `[image: alt]` placeholder and a warning. Images inside headings, tables or inline text stay as placeholders.
- Never executed or fetched: scripts, event handlers, stylesheets, remote images, fonts, iframes, objects, video/audio, SVG.
- Reported to the user as warnings, not silently dropped: ignored CSS, removed scripts, remote resources not loaded, unsupported embedded content, form controls, nested tables flattened, merged cells (`colspan`/`rowspan`) shown as single cells, unsafe links, very deep nesting.
- Not supported: CSS layout (columns, floats, positioning), backgrounds, fonts and sizes from CSS, page-level styling.

### CSV (approximate)
- Delimiter auto-detected (blank lines ignored for detection) or set to comma, semicolon, tab or pipe; the detected/used delimiter is reported. Quotes, escaped quotes and newlines inside cells are handled.
- The first row is the header unless "first row is data" is chosen. Short rows are padded and the user is warned. Rows of empty cells are kept; fully blank lines are skipped and counted.
- Numeric columns are right-aligned (optional); zebra rows, header shading, borders, equal or content-based column widths and a table text scale are available.
- Column widths come from content (weights from up to 500 rows). Font size shrinks as column count grows.
- Warnings: more than 7 columns recommends landscape; more than 15 columns warns that text will be small; malformed quotes; very long cells.
- Rejected: more than 20,000 rows or 40 columns (balanced mode) with a message asking the user to split the file. Nothing is silently truncated.
- Values are shown as written. No number or date formatting is applied.

### Images
- JPEG, PNG and WebP are accepted. The file extension must match the contents.
- Dimensions are read from the file header before decoding, so oversized images (above 25 MP in balanced mode, 12 MP in conservative mode) are rejected without allocating memory.
- EXIF orientation is honored. A JPEG stored landscape with orientation 6 produces a portrait page.
- Quality: High keeps original pixels (a JPEG or 8-bit non-interlaced PNG is embedded unchanged when safe; otherwise it is re-encoded losslessly or at 95%). Balanced re-encodes to JPEG (85%) with a 3000 px long side. Small uses 70% and 2000 px. Transparent images are flattened onto white in Balanced and Small.
- Fit: "Fit to page" keeps aspect ratio inside the margins; "Match image size" makes the page the image's size (96 dpi, no margins). Orientation is "Auto" by default for images.

## Word, Excel and PDF inputs (Phase 4, experimental)

Every row is labeled **Experimental**. The app lists what was left out before and after the conversion. Criteria and measured results: `docs/PHASE4_REPORT.md`.

| Input | Output | Kept | Not kept (always reported) |
|---|---|---|---|
| Word `.docx` | PDF | text, headings, bold/italic/underline/strike/color, alignment, nested lists, tables, links, embedded PNG/JPEG, page breaks, tracked changes as final text, text boxes (in the flow), properties; page setup, font, spacing, header, footer and page numbers as editable options | layout and fonts, comments, footnotes, endnotes, charts, SmartArt, embedded objects, shapes, columns, merged cells (shown as separate cells), EMF/WMF/GIF/SVG pictures |
| Excel `.xlsx` | PDF | values as formatted in the workbook, sheet choice (one or all), print area, hidden rows/columns/sheets left out as when printing, column widths, number alignment | colors, borders, fonts, conditional formatting, charts, pictures, merged cells (top-left value only), recalculation (cached results are shown), fractions/elapsed-time formats |
| EPUB `.epub` | PDF, Word `.docx` | chapters in spine (book) order, each starting on a new page; headings, paragraphs, bold/italic, lists, tables, links, JPEG/PNG pictures (also inside SVG cover wrappers); title and author from the book's metadata | the book's fonts, colors, CSS and page layout, GIF/SVG pictures, audio and video, footnotes as links, the table of contents page (left out; it only holds links), clickable internal links; DRM-protected books are refused |
| PDF with text | Word `.docx` | paragraphs, headings, bullet and numbered lists, aligned tables, links, bold/italic, document properties, two-column reading order | page layout, fonts, pictures, borders, merged cells, text boxes, rotated text, repeated headers/footers and page numbers (removed, reported) |

Refused with a specific message: scanned PDFs (no OCR), password-protected PDFs, damaged or disguised files, archives that expand beyond the size caps, sheets above 20,000 rows or 40 columns (5,000 and 30 in conservative mode), PDFs above 1,000 pages (300 conservative), documents above about 3,000 pages (1,000 conservative), DRM-protected EPUBs.
Not offered: `.doc`, `.xls`, macro-enabled files, PowerPoint, MOBI/AZW, Excel to Word, Word or Excel to anything but PDF.
In a batch, the shared output decides eligibility: a PDF in a "to PDF" batch, or Word and Excel files in a "to DOCX" batch, are skipped with an explanation. Page setup read from a document applies to single-file conversions, not to batches.

## Styling options (PDF and DOCX)

| Option | PDF | DOCX |
|---|---|---|
| Font family | Roboto, Liberation Serif, Liberation Mono (embedded, subset) | Calibri, Times New Roman, Courier New (not embedded; Word substitutes if missing) |
| Body size 9 to 16 pt, line spacing 1 to 2 | yes | yes (document defaults and heading styles) |
| Header text, footer text, page numbers | yes | yes (header/footer parts with PAGE and NUMPAGES fields) |
| Underline, color, alignment, justify | yes | yes |
| Page breaks | yes (a trailing break is ignored) | yes (`pageBreakBefore` on the next paragraph) |
| Images | PNG/JPEG; alpha, interlaced and 16-bit PNGs are flattened on white | PNG/JPEG unchanged, with alt text |
| Table borders, zebra, header fill, column sizing, numeric alignment, text scale | yes | yes |
| Orientation Auto | landscape when a table has more than 7 columns | same |
| Document properties | title, author, subject, keywords | core properties |

Block quotes are drawn as indented gray italic text in PDF and with a left border in DOCX. Table rows are never split across pages in PDF; the header row repeats on each page in both formats.

## Fonts and scripts

PDF text uses Roboto (Latin, Latin Extended, Greek, Cyrillic including Macedonian letters, common punctuation and currency symbols). Characters the font lacks (for example CJK, Arabic, Hebrew, emoji, arrows, check marks, box drawing) are replaced by `?` in PDF and a warning lists examples. If more than 30% of visible characters are unsupported, PDF output is refused and the user is directed to DOCX, which keeps every character. The glyph table is generated from the font files by `scripts/gen-font-coverage.mjs`.

## Processing modes

| Limit | Balanced | Conservative |
|---|---|---|
| Image megapixels | 25 | 12 |
| CSV rows | 20,000 | 5,000 |
| CSV columns | 40 | 30 |
| HTML elements | 100,000 | 30,000 |

File byte limits are the same in both modes.

## Quality checks shown to the user

Only checks that actually ran are shown.

- PDF: non-empty file; `%PDF-` header and `%%EOF` marker; page count; fonts present and no raster images (text PDFs) or an embedded image (picture PDFs); a failed item when characters were replaced.
- DOCX: non-empty; valid ZIP with Word parts; text stored as Word text runs with no media; first source text found in `document.xml`; tables, heading styles and numbering present when the source had them.

These checks inspect structure. They cannot judge visual quality, and the result screen says so.

## Batch and merge (Phase 2)

- The batch queue uses exactly the matrix above; nothing new is convertible. Eligibility is evaluated per file against its selected output. Images selected for DOCX are skipped with the reason "Images can only be converted to PDF", and are not counted as failures.
- Per-file settings that are shown: output format (all files); paper size, orientation and margins (all files, PDF and DOCX); image quality and image placement (images only).
- Batch limits (balanced / conservative): 10 / 5 files and 50 / 25 MB combined input, in addition to the per-format size limits. Rejected files stay listed with a reason (up to 20 rows).
- Duplicates are exact content matches (same size and SHA-256); a same-named file with different content is kept.
- Output names are unique per batch (`name.pdf`, `name (2).pdf`, case-insensitive). ZIP entries are sanitized: no folders (except the optional `originals/`), no `..`, no reserved Windows names.
- **Merge images to one PDF**: JPG, PNG, WebP only; one image per page in list order; page size A4/Letter/Legal; orientation auto (per image), portrait or landscape; margins narrow/normal/wide; placement "Fit within margins" (whole image, proportions kept) or "Fill the page area" (centered crop, only when chosen); quality high/balanced/small; EXIF orientation honored; transparency shown on white. The PDF contains pictures only: it is not searchable and there is no OCR. "Page matches image size" is available for single images but not for merged PDFs.

## Large input behavior (Phase 2 fix)

Very long paragraphs and long unbroken runs are split into smaller layout units before PDF layout so conversion time stays roughly linear. No characters are added or removed. A line may wrap slightly early where a long paragraph was split (about every 3,000 characters). DOCX output is not split.
