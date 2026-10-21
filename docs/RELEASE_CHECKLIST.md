# Release-readiness checklist

Automated (run before every release)
- [x] `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (316 passed, 2 skipped)
- [x] `npm run build` (static export, worker bundles, `sw.js` generated)
- [x] `npx playwright test` desktop + mobile (296 passed; `PERF=1`/`SCREENSHOTS=1` suites gated)
- [x] `npm audit --omit=dev`: 0 vulnerabilities
- [x] Network audit: no request to another origin (privacy suite, hostile HTML/MD/CSV, service worker)
- [x] axe WCAG 2 A/AA clean on every route and state, light and dark

Manual (owner, after deploy)
- [ ] Open the deployed URL logged out (disable Vercel Authentication if enabled) and convert one file of each type
- [ ] Response headers: CSP, `Cache-Control: no-cache` on `/sw.js`, manifest content type
- [ ] Install as PWA on Android Chrome and iOS Safari (Add to Home Screen); toggle airplane mode and convert
- [ ] Safari and Firefox smoke test of convert, preview, batch ZIP, PDF Tools
- [ ] Screen-reader pass (VoiceOver and NVDA) on home, workspace, batch, PDF Tools
- [ ] Redeploy once and confirm the update banner appears and applies when idle
- [ ] Low-memory phone: 20 MB PDF to Word and a 10-file batch

Docs
- [x] README, CHANGELOG, `docs/PHASE{4,5,6}_REPORT.md`, `docs/FORMAT_COMPATIBILITY.md`, Help and Privacy pages current
