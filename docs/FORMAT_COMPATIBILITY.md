# Format compatibility

Source of truth in code: `src/engine/registry.ts`. The Formats page in the app is generated from the same registry.

## Matrix

| Input | Extensions | PDF | DOCX | Max size |
|---|---|---|---|---|
| Plain text | `.txt` | High | High | 5 MB |
| Markdown | `.md`, `.markdown` | High | High | 5 MB |
| HTML | `.html`, `.htm` | Approximate | Approximate | 2 MB |
| CSV | `.csv` | Approximate | Approximate | 5 MB |
| Images | `.jpg`, `.jpeg`, `.png`, `.webp` | High (picture PDF) | Not supported | 15 MB, 25 MP |

Anything else (for example `.pdf`, `.docx`, `.zip`) is rejected with an explanation. Only one file is converted at a time.

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
- Raw HTML in Markdown is not interpreted. It appears as text.
- Images are not fetched. The alt text is kept as `[image: alt]` and a warning is shown.
- Links are kept only for `http:`, `https:` and `mailto:`. Others become plain text.

### HTML (approximate)
- Pipeline: inert `DOMParser` document, then DOMPurify, then a walk over a documented element subset.
- Supported: `h1`-`h6`, `p`, `div` and sectioning elements, `ul`/`ol`/`li` (nested), `table` (`thead`, `th`, `td`), `pre`, `blockquote`, `hr`, `a`, `strong`/`b`, `em`/`i`, `s`/`del`, `code`/`kbd`/`samp`, `br`, `img` (placeholder only).
- Never executed or fetched: scripts, event handlers, stylesheets, remote images, fonts, iframes, objects, video/audio, SVG.
- Reported to the user as warnings, not silently dropped: ignored CSS, removed scripts, remote resources not loaded, unsupported embedded content, form controls, nested tables flattened, merged cells (`colspan`/`rowspan`) shown as single cells, unsafe links, very deep nesting.
- Not supported: CSS layout (columns, floats, positioning), page-level styling, fonts, colors.

### CSV (approximate)
- Delimiter auto-detected (comma, semicolon, tab and others). Quotes, escaped quotes and newlines inside cells are handled.
- The first row is the header. Short rows are padded and the user is warned.
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
