# Phase 3 report: conversion engine and document fidelity

## Baseline and audit

Starting point (Phase 2 commit `b4d222e`): lint and typecheck clean, 190 unit tests, 72 desktop + 81 mobile E2E checks passing. The audit looked for regressions and gaps against the Phase 3 brief before changing anything:

| Finding | Action |
|---|---|
| Code blocks and inline code were set in the proportional sans font | Real monospaced font (Liberation Mono) |
| DOCX had no header/footer, page numbers, page breaks, images or document properties; headings carried per-run sizes instead of styles | Implemented; headings now use real Heading 1 to 6 styles |
| PDF alignment, colors, underline, images, page breaks, header text did not exist | Implemented |
| CSV greedy blank-line filter silently dropped rows made only of empty cells (e.g. `,,,`) | Fixed; blank lines are skipped **and counted** in a note |
| HTML `style` attributes were stripped silently | Supported subset applied; every dropped property is named in a warning |
| Result screen had no preview of the generated file | pdf.js viewer; labeled approximate preview for DOCX |

## Implemented vs deferred

| Requirement | Status |
|---|---|
| PDF: underline, colors, alignment (incl. justify), header/footer text, page numbers (3 formats), font family, size, line spacing, table styling, images, page breaks; text stays selectable | Implemented, verified with pdf.js (positions, fills, fonts, operators) |
| DOCX: editable structures, fonts, alignment, spacing, heading styles, header/footer with page-number fields, page breaks, embedded images (alt text), table styling, core properties | Implemented, verified with python-docx and XML checks; rendered through LibreOffice |
| Shared normalized model (runs, images, links, page breaks, properties) | Implemented (`types.ts`) |
| HTML subset: inline styles, colors, alignment, safe images, dropped-CSS warnings, sanitization | Implemented |
| Markdown: images, no syntax leakage, task lists, front matter, page breaks, source mode on request | Implemented |
| CSV: delimiter override, header behavior, alignment, zebra, font scale, column sizing, orientation (Auto), never drops rows or columns | Implemented |
| Preview: multi-page PDF viewer (nav, zoom, fit width/page, count, loading/error, fullscreen); labeled approximate DOCX preview; preview before download | Implemented |
| Quality settings per engine, only supported options shown, persisted, progressive disclosure | Implemented (collapsed "Advanced options"; Settings page defaults) |
| Performance: workers, lazy loading, no re-parsing, URL cleanup, complexity warnings, measured | Partly: see below |
| Privacy/security unchanged | Verified by E2E network assertions |
| Tests, docs | Done |
| Parsing in a worker | **Deferred**: HTML needs `DOMParser`, which workers lack; Markdown/CSV parse in 75 to 200 ms for large inputs, so a worker would add complexity for no measurable gain. Rendering stays in the worker. |
| Justified/centered/colored text from Markdown | N/A (Markdown has no syntax for it) |
| Block-quote left bar in PDF | Not done: a bordered table row cannot split across pages. Quotes are indented gray italic. |
| Embedding WebP/SVG images inside documents | Not done (WebP could be transcoded; deferred). Reported as a warning. |
| Exact Word layout parity | Not claimed: DOCX preview is approximate and says so |

## Changed files (main)

`src/engine`: `types.ts`, `style.ts` (new), `fonts.ts` (new), `doc-images.ts` (new), `render-pdf.ts`, `render-docx.ts`, `render.ts`, `verify.ts`, `coverage.ts`, `font-coverage.ts` (per family), `layout-safe.ts`, `page.ts`, `prep-image.ts`, `convert.ts`, `parsers/{common,html,markdown,csv}.ts`, `batch/{queue,default-deps}.ts`.
`src/components`: `AdvancedOptions.tsx`, `PdfViewer.tsx` (new), `ResultView.tsx`, `DocPreview.tsx`, `SettingsPanel.tsx`, `SettingsForm.tsx`, `PreviewPanel.tsx`, `icons.tsx`. `src/lib`: `settings.ts`, `converter.tsx`, `batch.tsx`.
`public/fonts/*` (Liberation, SIL OFL 1.1), `scripts/{gen-font-coverage,copy-pdfjs-worker}.mjs`, `package.json` (pdfjs-dist is now a runtime dependency).
Tests: `tests/unit/phase3-{render,parsers,integration,perf}.test.ts`, `tests/unit/setup.ts`, `tests/e2e/phase3.spec.ts`, new fixtures (`opaque.png`, `rgba.png`, `interlaced.png`).

## Test results

| Command | Result |
|---|---|
| `npx eslint .` | clean |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 198 passed, 2 skipped (artifact export and perf gates) |
| `npm run build` | passes; static export |
| `npx playwright test` (desktop + mobile) | 167 passed, 19 skipped (screenshot and perf gates), 0 failed |

New unit coverage: long-document pagination with header/footer on every page and consistent page counts; selectable text per font family; font size and line spacing measured from text positions; underline and colors via operator lists and fill colors; centered, right and justified x-positions; page numbers (3 styles/none); page breaks incl. trailing; document information; page sizes, orientations, margins; Auto orientation; long tables (400 rows, header repeats, no row lost); zebra/header fill/borders/numeric alignment/column sizing; 30-column table keeps every column; PNG/JPEG images; DOCX read back with **python-docx** (heading styles, run formatting, alignment, hyperlink, header/footer fields, page setup, core properties, page break, image + alt text, numbering, table shading, 301-row table); HTML styles, inheritance, dropped-CSS warnings, near-white colors, page breaks, CSS payload neutralization, table alignment, image embedding and every rejection path (remote, relative, SVG, WebP, truncated, wrong bytes, oversize); Markdown images, task lists, front matter, page breaks, `<br>`, hostile input; CSV delimiters, quoted fields with embedded delimiters/quotes/newlines, header modes, 5,000 rows x 40 columns, Unicode, ragged rows; re-parse without re-reading; style/parse options through the batch queue and ZIP; settings sanitization; complexity warnings.

E2E (desktop and mobile): viewer navigation, page-number input incl. out-of-range, zoom, fit width/page, fullscreen, bounded canvas count, error state when the viewer engine is blocked (download still works), keyboard focus order, axe (wcag2a/aa, 21aa), no overflow, pixel check that an embedded image is visible in the preview, DOCX approximate-preview label, option visibility per source type, CSV re-parse, font/header/footer to PDF and DOCX, persisted defaults, Markdown source mode, styled HTML end to end, and no external requests or request bodies.

A bug found by these checks, fixed: the viewer crashed on pages with images in a browser without `Map.getOrInsertComputed` (the Chromium used here); it now uses the pdf.js legacy build.

## Measurements (this container, Node main thread; the browser worker adds no measurable overhead)

| Case | Time |
|---|---|
| Parse 750 KB Markdown (2,000 sections) | about 0.2 s |
| Render that to PDF, 462 pages (sans / serif cold / serif warm) | 3.3 s / 3.3 s / 3.2 s (font load is a few ms from disk; in a browser it is one same-origin request of about 1.4 MB for serif, cached) |
| Same to DOCX | 0.65 s |
| Parse CSV, 20,000 rows | 75 ms; re-parse after an option change: 18 ms |
| CSV 20,000 rows to PDF (646 pages) | 8.5 s |
| CSV 20,000 rows to DOCX | 9.5 s |
| HTML with 40 images: parse / PDF / DOCX | 0.4 s / 0.26 s / 0.08 s |
| Browser E2E: 2 MB TXT to PDF in the worker | about 7.6 to 8.0 s (unchanged from Phase 2); 5 MB TXT to DOCX about 3 to 3.6 s |

Main-thread responsiveness: rendering is in the worker; parsing on the main thread is under 0.5 s for every case above. Object URLs: the result URL is revoked on reset and re-conversion; preview images use object URLs revoked on unmount; the PDF viewer uses canvases only. Viewer memory: at most about 10 page bitmaps are held regardless of document length (E2E asserts this on a 60-section document).

Initial JS: the PDF/DOCX engines and the pdf.js viewer are lazy chunks; fonts beyond Roboto are fetched only on use.

## Privacy and security

- No new network destinations. The only new requests are same-origin static files: `/fonts/*.ttf` and `/vendor/pdf.worker.min.mjs`. E2E asserts no external requests, no non-GET requests and no request bodies while the viewer renders.
- CSP unchanged (`worker-src 'self' blob:` already covers the pdf.js worker; `connect-src 'self'` covers the font fetch).
- HTML: DOMPurify still sanitizes; `style` is now allowed through sanitization but only a fixed list of properties is read, values are validated (colors parsed to `#rrggbb`), and no CSS is ever emitted. A test checks `url()`, `expression()`, `behavior` and event handlers never reach the model.
- Images from files: data-URIs only, bytes sniffed, PNG chunk structure checked, size/count/megapixel budgets enforced; nothing is fetched.

## Accessibility and responsive

Viewer controls are real buttons with names, `aria-pressed` states, a labeled page input, a keyboard-focusable scroll region with instructions, a polite page announcement, and axe-clean in light and dark. Advanced options use a native `<details>` disclosure, labeled controls, and 44 px targets on touch. Result and workspace pages have no horizontal overflow on desktop and mobile projects. Screenshots at `docs/screenshots/*-9-advanced-options.png` to `*-12-csv-options.png` and `*-3-result.png`.

## Design comparison

The new screens keep the indigo/cyan system, card shapes, segmented choices, and the result screen's check-mark header and button stack from the reference image. Deliberate additions: a two-column result screen with the preview on the left (the reference result screen has no preview), and a collapsed "Advanced options" section under Page Settings. On narrow screens the order is summary and download first, then preview, then checks.

## Known limitations

- Not verified: real iOS/Android devices, Word itself (LibreOffice and python-docx were used), screen readers, Firefox and Safari. The pdf.js legacy build and a CSS fullscreen fallback were chosen for older browsers but were only exercised in the Chromium build available here.
- The preview viewer does not offer a text layer (selection inside the preview); the downloaded PDF is selectable and searchable.
- Liberation fonts cover Latin, Greek and Cyrillic (incl. Macedonian); CJK, Arabic and Hebrew still need DOCX. Checkbox glyphs are not in any bundled font, hence ●/○ for tasks.
- DOCX font names are not embedded; Word substitutes when Calibri, Times New Roman or Courier New is missing.
- The batch queue takes its style defaults when the page loads; changing defaults on the Settings page applies to new single-file conversions immediately and to batches after a reload.
- Table rows are never split across PDF pages; a single cell taller than a page is clipped by pdfmake. Very large cells remain subject to the layout-safe chunking from Phase 2.
- HTML images inside headings, table cells or inline text remain placeholders.

## Git

Committed on the working branch and pushed to `master` only (`git push origin HEAD:refs/heads/master`). No pull request, no merge, and no deployment was performed from this session: deployment is handled by the project owner.
