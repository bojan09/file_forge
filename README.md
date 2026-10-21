# FileForge

Free, privacy-first, browser-only file converter. Convert TXT, Markdown, HTML, CSV and images to PDF or editable DOCX. Files are processed on the user's device and never uploaded.

Phase 2 adds batch conversion (queue, pause/resume/cancel/retry, shared and per-file settings, ZIP download) and a merge-images-into-one-PDF workflow on top of the Phase 1 single-file converter. See [`docs/PHASE_1_REPORT.md`](docs/PHASE_1_REPORT.md) and [`docs/PHASE_2_REPORT.md`](docs/PHASE_2_REPORT.md) for status, test results and known limitations, and [`CHANGELOG.md`](CHANGELOG.md) for what changed.

## Features

**Batch (Phase 2)**
- Select or drop several files; add more later; remove, reorder (drag or move buttons), clear with confirmation
- Each file is validated on its own; unsupported files get a clear reason and never block the rest
- Exact-duplicate detection, default limits of 10 files and 50 MB combined (lower in conservative mode or on low-memory devices)
- Strictly sequential conversion with start, pause between files, resume, cancel one file or all, retry failed files
- Batch-wide output (PDF or DOCX), page settings, image settings and filename suffix, plus per-file overrides that only show options valid for that file
- Files that can't produce the selected format (images to DOCX) are skipped with an explanation, not failed
- Download each result, or all as a ZIP built in the browser (custom name, optional originals, unique names)
- Merge several JPG/PNG/WebP images into one PDF: ordered pages, page preview, page size, orientation, fit or (explicit) crop, quality

**Single file (Phase 1)**

- Convert TXT, Markdown, HTML, CSV and JPG/PNG/WebP to PDF; everything except images also to DOCX
- Real text in PDFs (selectable, searchable) and real Word paragraphs, headings, lists and tables in DOCX
- Preview, page size, orientation, margins, image quality and fit, filename suffix
- Honest quality checks on the result screen and fidelity labels (HTML and CSV are approximate)
- Light, dark and system themes, four accent colors, reduced-motion support, responsive layout with mobile bottom navigation
- No accounts, no payments, no database, no server-side processing

## Requirements

- Node.js 20 or newer (developed on 22), npm 10

## Using batch and merge

1. On the start screen, select or drop **two or more files** to open the batch workspace. (One file opens the single-file workspace; "Add more files (batch)" there moves it into a batch.)
2. Choose the batch output and page settings on the right; open **Settings**/**Details** on a file for its own overrides.
3. **Start conversion**. Pause happens after the current file. Cancel stops the active file; finished outputs are kept.
4. Download files one by one or **Download all as ZIP**.

For images, choose **Merge images into one PDF** above the drop zone, add images, reorder pages, pick placement and create the PDF.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

## Build and serve the static site

```bash
npm run build        # static export to ./out
npm start            # serves ./out on http://localhost:3000
```

## Checks

```bash
npm run lint
npm run typecheck
npm test             # unit tests (Vitest)
npm run check        # lint + typecheck + unit tests + build
```

End-to-end tests use Playwright against the static build:

```bash
npm run build
npx playwright test                       # desktop + mobile projects
PW_CHROMIUM_PATH=/path/to/chrome npx playwright test   # use an already-installed Chromium
SCREENSHOTS=1 npx playwright test screenshots          # regenerate docs/screenshots
```

Performance measurements (used for `docs/PHASE_2_REPORT.md`; slow, run on demand):

```bash
PERF=1 npx playwright test perf --project=desktop            # both batches near the limits
PERF=1 PERF_KIND=mixed npx playwright test perf --project=desktop
ARTIFACT_DIR=/some/dir npx vitest run tests/unit/zz-artifacts.test.ts   # write sample PDF/DOCX for manual inspection
```

Test fixtures are in `tests/fixtures`. Binary fixtures (images) are produced by `node scripts/make-fixtures.mjs`.

## Architecture

```
File -> validate (extension, size, magic bytes, header dimensions)
     -> parse    (txt | markdown-it | DOMParser+DOMPurify | PapaParse)  -> NormalizedDoc
     -> render   (pdfmake PDF | docx DOCX | image PDF)  in a Web Worker
     -> verify   (PDF structure, fonts/images; DOCX zip + XML checks)
     -> Blob URL download
```

| Path | Purpose |
|---|---|
| `src/engine/registry.ts` | Compatibility registry: formats, limits, fidelity labels |
| `src/engine/validate.ts` | File validation, image header parsing, text decoding |
| `src/engine/parsers/*` | Source parsers producing the normalized document model |
| `src/engine/render-pdf.ts`, `render-docx.ts` | Renderers |
| `src/engine/verify.ts` | Output verification |
| `src/engine/convert.worker.ts`, `worker-client.ts` | Worker execution and cancellation |
| `src/engine/layout-safe.ts` | Keeps PDF layout linear for huge paragraphs / unbroken text |
| `src/engine/batch/*` | Queue, intake validation, duplicate detection, naming, limits, ZIP, merge |
| `src/lib/converter.tsx` | UI state machine (idle, inspecting, ready, converting, done, error) |
| `src/lib/settings.ts` | Persisted non-sensitive preferences |
| `src/components`, `src/app` | UI and pages |

Conversion code is client-only. The app is a static export: there are no API routes or server actions, so file bytes have no server path.

## Deploy (free tier)

The output in `out/` is plain static files. Any static host works. For Vercel's free (Hobby) tier:

1. Import the repository in Vercel. The framework preset is Next.js; no environment variables are needed.
2. Deploy. `vercel.json` adds a strict Content-Security-Policy (`connect-src 'self'`), other security headers, and immutable caching for hashed assets.

Free-tier limits to be aware of: Vercel Hobby has monthly bandwidth and build-minute quotas (see Vercel's current pricing page). The largest asset is a lazily loaded worker chunk of about 0.9 MB gzipped (2.2 MB raw) containing the PDF and DOCX engines and fonts. It downloads only when the first conversion starts. Conversion itself uses the visitor's CPU and memory, so hosting cost does not scale with file size.

Deployment is not performed by this repository's tooling; nothing in the project requires paid infrastructure.

## Documentation

- [`docs/PHASE_1_REPORT.md`](docs/PHASE_1_REPORT.md): implemented vs deferred, test results, limitations
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): layers, batch engine, how to add a format
- [`docs/PHASE_2_REPORT.md`](docs/PHASE_2_REPORT.md): batch and merge: status, tests, measurements, limitations
- [`docs/FORMAT_COMPATIBILITY.md`](docs/FORMAT_COMPATIBILITY.md): supported conversions, limits, behavior details
- [`docs/DESIGN_REFERENCE.md`](docs/DESIGN_REFERENCE.md): adherence to the visual reference and deliberate deviations

## Third-party licenses (runtime dependencies)

pdfmake (MIT), docx (MIT), markdown-it (MIT), DOMPurify (MPL-2.0 OR Apache-2.0), PapaParse (MIT), JSZip (MIT OR GPL-3.0-or-later; used under MIT; verification only), fflate (MIT; ZIP export), Next.js and React (MIT). Roboto font files bundled by pdfmake are Apache-2.0. Transitive dependencies of the production tree are MIT, ISC, BSD, Apache-2.0, 0BSD, BlueOak-1.0.0 or similar permissive licenses.
