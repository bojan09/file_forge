# Phase 4 report: advanced format research and carefully scoped support

**Outcome.** Three of the eight researched pathways passed the safety and quality gates for release as **Experimental**: Word to PDF, Excel to PDF, and text-PDF to Word. Everything else stays Unavailable, with the reason published on the Formats page. Nothing was labeled Supported, because no pathway meets the "no silent loss, every corpus file" bar defined below.

## Baseline and audit

Starting point (Phase 3 commit `d6adf7a`): lint and typecheck clean, 198 unit tests passing, 167 E2E checks passing (desktop and mobile). The audit found no regressions. One Phase 3 gap mattered for this phase: the batch queue's "can't be converted" message was generic; it now names the file type's only output.

## Feasibility matrix

Status words: **Supported** (content and structure kept, layout is the user's choice), **Approximate** (content kept, layout differs), **Experimental** (simple documents; loss possible and reported), **Unavailable**.

| Pathway | Decision | Approach | Why |
|---|---|---|---|
| DOCX to PDF | **Experimental, shipped** | Own parser over `fflate` + `DOMParser` into the shared model, then the Phase 3 PDF renderer | Text, order, headings, lists, tables, links, pictures, page breaks recovered; layout, fonts and spacing are not |
| Text PDF to DOCX | **Experimental, shipped** | pdf.js text positions rebuilt into paragraphs, headings, lists, simple tables, links; Phase 3 DOCX renderer | Reading order and structure recovered for generated PDFs; layout is not |
| Scanned PDF to DOCX | **Unavailable (deferred)** | Detected and refused | OCR; see below |
| XLSX to PDF | **Experimental, shipped** | Own streaming parser (values as formatted, number-format engine, print areas, sheet choice) into a table block | Values match LibreOffice's rendering; styling and charts are not reproduced |
| XLSX to DOCX | **Unavailable (deferred)** | None | A sheet has no single document form |
| PPTX to PDF | **Unavailable** | Prototype measurement only (`phase4-corpus.test.ts`) | Faithful rendering is out of reach locally; see below |
| PPTX to DOCX | **Unavailable** | None | No faithful equivalent |
| EPUB to PDF/DOCX | **Unavailable (not investigated)** | None | Out of scope for this release; optional research per the brief |

### Libraries and licenses considered

Facts below were read from the npm registry on the day of the audit unless noted.

| Library | License | Verdict |
|---|---|---|
| mammoth 1.13.0 | BSD-2-Clause | Not adopted. Converts DOCX to semantic HTML and discards alignment, colors and page breaks that the shared model carries; would add a second parser path and its dependency tree for less fidelity than an own parser on top of the `fflate` already shipped. |
| docx-preview 0.4.1 | Apache-2.0 | Not adopted. Renders DOCX to DOM for display; there is no PDF-grade layout output to feed a text-based PDF. |
| SheetJS `xlsx` 0.18.5 (npm) | Apache-2.0 | Rejected. The npm release is old; the fixes for its known prototype-pollution and ReDoS advisories (CVE-2023-30533, CVE-2024-22363, from memory of the advisories, not re-verified here) are only on SheetJS's own CDN, which this project does not use. |
| exceljs 4.4.0 | MIT | Rejected for size (21.8 MB unpacked) and a Node-first dependency tree. |
| read-excel-file 9.3.12 | MIT | Viable, not adopted: no print areas, no merged-cell or hidden-row/column reporting, and a number-format engine we could not audit against LibreOffice. |
| tesseract.js 7.0.0 | Apache-2.0 | Not adopted. The npm package is small, but it fetches core and language data at run time; vendoring them adds several megabytes per language and cannot read tables or layout (see OCR below). |
| pdf.js (pdfjs-dist 6.4.299, legacy build) | Apache-2.0 | Adopted. Already a runtime dependency for the preview viewer from Phase 3. |
| pdf-lib, pptxgenjs, pptx2json, epubjs | MIT / BSD-2 | Not relevant to reading and rendering these formats (generators or writers) or unmaintained. |

No dependency was added in Phase 4. The three parsers add 9 KB (Word), 8 KB (Excel) and 8 KB (PDF) gzip, each loaded only when a file of that type is opened; pdf.js (about 147 KB gzip plus a 1.26 MB worker file) is shared with the preview viewer.

### Per-pathway evidence

**DOCX to PDF.** Browser support: any browser with `DOMParser`, Web Workers and canvas, the same as the rest of the app. Security: parts are read through a size-capped unzip (entry 64 MB, total 160 MB, 5,000 parts); a zip bomb (80 MB of XML in an 80 KB file) is refused in under 3 s; macros (`vbaProject.bin`) are never read; external relationships are never fetched (links pass the same `http/https/mailto` filter as elsewhere, pictures must be embedded PNG/JPEG within the megapixel limit). Memory: see measurements. Supported subset: headings (including outline levels and the Title style), paragraphs with bold/italic/underline/strike/color/caps, alignment (including justify), nested bullet and numbered lists, tables with header row, merged cells flattened, hyperlinks, embedded PNG/JPEG, page breaks, section breaks, tracked changes (final text), text boxes (moved into the flow), core properties, page size/orientation/margins, default font family and size, line spacing, header, footer and page-number fields. Not supported (each reported when present): comments, footnotes and endnotes, charts, SmartArt, embedded objects, shapes without text, columns, mixed page setups, EMF/WMF/GIF/SVG pictures, embedded fonts.

**Text PDF to DOCX.** Subset: PDFs with selectable text. Reading order is rebuilt from text positions (baseline clustering, two-column gutter detection, repeated header/footer removal, hyphen rejoining, paragraph breaks from spacing, indentation, line ends and alignment), headings from size and bold, lists from bullet and number markers (including private-use bullet glyphs), tables from at least three rows with aligned columns, hyperlinks from link annotations, bold/italic from the font names. Not recovered: pictures, borders and merged cells, text boxes, rotated text, exact layout, fonts. Scanned PDFs (no text on more than 70% of pages and almost no characters), password-protected and damaged PDFs fail with specific messages. pdf.js runs with `fontExtraProperties` for real font names; limits are 300 pages (100 in conservative mode) and 6 million characters.

**Scanned PDF to DOCX (OCR).** Deferred. Reasons, in order of weight: a recognition failure produces a plausible-looking but wrong document, which conflicts with the project's "never fake support" rule; layout and tables are not recovered by plain OCR; a browser-only engine needs vendored core and per-language models (several megabytes each) and several seconds per page on a laptop CPU, far more on a phone; and language coverage would be a separate product decision. The app detects scanned PDFs and says exactly this instead of producing an empty file.

**XLSX to PDF.** Subset: values, shared and inline strings, booleans, errors, numbers with the common number formats (General, decimals, thousands, percent, scientific, currency affixes, negative sections, text sections, scaling commas, the usual date and time tokens, the 1904 date system), print areas, hidden rows/columns/sheets, column widths as weights, sheet choice (one or all), first-row-is-header option. Formulas show the cached result stored in the file and are never recalculated (formulas saved without a result are counted and reported). Not reproduced and reported: styling, conditional formatting, merged cells (top-left value only), charts, pictures, pivot tables beyond their values, fractions/elapsed-time/conditional number formats (fall back to General and say so). Limits: used range up to 20,000 rows and 40 columns (5,000 and 30 in conservative mode), 1.5 million non-empty cells; beyond them the file is refused with the limit stated, never truncated.

**PPTX to PDF.** Prototype result (`docs/evidence/phase4-corpus.json`, test "PowerPoint feasibility"): naive text extraction recovers 100% of the words of both decks, but in the simple deck all 4 of 4 title and body placeholders take their position from the slide layout and master (no position of their own), and the complex deck contains a chart, a picture and a table that no text extraction touches. Reproducing a slide therefore needs layout and master inheritance, theme fonts and colors, autofit, charts, SmartArt, effects and embedded fonts. A text-only outline would be a different, misleading product under the name "PPTX to PDF". Not shipped, not offered as a disabled button.

## Quality gates

Criteria, fixed before measuring (in `tests/unit/phase4-corpus.test.ts`):

| Criterion | Threshold |
|---|---|
| Text | word recall at least 0.99 against an independent reference (python-docx text, pdftotext, LibreOffice's rendering, or the generator's source order) |
| Order | in-order word recall at least 0.95 |
| Pages (DOCX to PDF) | within 0.7x to 1.6x of LibreOffice's page count |
| Safety | malformed, protected, scanned, oversized and hostile files fail with a specific message, quickly, never crash |
| Supported label | every criterion on every corpus file of that kind **and** no content category dropped silently |

Results on the corpus (`tests/corpus`, 49 files generated by `scripts/make-corpus.py`, with references from python-docx, openpyxl, pdftotext and LibreOffice):

| Pathway | File | Text recall | Order | Pages (ours / LibreOffice) | Notes |
|---|---|---|---|---|---|
| DOCX to PDF | simple | 1.000 | 1.000 | 1 / 1 | |
| | complex (lists, tables, merged and nested cells, tracked changes, text box, 2 pictures, landscape section, header/footer, Unicode) | 0.987 | 0.987 | 4 / 4 | floating text box content sits after its anchor paragraph |
| | long (60 chapters) | 1.000 | 1.000 | 71 / 50 (1.42x) | Roboto is wider than Calibri |
| XLSX to PDF | simple, multi (all sheets, print area), wide (30 columns), unicode | 1.000 each | n/a | 1, 2, 1, 1 | token recall vs LibreOffice's PDF; its `###` and chart axis labels are excluded |
| | long (5,000 rows) | all rows present | n/a | 162 | |
| PDF to DOCX | text report (5 headings, bullets, 5x3 table, header/footer) | 1.000 | 1.000 | n/a | 5 of 5 headings, list of 3, table 5x3 rebuilt |
| | two columns | 1.000 | 1.000 | n/a | order vs the generator's source order |
| | 120-page document | 1.000 | 1.000 | n/a | 120 headings |
| | LibreOffice export of the complex Word file | 1.000 | 1.000 | n/a | alignment, bold headings, bullets, table, 2 pictures reported |

Safety results: truncated, disguised (text renamed to .docx/.xlsx/.pdf), missing-part, invalid-XML, zip-bomb (Word and Excel), over-wide sheet, scanned PDF, encrypted PDF, truncated PDF and non-PDF files are all refused with a specific message; each case is a test.

Why no pathway is "Supported": the corpus files that include charts, SmartArt, footnotes, text boxes or merged cells lose that content (reported, but lost); page counts differ from the original application; PDF reading order and tables are heuristics. "Experimental" is the honest label.

## Measurements

Browser (desktop Chromium, headless, this container; `PERF=1 npx playwright test perf -g "phase 4"`). The "x4" runs set Chromium's CPU throttle to 4x slower, which slows the page's main thread (parsing) but is only an approximation of a phone; it is not a real device.

| Case | open and parse x1 | convert x1 | open and parse x4 | convert x4 | Output |
|---|---|---|---|---|---|
| docx-simple to PDF | 290 ms | 1.0 s | 1.9 s | 1.1 s | 1 page |
| docx-long (71 pages) | 125 ms | 1.4 s | 349 ms | 1.6 s | 71 pages |
| xlsx-wide (30 columns) | 183 ms | 1.0 s | 451 ms | 1.3 s | 1 page |
| xlsx-long (5,000 rows) | 194 ms | 1.9 s | 565 ms | 2.7 s | 162 pages |
| pdf-text-simple to DOCX | 261 ms | 0.9 s | 492 ms | 1.1 s | |
| pdf-long (120 pages) to DOCX | 887 ms | 0.9 s | 1.6 s | 1.2 s | |

JS heap stayed between 18 and 35 MB in every case. The whole Chromium process tree measured 700 to 950 MB resident, which includes the browser itself and the renderer; this was not isolated per tab, so it is an upper bound, not the cost of one conversion. Real phones, with less memory and slower cores, are unverified.

## What changed

- **Engine**: `parsers/{docx,xlsx,xlsx-format,pdf,zip-safe,binary}.ts`, `pdfjs.ts` (shared loader), registry entries and `UNAVAILABLE_PATHWAYS`, `convert.ts` (binary branch, signature checks, re-parse from kept bytes, abortable inspection), batch intake and eligibility messages.
- **Settings read from the source**: Word page size, orientation, margins, font family and size, line spacing, header, footer and page numbering become the editable starting values for the conversion.
- **UI**: capability matrix with the four labels and a "Not available" section; format list entries; experimental notices in the workspace and on the result; XLSX sheet picker and print-area option; "Extracted content" preview label; no Raw Content tab for binary sources; upload copy.
- **Tests**: `phase4-corpus`, `phase4-xlsx-format`, `phase4-integration` (unit), `phase4.spec` (E2E, desktop and mobile), perf and screenshot additions; corpus and reference generator.

## Test results

| Command | Result |
|---|---|
| `npx eslint .` | clean |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 299 passed, 2 skipped (artifact export, perf gate) |
| `npm run build` | passes |
| `npx playwright test` (desktop + mobile) | 201 passed, 27 skipped (screenshot and perf gates), 0 failed |

## Privacy, security and accessibility

- No new network destinations or dependencies; the E2E suite asserts no external requests, no non-GET requests and no request bodies while converting Word, Excel and PDF files.
- All parsing is local. Archives are read through size-capped unzip; XML parts are parsed with `DOMParser` (no external entities or network access) or scanned as text; images are decoded only after signature, structure and megapixel checks; macros are never read; links are filtered.
- axe (wcag2a, 2aa, 21aa) is clean on the workspace and result screens for Word, Excel and PDF files, light and dark themes, no horizontal overflow on desktop or mobile.

## Design comparison

New screens follow the Phase 1 design system: the same cards, segmented output choice, warning badge, notice list and result layout. Deliberate additions: an amber "Experimental conversion" banner under the output choice, a disabled DOCX/PDF button labeled "Not available" when the source can't produce it, and capability badges (green, amber) in the Formats matrix. Screenshots: `docs/screenshots/*-13-formats-matrix.png` to `*-18-scanned-refused.png`.

## Known limitations and recommended next steps

- Real-device behavior (iOS Safari, low-memory Android), Word itself, and screen readers were not tested; Firefox and Safari were not run.
- DOCX pictures other than PNG and JPEG (EMF, WMF, GIF, SVG, WebP) are replaced by a visible note. A canvas-based converter could carry GIF and WebP.
- DOCX to PDF page counts run about 40% above LibreOffice's for long documents because the bundled fonts are wider than Calibri; a metrically compatible bundled sans font (Carlito, SIL OFL) would close most of that gap.
- PDF to DOCX does not extract pictures; recovering them from the operator list is feasible and the most useful next step. Tables are recognised only when columns align; merged cells and borders are not recovered.
- XLSX cell styling (bold, fills, borders) is not carried; bold and number alignment would be a modest addition.
- OCR, PowerPoint and EPUB remain out of scope for the reasons above.

## Git

Committed on the working branch and pushed to `master` only. No pull request, merge or deployment was performed from this session; deployment is handled by the project owner.
