# Design reference adherence

Reference: [`docs/design/FileForge_Design_Reference.png`](design/FileForge_Design_Reference.png) (seven screens plus a design-system panel).

Screenshots of the implementation, captured by `tests/e2e/screenshots.spec.ts` in headless Chromium (desktop 1440x900, mobile Pixel 7 emulation), are in [`docs/screenshots`](screenshots). Files are named `<project>-<theme>-<screen>.png`. Full-page captures show the fixed mobile bottom navigation partway down the page; that is a capture artifact, not the layout.

## Screen by screen

| Reference screen | Implementation | Screenshot | Fidelity |
|---|---|---|---|
| 1. Home / Upload (dark) | Header with logo, Convert/Formats/Settings/Help tabs, theme toggle. Hero badge, headline with gradient "privately.", copy, dashed drag-and-drop zone. Right panel with document illustration and five clickable format rows. Three assurance cards. | `desktop-dark-1-home.png` | High. Same structure, hierarchy and proportions. |
| 2. Conversion workspace (dark) | New File, file card with Change File, Preview / Raw Content tabs with a white "paper" preview, Conversion Settings card (output tiles, page size, orientation, margins), gradient Convert button, local-processing note. A notices card was added. | `desktop-dark-2-workspace.png` | High. |
| 3. Completed result (dark) | Animated check with sparks, "Conversion Complete!", file card with status badge, Download File, Convert Another File, Quality Check list. | `desktop-dark-3-result.png` | High. |
| 4. Home / Upload (light) | Same layout with light tokens. | `desktop-light-1-home.png` | High. |
| 5. Mobile upload | Compact header with menu button, stacked hero, "Tap to select a file" zone, format list, bottom navigation. | `mobile-dark-1-home.png` | High. |
| 6. Mobile conversion | Single-column workspace: file card, preview, settings, full-width Convert button. The reference shows a CSV preview; a CSV loads the same layout with a table preview. | `mobile-dark-2-workspace.png` | High. |
| 7. Mobile result | Single-column result screen. | `mobile-dark-3-result.png`, `mobile-light-3-result.png` | High. |
| Design system panel | Tokens in `src/app/globals.css`: primary indigo, accent cyan, success emerald, warning amber, danger red, surface gray. Primary, secondary and ghost buttons; default and active cards; inputs and selects; file type icons; status badges. | n/a | Colors and components follow the panel. |

## Deliberate deviations

1. **Privacy wording.** The reference says "100% Private" and "Fast & Reliable / Conversion in seconds". The spec forbids unsupported absolute claims, so the badge reads "Processed on your device · files never uploaded", the first assurance is "Private by design / No uploads, no accounts", the second is "Fast, no upload wait / Runs on your device", and the third is "Any modern browser". Conversion time depends on file size and device (a 5 MB text file produced a 3,500-page PDF in about 20 seconds in the test container).
2. **Button gradient depth.** The reference's light cyan end of the primary gradient gives white text roughly 2:1 contrast. Gradient ends are darkened (for example `#4f46e5` to `#0b7fa6`) so button text meets WCAG AA. The hue progression is preserved.
3. **Fonts.** The reference uses an Inter-like face. The app uses the system UI font stack, so no font files are downloaded from third parties. This keeps the page free of external requests.
4. **Accent colors.** Four accents are selectable in Settings (indigo, cyan, emerald, violet) as required by the spec. Indigo is the default, matching the reference.
5. **Theme toggle.** The header toggle switches light and dark. "System" is available in Settings.
6. **Progress.** The reference shows a four-step progress strip. The implementation shows only stages that truly occur (Reading file, Building document, Verifying output) with an indeterminate bar. No percentage is displayed because none can be measured.
7. **Result badge.** The reference badge says "Verified". The implementation says "Checks passed" because the checks inspect structure, not appearance, and switches to "Review notes" when any check or warning needs attention.
8. **Quality Check items.** The reference lists three generic items. The implementation lists the checks that actually ran for that output (see `docs/FORMAT_COMPATIBILITY.md`).
9. **Added elements.** A notices card (warnings and approximate-fidelity messages), "Change settings and convert again" on the result screen, an error screen with retry, an inspecting screen, and a Cancel button during conversion. The reference has none of these states.
10. **Logo.** An original layered-document mark with a transform arrow and a check badge, using the active accent gradient. It is not copied from the reference artwork.
11. **Illustration.** The hero illustration is an original SVG with the same composition (large document, arrow, PDF and DOCX cards), not a trace of the reference image.
12. **Raw Content tab.** Shown for text formats only. The reference's close icon on that tab is omitted. Images show Preview only.

## Interaction and motion

- Hover and focus feedback on buttons, tiles, inputs and rows; visible focus rings.
- Drag-over state: scale, glow, pulsing ring, bobbing icon.
- Screen transitions: fade and rise. Result: check circle and mark draw in, sparks fade up.
- Reduced motion: honored through the Settings "Motion" option (System, Full, Reduced) and the OS preference when set to System. Verified by computed-style tests.

## Not verified

- No pixel-diff against the reference was run. Fidelity ratings above are visual comparisons by the author of this work.
- Real iOS Safari and physical Android devices were not available. Mobile screens use Chromium with the Pixel 7 profile.
