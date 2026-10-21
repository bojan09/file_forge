# Changelog

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
