# FileForge

Free, privacy-first, browser-only file converter. Convert TXT, Markdown, HTML, CSV and images to PDF or editable DOCX. Files are processed on the user's device and never uploaded.

Phase 1 is a single-file converter. Batch conversion is deferred to Phase 2. See [`docs/PHASE_1_REPORT.md`](docs/PHASE_1_REPORT.md) for status, test results and known limitations.

## Features

- Convert TXT, Markdown, HTML, CSV and JPG/PNG/WebP to PDF; everything except images also to DOCX
- Real text in PDFs (selectable, searchable) and real Word paragraphs, headings, lists and tables in DOCX
- Preview, page size, orientation, margins, image quality and fit, filename suffix
- Honest quality checks on the result screen and fidelity labels (HTML and CSV are approximate)
- Light, dark and system themes, four accent colors, reduced-motion support, responsive layout with mobile bottom navigation
- No accounts, no payments, no database, no server-side processing

## Requirements

- Node.js 20 or newer (developed on 22), npm 10

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
- [`docs/FORMAT_COMPATIBILITY.md`](docs/FORMAT_COMPATIBILITY.md): supported conversions, limits, behavior details
- [`docs/DESIGN_REFERENCE.md`](docs/DESIGN_REFERENCE.md): adherence to the visual reference and deliberate deviations

## Third-party licenses (runtime dependencies)

pdfmake (MIT), docx (MIT), markdown-it (MIT), DOMPurify (MPL-2.0 OR Apache-2.0), PapaParse (MIT), JSZip (MIT OR GPL-3.0-or-later; used under MIT), Next.js and React (MIT). Roboto font files bundled by pdfmake are Apache-2.0. Transitive dependencies of the production tree are MIT, ISC, BSD, Apache-2.0, 0BSD, BlueOak-1.0.0 or similar permissive licenses.
