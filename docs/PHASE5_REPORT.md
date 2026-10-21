# Phase 5 report: offline PWA, performance, accessibility, production hardening

## Summary
- Installable, offline-capable PWA; app assets only, versioned, update is opt-in and never mid-conversion.
- Initial page JS 990 KB → 207 KB over the wire (engine moved to a separately built worker).
- axe (WCAG 2.0/2.1 A/AA) clean on every screen/state, both themes, desktop and mobile; touch targets ≥ 44 px on coarse pointers.
- Privacy: hostile HTML/Markdown/CSV trigger no foreign requests; no file names/contents in console or storage; object URLs released; `npm audit --omit=dev`: 0 vulnerabilities.

## PWA
| Item | Implementation |
|---|---|
| Manifest | `public/manifest.webmanifest`: id `/`, standalone, 192/512/maskable/SVG icons, Settings and Formats shortcuts |
| Service worker | `scripts/sw.template.js` → `out/sw.js` at build; cache name = content hash; precache list = every built asset; cache-first for precached URLs only; everything else network-only and never stored |
| Update | waiting worker → banner "Update available"; applied only on click and only when no conversion is running (`src/lib/activity.ts`); old `fileforge-app-*` caches deleted on activate; first visit never reloads the page |
| Offline disclosure | Settings card: state, size, what is/isn't cached, install instructions, "Remove offline copy" (unregisters and deletes cache) |
| Constraints | Data Saver skips caching and says why; unsupported browsers say so |

## Performance (headless Chromium, localhost static server; not real devices)
| Metric | CPU ×1 | CPU ×4 |
|---|---|---|
| Script+CSS over wire (home) | 207 KB | 207 KB |
| FCP / LCP | 140 ms | 264 ms |
| Long tasks / total blocking | 0 / 0 ms | 1 / 133 ms |
| Upload zone ready | 805 ms | 1435 ms |

Main-thread long tasks during conversion (×1): 5 MB TXT 2 tasks (longest 532 ms, text decode/parse), DOCX 71 pages longest 129 ms, XLSX 162 pages 87 ms, PDF 120 pages 0, small PDF 82 ms. Rendering runs in a worker and aborts by termination; parsing of DOCX/XLSX/TXT still runs on the main thread (documented limitation; PDF parsing uses the pdf.js worker). JS heap during Phase 4 pathways: 18–35 MB.

## Accessibility
- Automated: axe over home, merge mode, workspaces, errors, results, batch, merge, Formats/Settings/Help/Privacy/404, light and dark (`tests/e2e/a11y.spec.ts`).
- Keyboard: modals/confirmations trap and restore focus; Escape cancels confirmations; drag-and-drop always has a click/keyboard alternative.
- Reduced motion, 200% zoom reflow, forced-colors, coarse-pointer target size covered by tests.
- Fixed: 404 page contrast, undersized touch targets (segmented controls, summary, footer links, page input).
- Not verified: real screen readers (NVDA/VoiceOver/TalkBack).

## Privacy and security
- CSP via `vercel.json` + meta fallback (`connect-src 'self'`), `_headers` for other static hosts.
- Network audit tests: no request leaves the origin, including for hostile files and service-worker traffic.
- Offline cache contains only listed app URLs: no blob/data URLs, no user content (tested).
- Fixed: files chosen after a rejected file are no longer dropped (batch screen); ZIP object URL is revoked 30 s after download.

## Tests
Unit 299 passed (2 skipped); e2e full run on desktop and mobile: all passed after fixes (PWA 2 projects, a11y, privacy, perf measurement suites gated by `PERF=1`); lint, typecheck, build clean.

## Screenshots
`docs/screenshots/*-20-home-final`, `-21-settings-offline`, `-22-batch-queue` (desktop/mobile, dark/light). Compared against the design reference: indigo/cyan gradient, card hierarchy, format list and trust cards match; mobile uses bottom navigation.

## Known limitations
- Verified in Chromium only; Safari/Firefox PWA behavior, real devices and screen readers unverified.
- DOCX/XLSX/TXT parsing on main thread (≤ ~0.5 s block on a 5 MB TXT at ×1).
- Browsers without Web Workers cannot convert (explicit message).
- Offline copy is ~10 MB (fonts + engines).
