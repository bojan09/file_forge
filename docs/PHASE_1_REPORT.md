# Phase 1 report

Status: Phase 1 scope implemented and tested in a headless Chromium environment. Phase 2 (batch conversion) has not been started.

## Existing state

The repository was empty (no commits, no code). Everything here is new. The visual reference was inspected before implementation (see `docs/DESIGN_REFERENCE.md`).

## Implemented vs deferred

| Item | Status |
|---|---|
| TXT to searchable PDF, editable DOCX | Implemented |
| Markdown to searchable PDF, editable DOCX (headings, paragraphs, nested lists, emphasis, links, code, quotes, tables) | Implemented |
| HTML to PDF and DOCX, sanitized subset, labeled approximate with warnings | Implemented |
| JPG/JPEG/PNG/WebP to image PDF with orientation, aspect ratio, quality and fit | Implemented |
| CSV to PDF table and DOCX table, width heuristics, warnings | Implemented |
| Unsupported formats rejected politely | Implemented |
| Home, workspace, progress, result and error screens; Formats, Settings, Help, Privacy/About pages | Implemented |
| Settings: theme (light/dark/system), four accents, motion, default output, page size, orientation, margins, image quality and fit, filename suffix, processing mode, clear preferences | Implemented |
| Web Worker rendering with real cancellation | Implemented |
| Free static deployment configuration (`vercel.json`) | Implemented; **not deployed** |
| Batch UI | Deferred to Phase 2 by design (no controls present) |
| OCR, PDF/DOCX as input, password-protected files | Not in scope |
| Non-Latin/Cyrillic/Greek scripts in PDF | Not supported (replaced by `?`; DOCX keeps them) |

No conversion path was marked experimental; every advertised path passed its tests. HTML and CSV are labeled approximate because layout fidelity is limited by design.

## Test results

Run in this container (Linux, Node 22, Chromium 1194 headless):

| Check | Result |
|---|---|
| `eslint .` | 0 errors, 0 warnings |
| `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) | pass |
| Unit tests (Vitest) | 52 passed, 1 skipped (artifact generator that runs only when `ARTIFACT_DIR` is set) |
| Production build (`next build`, static export) | pass, 7 static routes |
| Browser E2E (Playwright, desktop and mobile projects) | 74 passed, 6 skipped (screenshot generator is opt-in; two desktop-only tests skip on mobile) |

### What the tests cover

Requested coverage and where it is tested:

- **Upload, settings, convert, download:** `convert.spec.ts`, `more.spec.ts` on both projects. Downloads are read from disk and inspected with pdf.js (PDF text, page count and size) and by unzipping DOCX (`document.xml`, numbering, media).
- **Malformed and unsafe HTML:** `html.test.ts`, `convert.spec.ts` with `unsafe.html` (script, event handlers, `javascript:` link, iframe, remote image/stylesheet/video, unclosed tags). Asserts no script ran, no request left the page, and visible text survived.
- **Long text:** 400 paragraphs across more than ten pages with order checked; 600-character unbroken word; 2 MB TXT in the browser; 5 MB TXT to DOCX and PDF at the size limit.
- **Unicode:** Latin, Cyrillic (including Macedonian letters), Greek, accented Latin, euro sign in PDF text extraction and DOCX XML; unsupported-script replacement and refusal.
- **Markdown tables:** multi-page table with repeating header; alignment; DOCX table.
- **Wide CSV:** 24 columns in landscape; 10 columns by 300 rows; widths and header row in DOCX (24 grid columns).
- **Rotated images:** EXIF orientation 6 JPEG yields a portrait page in both High and Small quality. PNG and WebP at every quality; PNG/JPEG passthrough and re-encode paths.
- **Unsupported files and limits:** wrong extension, no extension, empty file, binary file, fake image, mismatched extension, oversized text, oversized image by header (400 MP PNG), CSV row/column limits, HTML complexity limit; exact limit boundaries (5 MB OK, over rejected).
- **Mobile viewport:** whole E2E suite repeated at Pixel 7 emulation; no horizontal overflow on any page.
- **Keyboard navigation:** tab to the upload control, Enter opens the chooser, Space toggles radio tiles; drag-over state and drop.
- **Reduced motion:** OS preference and Settings override measured through computed transition and animation durations.
- **Light, dark and system themes:** attribute and persisted settings tests, axe scans in both themes.
- **Accessibility:** axe-core (WCAG 2 A/AA, 2.1 AA) on home, workspace, raw tab, result and the four information pages in both themes: no violations after fixes.
- **No file content over the network:** request tracking across full flows (Markdown, HTML with remote references, JPEG) asserts zero requests to non-localhost origins, zero non-GET requests, zero request bodies, and no request to a host referenced inside the test HTML.

### Artifact inspection

Beyond promise resolution, sample outputs were rendered and looked at: PDFs were rasterized with `pdftoppm`, DOCX files were converted with LibreOffice and rasterized, and PDF/DOCX pairs were compared side by side for Markdown, HTML and wide CSV. Structure, lists, tables, links and wrapping looked correct in both. This visual check was manual.

### Bugs found and fixed during testing

- PDF tables overflowed the page because pdfmake adds cell padding on top of column widths (24-column CSV lost its last columns). Widths now reserve padding and borders.
- HTML nesting deeper than 60 levels silently dropped text. The limit is now 700 and anything beyond it produces a visible warning.
- Unsafe `href` values stripped by the sanitizer were not reported; they are now counted from the original document.
- Custom CSS overrode Tailwind utilities (desktop showed the mobile menu button); component CSS now lives in cascade layers.
- The result screen could render under the sticky header when the previous screen was scrolled; each screen now starts at the top.
- Scrollable table region on the Formats page was not keyboard-focusable (axe).

## Performance observed

Measured in the container's headless Chromium on desktop-class hardware; treat as indicative only.

| Case | Time | Notes |
|---|---|---|
| 2 MB TXT to PDF | about 8 to 9 s | Cancelable; UI stays responsive |
| 5 MB TXT to PDF | about 19 s | 3,533 pages, 6.8 MB output |
| 5 MB TXT to DOCX | about 4 to 5 s | |

Initial home page JavaScript is about 190 KB gzipped across the three main chunks. The PDF/DOCX engine chunk (about 0.9 MB gzipped, 2.2 MB raw) loads inside the worker when a conversion starts.

## Unverified and known limitations

Not verified (no suitable environment or device):

- Real iOS Safari, real Android Chrome, Firefox and desktop Safari. Only headless Chromium was used, including mobile emulation.
- Whether the provisional size limits are safe on low-memory phones. Large images (up to 25 MP) are decoded to a canvas, which can use around 100 MB; a 5 MB text PDF with thousands of pages may exhaust memory on low-end devices. Limits are provisional as specified and should be tested on target devices. Conservative mode lowers image, CSV and HTML limits.
- Microsoft Word rendering of the DOCX files. They open and render in LibreOffice and have valid OOXML structure; Word was not available.
- Screen reader behavior. Automated axe scans pass; no manual screen reader pass was done.
- Vercel deployment. The configuration is provided but nothing was deployed, so deployment status is "not deployed".
- Pixel-level match to the design reference (see `docs/DESIGN_REFERENCE.md`).

Known limitations:

- PDF font covers Latin, Cyrillic and Greek only; other scripts become `?` or are refused for PDF.
- Code blocks use the proportional PDF font (no bundled monospace face). In DOCX they use Courier New.
- Block quotes in PDF are indented and italic without a vertical rule.
- TXT keeps line breaks but not fixed-width alignment; leading spaces in plain text are not preserved.
- HTML: no CSS, no merged table cells, nested tables flatten to text. CSV: no number or date formatting; rejects files over the row and column limits instead of truncating.
- Cancellation during the input-inspection step stops waiting for the result but cannot interrupt a synchronous parse. If workers are unavailable the render falls back to the main thread, where cancellation is cooperative only.
- The CSP allows `'unsafe-inline'` scripts because the static Next.js export injects inline bootstrap scripts. `connect-src 'self'` still prevents sending data to other origins.
- Preferences are stored in localStorage only; clearing site data resets them.
- Dependency note: PDF image embedding of PNGs uses `fflate`, which spawns an internal worker from a `blob:` URL; the CSP allows `worker-src blob:` for this.

## Deployment status

Not deployed. `vercel.json` and the README describe a free-tier Vercel deployment. No secrets, paid services or environment variables are required.

## Next (Phase 2, awaiting approval)

Batch conversion, results list and zip download are intentionally absent from Phase 1.
