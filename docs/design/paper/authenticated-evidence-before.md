# Authenticated PAPER evidence — before correction

Source: `932888cc17da45299699c997f0dc8624ad910c04`.
Run: https://github.com/boardx/workspacex/actions/runs/37154037715
Artifact: `phase-01-chat-read-evidence-37154037715`, ID `11285637388`.

All 12 PNG/JSON pairs were downloaded and inspected. Every receipt matches the source SHA, run ID, light/dark state and PNG dimensions: desktop 1024×600, mobile 375×812. The selected original reference and actual light desktop screenshots were viewed together. This is actual authenticated product UI against isolated API/database, with a deterministic upstream; it does not establish professional model quality.

| Surface | Pixel review |
| --- | --- |
| Home, four captures | Warm surfaces, rose active navigation and readable controls. Existing configured hero reverses appropriately with the theme; preserve organization configuration rather than replacing it with the concept's example sections. Unavailable shortcuts retain their disabled treatments. Narrow layout has no horizontal overflow. |
| Chat empty, four captures | **FAIL:** default bottom following plus excess empty-state height clips the opening title and first template in both viewports. Partial visibility assertions passed, showing why test success alone was insufficient. |
| Chinese long thread, four captures | Text remains readable with the real composer and controls reachable. Last reply sits above the composer, without a blank overscroll tail. Original 1848px settled/runtime geometry tests also passed. |

Correction keeps every template, label, handler and focus ring, reduces only empty-state spacing and uses two columns. It adds full bounding-box assertions for the headline and all four templates on every empty-state capture. Message scrolling hooks and business behavior are untouched. New-source screenshots remain required; these images are explicitly **before**, never acceptance of the correction.

Actual test results: Chat 120 passed / 5 existing skipped / 4 failed. Failures: clarification PDF inline artifact absent; default enabled skill snapshot empty; D4 skill catalog absent from model prompt; enabled skill body absent from model input. No failing assertion or lane was weakened. Their runtime root causes require Chat owner investigation; visual source changes alone do not establish their cause.

Fullstack browser 146 passed / 1 existing skipped; trace geometry 7 passed. Self-service-profile passed. Full-regression browser 146 passed / 1 existing skipped, but base lane failed secret scanning on `apps/web/scripts/run-board-native-acceptance.test.mjs`, unchanged from this branch's base. Do not change the baseline to manufacture a green result.

The post-correction source must be frozen once after lightweight checks and independent review. Existing `harness-verify` has no Chat-only dispatch input: `run_e2e_full=true` is required for chat-read and also schedules full-regression, fullstack and profile. A necessary second run should use same-SHA dedup (`fresh_run=false`), first checking for an already eligible run. No production deployment or local DB/Docker is part of this verification.
