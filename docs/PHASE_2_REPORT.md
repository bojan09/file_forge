# Phase 2 report: batch conversion and merge

## Baseline and audit of Phase 1

Baseline before any change (this container, headless Chromium): lint and TypeScript clean; 52 unit tests passed; 74 E2E tests passed (desktop and mobile projects).

The documentation said Phase 1 was complete, but stress testing found real defects. Measured with the Phase 1 code:

| Input | Phase 1 time | After fix |
|---|---|---|
| 10,000 characters without spaces to PDF | 4.7 s | under 1 s |
| 30,000 characters without spaces | 45.6 s | under 1 s |
| 1 MB without spaces | did not finish in 300 s | about 4.4 to 5.0 s |
| 1 MB single paragraph with spaces | 137 s | about 8.5 to 9.2 s |
| 3 MB log-style file (60,000 lines, no blank lines) | 656 s (1,464 pages) | about 23 to 24 s (1,464 pages) |

Cause: pdfmake's line breaking is super-linear in paragraph length and in runs of characters with no break opportunity. A text file without blank lines, or one very long line, could freeze a conversion for minutes (and a 1 MB unbroken CSV cell ran out of memory). Fix: `src/engine/layout-safe.ts` splits long unbroken runs into adjacent inline pieces and splits very long paragraphs into consecutive ones at a space or newline, with no characters added or removed. The text was verified lossless by extracting it with pdf.js and comparing it to the source, with page numbers removed. Side effect, documented: a line can wrap slightly early at a split point (every ~3,000 characters).

Checked and found fine: very long table cells paginate without losing text (6,000-word cell: all words present across 11 pages); 20,000-item lists and 20,000-line code blocks render in a few seconds.

Other Phase 1 fixes: output filenames now avoid Windows reserved names and stray dots; the finished-batch screen no longer shows a disabled "Convert remaining files" button.

Not re-audited visually against the design image at 360 px until this phase; the Phase 2 responsive tests cover Phase 1 pages too (no horizontal overflow on any page at 360, 390, 768, 1024, 1440 and 844x390 landscape).

## Implemented

| Requirement | Status |
|---|---|
| Multi-file picker, multi-file drop, adding to an existing queue, removing files, clear with confirmation | Implemented |
| Exact-duplicate detection (size, then SHA-256 of contents) | Implemented |
| Individual validation: type, size, empty, binary text, fake or mismatched images, megapixels from header | Implemented |
| Row shows type, name, size, target format, status, eligibility reason | Implemented |
| Reorder by drag and drop and by keyboard-accessible move buttons | Implemented (touch uses the buttons) |
| Sequential queue, start, pause between files, resume | Implemented |
| Cancel the active file (terminates its worker), cancel waiting files, cancel all | Implemented |
| Per-file real status and stage; failures don't block; retry per file or all failed | Implemented |
| Duplicate job prevention; outputs kept until removed; object URLs released | Implemented |
| Shared output, page, image and suffix settings; per-file overrides showing only relevant options | Implemented |
| Ineligible files (images to DOCX) skipped with an explanation | Implemented |
| Merge multiple images into one PDF with ordering, page preview, size, orientation, fit or explicit crop | Implemented |
| Individual download, ZIP of all successes, configurable ZIP name, optional originals, unique names, ZIP failure keeps individual downloads | Implemented |
| UI: queue panel, summary, completed-file details, error and retry controls; desktop two-column, mobile single column | Implemented |
| Animations: enter, leave, FLIP reorder, active-row progress, stage changes, completion, ZIP preparation; reduced motion respected | Implemented |
| Batch limits: 10 files, 50 MB, one at a time, conservative profile, device-memory reduction | Implemented |
| No uploads, no backend, no analytics | Unchanged and tested |

Deferred or not offered: "page matches image size" for merged PDFs (pdfmake sets one page size per document; fit and fill are offered), parallel conversion (by design), touch-drag reordering (buttons instead).

## Verification

| Check | Result |
|---|---|
| `eslint .` | clean |
| `tsc --noEmit` | clean |
| Unit tests | 101 passed, 1 skipped (artifact writer, runs when `ARTIFACT_DIR` is set) |
| Production build | passes |
| Playwright E2E (desktop and mobile projects) | 141 passed, 15 skipped (opt-in screenshot and performance generators; desktop-only drag tests on mobile) |

Phase 1 tests were kept and pass unchanged (the single-file flow still opens for one file).

Coverage requested in the brief and where it lives:

- **Multi-file selection, unsupported formats, duplicates, limits:** `queue.test.ts`, `batch.spec.ts`.
- **Ordering, sequential execution:** unit tests with a fake engine assert at most one active job and list order; E2E installs a MutationObserver and asserts at most one `converting` row at any time and the observed order.
- **Shared and per-file settings:** unit tests on the settings each conversion receives; E2E converts and reads page size and orientation from the downloaded PDFs with pdf.js.
- **Individual failure and retry:** a 60-column CSV (over the column limit) fails alone in the real engine; retry runs again and reports again; ZIP contains only successes.
- **Pause, resume, cancel:** unit tests (including resume while pausing, cancel active then continue, cancel all, clear while converting) and an E2E run with multi-second files.
- **Multiple images to PDF:** page count, page sizes per orientation, order after reordering, forced orientation, margins, name, explicit crop (the embedded image is portrait-shaped), transparent PNG on white at all three qualities (rendered with `pdftoppm`, pixel sampled), no extractable text, honest "not searchable" wording.
- **ZIP integrity and filename collisions:** unzipped with JSZip, Python `zipfile.testzip()` and `unzip -t`; byte equality of contents and originals; traversal, reserved names, case-insensitive collisions; fallback when the async implementation fails; failure path in the browser.
- **Memory cleanup:** thumbnail object URLs are revoked on remove, clear and dispose (unit); the browser test tracks `createObjectURL`/`revokeObjectURL` and shows none are left after clearing. Download URLs are revoked 30 s after the click.
- **Output integrity:** real-engine batch converts mixed files; PDFs are read with pdf.js, DOCX with JSZip and XML checks, quality checks all pass.
- **Responsive and accessibility:** no horizontal overflow at 360x740, 390x844, 768x1024, 1024x768, 1440x900 and 844x390 through the whole batch and merge flows; axe (WCAG 2 A/AA, 2.1 AA) on queue, expanded rows, DOCX note, completed batch, clear confirmation, merge mode, merge workspace and merge result in both themes; primary buttons at least 44 px tall; reduced motion removes row animation; announcements read from a live region.
- **Privacy:** request tracking over batch and merge flows: no external hosts, no non-GET requests, no request bodies.

## Performance and limit measurements

Headless Chromium on the development container (desktop-class). RSS is the sum of all Chromium processes; the baseline is the browser at rest with the page loaded.

| Batch | Result |
|---|---|
| 9 text files of about 5 MB each (45 MB, 9 files), all to PDF | 9 of 9 converted in 171 s (about 19 s each, thousands of pages each); intake took 0.2 s; RSS 842 MB to 1,528 MB; longest main-thread task 304 ms |
| 10 mixed files (4 TXT of 4 MB, 3 CSV of 2.5 MB at about the 20,000-row limit, 3 Markdown of 2 MB; 30 MB), all to PDF | 10 of 10 converted in 316 s; intake 0.26 s; RSS 850 MB to 1,558 MB; longest main-thread task 786 ms |

Conclusions and adjustments:

- The 10-file / 50 MB defaults held without failures. Time scales with document size, not file count: a 5 MB text file is roughly 20 s of layout. At the limits a PDF batch can take 3 to 5 minutes, which is why pause and cancel exist.
- Memory rises by roughly 700 MB above the idle browser at the largest sizes. The queue holds file handles and finished outputs, not inputs, so memory follows the largest single document plus accumulated outputs. That is too much for a 2 GB device, which is why balanced mode drops to the conservative profile (5 files, 25 MB) when `navigator.deviceMemory` is 2 or lower, and warns at 4 GB or lower. This rule is unit-tested, but I could not test on a real low-memory device.
- A first measurement failed 3 CSV files that exceeded the 20,000-row limit; that is by design (rows are never silently truncated) and the limit message is shown. The measurement data was changed, not the limit. Note that a 5 MB CSV is typically over 20,000 rows, so the row limit, not the size limit, is what usually stops large CSVs.
- Main-thread long tasks of 0.3 to 0.9 s occur while parsing large inputs (parsing runs on the main thread; rendering runs in a worker). The UI stays responsive between files, but a single large parse can briefly block input. A parse worker is a candidate for a later phase.
- Limits were not changed from the initial targets because the measurements support them on desktop-class hardware.

## Conversion quality

- PDF and DOCX structure from Phase 1 unchanged; the layout hardening above is the quality fix, with text verified lossless.
- Merged PDFs: one page per image, orientation per page, aspect ratio preserved in "fit", explicit crop only in "fill", EXIF orientation respected, transparency on white.
- Not changed: code blocks still use the proportional font in PDF; block quotes have no vertical rule in PDF; HTML and CSV remain approximate and labelled so.

## Known limitations

- Pause takes effect between files, not mid-file; cancel is immediate for the active file only because its worker can be terminated.
- A single parse can block the main thread for up to about a second on large inputs.
- Very long paragraphs are split for layout, so a line may end early about every 3,000 characters in huge single-paragraph text.
- The ZIP is built in memory (bounded by the 50 MB input limit; outputs can be larger, for example a 5 MB text file becomes a multi-megabyte PDF).
- Intake keeps at most 20 rejected rows visible; more are summarized in a notice.
- Duplicate detection needs `crypto.subtle` (secure contexts); without it, name and modified time are compared.
- Merged PDFs have no "match image size" option.
- Reordering by drag is a desktop pointer feature; touch users use the move buttons.
- Real iOS Safari, Android, Firefox, desktop Safari, Microsoft Word and screen readers were not tested. Automated accessibility checks pass; no manual screen-reader pass.
- Deployment: see the status in the final summary of this phase.

## Files changed

New: `src/engine/batch/*` (types, naming, limits, intake, queue, zip, merge, default-deps), `src/engine/layout-safe.ts`, `src/lib/batch.tsx`, `src/lib/download.ts`, `src/lib/motion.ts`, `src/components/batch/*`, `src/components/ModeSwitch.tsx`, tests (`queue`, `merge-zip`, `batch-integration`, `hardening`, `batch.spec`, `perf.spec`), `docs/ARCHITECTURE.md`, `docs/PHASE_2_REPORT.md`, `CHANGELOG.md`, `tests/fixtures/alpha.png`.

Modified: `src/engine/{convert,render,render-pdf,prep-image,types,coverage}.ts`, `src/components/{UploadZone,HomeView,ConvertApp,Workspace,SettingsForm,icons}.tsx`, `src/app/{layout.tsx,globals.css}`, `scripts/make-fixtures.mjs`, `README.md`, `docs/{FORMAT_COMPATIBILITY,DESIGN_REFERENCE}.md`, `package.json` (fflate).
