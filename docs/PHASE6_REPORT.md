# Phase 6 report: PDF Tools and final release readiness

## Summary
- New PDF Tools workspace (`/pdf-tools/`): merge, split, organize (reorder/rotate/delete/extract), properties, experimental compression. Local only, worker-based, cancellable, offline-capable.
- Release audit: unit 316 passed (2 skipped); e2e 296 passed on desktop and mobile projects (52 gated measurement/screenshot tests skipped by default); lint, typecheck, build clean; `npm audit --omit=dev`: 0 vulnerabilities.

## PDF Tools
| Tool | Behavior | Verification |
|---|---|---|
| Merge | Files in listed order, reorder with arrows (keyboard), ≥ 2 files | Text of every page equals the source pages (poppler `pdftotext`, pdf.js) |
| Organize / extract | Thumbnail grid; keep checkbox, move earlier/later, rotate ±90°; "keep only 1-3, 5, 8-" range input | Order and per-page rotation checked with `pdfinfo`/pdf-lib |
| Split | Ranges (one file each), every N pages, every page; ZIP when > 1 file | 120-page file → 50 + 70; first page of part 2 equals source page 51 |
| Properties | Title/author/subject/keywords, Unicode (Cyrillic) safe, or remove them | Re-read with pdf-lib and poppler; content unchanged |
| Compress (experimental) | Lossless structural repack only; before/after sizes; original returned if not smaller | Never larger; page count and text equal |

Safety and limits: encrypted, damaged and non-PDF files refused per file with specific messages; 60 MB per file, 200 MB and 1,500 pages per operation, 30 files; every output reopened and its page count compared before it is offered; Cancel terminates the worker; the run button is disabled while running; ranges are validated with messages (past the end, backwards, not a number). Engine: pdf-lib 1.17.1 (MIT, pure JS, no network), pdf.js for thumbnails (bounded to one render at a time, lazily drawn).

Known behavior differences: form fields (AcroForm), bookmarks and tag structure are not carried into merged/extracted files (documented in Help and README). Compression does not recompress images, so scans do not shrink.

## Performance (headless Chromium, not real devices)
- Merge 3 × 120 pages → 360 pages, 243 KB: inspect 581 ms, merge 986 ms, 0 main-thread long tasks, JS heap 12 MB.
- Split 120 pages into 120 files: 1.9 s. Organize grid for 120 pages: first thumbnail in 310 ms.
- Page scripts unchanged at ~207 KB over the wire; PDF engine lives in `/workers/pdf-tools.worker.js`, loaded on first use and precached for offline.

## Release audit (all phases)
| Area | Evidence |
|---|---|
| All routes, batch, merge, convert | Existing e2e suites for single, batch, merge, Phase 3/4 workspaces pass on both viewports |
| Versioned corpus + independent parsers | 49-file corpus with python-docx, openpyxl, pdftotext, LibreOffice references (Phase 4 gates), poppler for PDF Tools |
| Theme, settings, offline, privacy | PWA/offline (incl. PDF Tools offline merge), privacy, a11y suites in light and dark |
| Malformed / oversized / rapid / cancel / ZIP failure | Corrupt, truncated, encrypted, bomb and wrong-type corpus files; > 60 MB file refused; disabled run button; cancel during split and conversion; ZIP failure path and individual downloads (batch suite) |
| Low memory | Conservative mode and device-aware limits (Phase 5); size/page limits above; not measured on real low-memory devices |
| Claims check | README, Formats, Help, Privacy re-read: no claim of universal conversion; Experimental labels retained; offline claim limited to app assets |

## Screenshots
`docs/screenshots/*-30-pdf-tools-empty`, `-31-pdf-merge`, `-32-pdf-organize`, `-33-pdf-split-result` (desktop/mobile, dark/light). Compared with `docs/design/FileForge_Design_Reference.png`: same indigo/cyan palette, card/radius/spacing system, choice-card selection style and gradient primary buttons; mobile uses the 5-item bottom bar.

## Final UI/UX and performance audit findings
Fixed during the audit: batch screen not opening after a rejected file; touch targets under 44 px; 404 and badge contrast; page-card controls overflowing on 390 px viewports; page-number input size.
Remaining, prioritized:
1. **High** – Not verified outside Chromium (Safari/iOS PWA install and storage eviction, Firefox) or on real devices; manual pass needed before wide launch.
2. **High** – No screen-reader testing (NVDA, VoiceOver, TalkBack); only automated axe plus keyboard tests.
3. **Medium** – DOCX/XLSX/TXT parsing still on the main thread (≤ ~0.5 s block for a 5 MB TXT at 1× CPU); move to a worker if users report jank.
4. **Medium** – PDF Tools: no drag-to-reorder for pages or files (arrow buttons only); no password removal (by design); no image recompression.
5. **Medium** – Experimental conversions (DOCX/XLSX→PDF, PDF→DOCX) are structural, not layout-exact; scanned PDF OCR, Excel→Word, PowerPoint, EPUB unavailable.
6. **Low** – Offline copy is ~11 MB (fonts and engines); no partial/opt-out beyond Data Saver and "Remove offline copy".
7. **Low** – Service-worker update path tested with a rewritten `sw.js`; a real redeploy has not been exercised.

## Not done / not authorized
Nothing was deployed; Vercel deployment remains the owner's step. Vercel Authentication on the user's project would need to be disabled for a public site.
