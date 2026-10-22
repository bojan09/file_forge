# Changelog

## EPUB, larger files, home button (unreleased)

### Added
- EPUB to PDF and Word, labeled **Supported**: chapters in spine order with page breaks, headings, lists, tables, links and JPEG/PNG pictures (including SVG-wrapped covers); title and author from the OPF; DRM-protected books refused; GIF/SVG pictures reported as left out. Navigation pages are left out; XHTML in other encodings and fixed-layout books are handled or reported. Evidence: books from pandoc (EPUB 2 and 3) and LibreOffice reach word recall 1.00 and reading order ≥ 0.95, with every heading, list, table and picture present.
- Page guards: documents above about 3,000 pages (1,000 in conservative mode) are refused with a clear message before they can exhaust memory; PDF page limit raised from 300/100 to 1,000/300.

### Changed
- Every format accepts files up to 100 MB (PDF tools too: 100 MB per file, 300 MB and 3,000 pages per operation). Conservative mode caps files at 30 MB.
- The FileForge logo and the Convert link return to the upload screen even when you are already on the home page (a batch that is still running is left alone).


## Fix: production crash and missing offline worker (unreleased)

### Fixed
- The whole app stopped responding (links, pages, upload, convert) in browsers where `window.scrollTo()` or `element.focus()` return a value (some extensions and polyfills): several effects returned that value, so React called it as a cleanup function ("TypeError: i is not a function"). Every effect now returns nothing; a regression test patches both calls.
- `/sw.js` was a 404 on Vercel, so the offline copy never started: Vercel's build adapter publishes only files that exist when `next build` finishes, and the worker was generated afterwards. It is now generated into `public/` before the build and finds Next's hashed files itself at install time.
- Lint ignores `.vercel/` build output; `.vercel` is git-ignored.


## Phase 6: PDF Tools and release readiness (unreleased)

### Added
- PDF Tools workspace (`/pdf-tools/`): merge, split (ranges, every N, every page, ZIP), organize with thumbnails (reorder, rotate, delete, extract by range), properties editor (Unicode-safe), experimental lossless compression with before/after sizes. Runs in its own worker; cancellable; offline.
- Per-file refusal of encrypted, damaged and non-PDF input; size and page limits; output verified by reopening.
- Tests: ranges, tools against poppler (pdftotext/pdfinfo) and pdf.js, 14 browser tests (both viewports), offline PDF-tools run, performance measurements.
- `docs/PHASE6_REPORT.md`, `docs/RELEASE_CHECKLIST.md`.

### Changed
- Primary navigation gains "PDF Tools"; mobile bottom bar has five items.
- Light-theme warning color darkened for AA contrast on tinted badges.


## Phase 5: Offline PWA, performance, accessibility, hardening (unreleased)

### Added
- Installable PWA: web manifest with maskable icons and shortcuts, install button in Settings (only when the browser offers it), hand-written versioned service worker that precaches app assets only (never user files), offline indicator, opt-in update banner that never applies mid-conversion, "Remove offline copy" in Settings, Data Saver respected.
- Conversion engines built as a separate worker bundle: page scripts dropped from 990 KB to 207 KB over the wire.
- Branded 404 page; forced-colors (high contrast) styles; 44 px touch targets on coarse pointers.
- Tests: PWA/offline/update, axe across every screen and state in both themes, privacy (remote resources inert, no file names in console/storage, object URL lifecycle), first-load and main-thread blocking measurements.

### Fixed
- Selecting several files after a rejected file now opens the batch screen.
- Escape cancels batch/merge clear confirmations and returns focus to the trigger.

### Changed
- Unsupported browsers without Web Workers get an explicit message instead of a main-thread conversion.

See `docs/PHASE5_REPORT.md`.

## Phase 4: Advanced formats, carefully scoped (unreleased)

### Added
- **Experimental** conversions: Word (.docx) to PDF, Excel (.xlsx) to PDF, and text PDF to Word (.docx). Each lists, before and after conversion, what it could not carry over.
- Word parser: headings, formatting, alignment, nested lists, tables, links, embedded PNG/JPEG, page and section breaks, tracked changes as final text, text boxes, document properties; page size, orientation, margins, font, line spacing, header, footer and page numbers become editable starting options.
- Excel parser: formatted values (number, percent, currency, scientific, dates and times, 1904 system), sheet choice (one or all), print areas, hidden rows/columns/sheets, formulas shown with their saved results, first-row header option; refuses sheets above the row and column limits instead of truncating.
- PDF parser: reading order, two-column detection, headings, lists, aligned tables, hyperlinks, bold/italic, repeated header and footer removal; scanned, password-protected and damaged PDFs are refused with specific messages.
- Capability matrix with Supported / Approximate / Experimental / Unavailable labels and a "Not available" section (scanned PDF OCR, Excel to Word, PowerPoint, EPUB) with reasons.
- Size-capped, zip-bomb-safe Office unzip; abortable PDF parsing.
- Test corpus (49 files) with references from python-docx, openpyxl, pdftotext and LibreOffice, and measured fidelity criteria; unit, E2E, performance and screenshot tests.

### Changed
- Batch: files that a chosen output can't produce are skipped with a message naming the file type's only output.
- The upload copy and format list mention the new experimental conversions.

### Known limitations
See `docs/PHASE4_REPORT.md`.

## Phase 3: Conversion engine and document fidelity (unreleased)

### Added
- Shared document model extended with underline, text color, alignment (left/center/right/justify), page breaks, embedded images, task lists and document properties.
- PDF: choice of Sans (Roboto), Serif (Liberation Serif) or Mono (Liberation Mono, also used for code), body size 9 to 16 pt, line spacing, header and footer text, page numbers (`1`, `1 / 5`, `Page 1 of 5`), underline and colors, alignment, page breaks, embedded PNG/JPEG images, table styling (borders, zebra, header fill, column sizing, numeric right alignment, text scale), Auto orientation (landscape for tables wider than 7 columns), document information (title, author, subject, keywords).
- DOCX: real Heading 1 to 6 styles with the chosen font, default font and line spacing, header and footer with PAGE/NUMPAGES fields, page breaks, embedded images with alt text, table styling, core properties.
- HTML: sanitized inline styles (color, text-align, bold, italic, underline, strike, page breaks), `<u>`, `<ins>`, `<font color>`, `<center>`, embedded data-URI images, meta tags as properties, and a warning that names every dropped CSS property.
- Markdown: embedded data-URI images, GFM task lists (○ / ●, no bullet), front matter, `<!-- pagebreak -->` and `\newpage`, `<br>`, comment removal, and a "source text" mode.
- CSV: delimiter override, first-row-is-header option, blank-line report, rows of empty cells kept, nothing silently dropped.
- PDF preview viewer on the result screen: page count, previous/next, page-number input, zoom, fit width/page, fullscreen, loading and error states, lazy page rendering with a bounded number of bitmaps. DOCX results show a clearly labeled approximate preview.
- Advanced options (collapsed by default, only options that apply to the loaded file) and persisted defaults on the Settings page.
- Document-complexity warnings (estimated page count, many images). Parsers are loaded on demand.
- Tests: independent readers (pdf.js, python-docx) for layout, fonts, headers/footers, tables, images, properties; parser, sanitization, CSV and Markdown suites; viewer and options E2E tests.

### Fixed
- Preview of the result: a page containing an embedded image could not be drawn in browsers lacking the newest JavaScript built-ins; the viewer now uses the pdf.js legacy build.
- PNGs with alpha, interlacing or 16-bit depth are flattened before PDF embedding (the PDF engine would otherwise need a nested Worker); when no canvas exists the image becomes alt text with a visible check.
- CSV: rows made only of empty cells were previously dropped by the greedy blank-line filter.

### Changed
- Result screen: preview beside the summary on wide screens; on narrow screens the order is summary, download, preview, checks.
- Code blocks and inline code now use a real monospaced font.
- Page numbers default to `1 / N` in DOCX as well as PDF.

### Known limitations
See `docs/PHASE_3_REPORT.md`.

## Phase 2: Batch conversion and merge (unreleased)

### Added
- Multi-file upload (picker and drag-and-drop), adding to an existing queue, per-file removal, confirmed clear, exact-duplicate detection, per-file validation with reasons, reordering by drag or move buttons.
- Sequential batch engine (`src/engine/batch`): start, pause between files, resume, cancel one or all, retry one or all failed, no duplicate jobs, finished outputs kept until removed.
- Batch-wide settings (output, paper, orientation, margins, image quality/placement, suffix) and per-file overrides showing only relevant options; ineligible files are skipped with an explanation.
- Download per file and ZIP export in the browser (fflate), configurable archive name, optional originals folder, unique and sanitized entry names, ZIP failure leaves individual downloads intact.
- Merge images into one PDF: ordered page frames showing placement, per-page orientation, fit or explicit crop, page size, margins, quality, transparency flattened on white.
- Batch limits (10 files / 50 MB balanced; 5 / 25 conservative; automatic reduction on devices reporting 2 GB or less) shown in Settings.
- Screen-reader announcements for queue changes, FLIP reorder animation, enter/leave animations, reduced-motion support.
- `docs/ARCHITECTURE.md`, `docs/PHASE_2_REPORT.md`; unit tests for queue, naming, limits, ZIP, merge and real-engine batches; E2E tests for batch, merge, responsive layout (360 to 1440 px) and accessibility.

### Fixed (Phase 1 defects found by the Phase 2 audit)
- PDF generation was super-linear on long paragraphs: 10,000 unbroken characters took 4.7 s, 30,000 took 45 s, 1 MB hung, a 1 MB single paragraph took 137 s, and a 3 MB log-style file without blank lines took 656 s. Layout units are now kept small (`layout-safe.ts`); the same inputs take about 4 s, 9 s and 24 s with no text lost.
- Output file names now avoid Windows reserved names, trailing dots and leading dots; names are normalized to NFC and length-limited.
- The "start" button no longer shows as a disabled "convert remaining files" after a batch has finished.

### Changed
- The start screen accepts several files. A single file keeps the Phase 1 single-file workspace.
- Output names are made unique across a batch (`name.pdf`, `name (2).pdf`).

### Known limitations
See `docs/PHASE_2_REPORT.md`.

## Phase 1: Single-file converter

- TXT, Markdown, HTML, CSV and images to PDF; TXT, Markdown, HTML, CSV to DOCX.
- Searchable PDF text, editable DOCX structures, honest quality checks, themes, accents, motion settings, Formats/Help/Privacy pages, static export with a strict CSP.
- See `docs/PHASE_1_REPORT.md`.
