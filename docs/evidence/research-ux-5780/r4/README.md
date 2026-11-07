# Research UX R4 — responsive long content and keyboard

Distinct final journey: authenticated history search and keyboard resume → saved synthetic long report → PDF/Word focus traversal (no export) → keyboard plan navigation/edit/unchanged Enter → report return and normal reload. All at375/768/1280, withover5,000 synthetic body characters and legal190-character unbroken ASCII headings. No production task, supplier/model success or generated-file claim.

Initial actual report width375 expanded to2482. Report article wrapping fixed page overflow; continuing the actual route found plan title controls with clientWidth227/scrollWidth1398, clipping text even while the page width was375. Minimal fix is only break-words on the existing article/plan title controls (and min-w-0 on the article), with full text retained and no event/field/API change.

Final actual focused case:1 passed,43.1s test invocation/44s standard stack+cleanup. final/r4-metrics.json records9 states: each report/plan scrollWidth equals375/768/1280, each plan control scrollWidth equals its own available width, and footer covered=[] relative to the fixed assistant. Keyboard PDF→Tab→Word, navigation Enter, initial edit focus and unchanged Enter all pass. Report objects and version2 survive reload unchanged; model/agent counts remain0 and forbidden command list is empty. final/ holds list/top/footer/plan screenshots at each width.

Intermediate failures remain separate: initial overflow is in the root metrics/image; after-report-wrap captures the still-clipped plan. A test-only step ID assumption was corrected to the actual accessible navigation buttons. One run failed before launching because the shared browser binary was temporarily absent; official matching installation completed and its executable was verified before the final run. None of those attempts are reported as complete passes. No repeated production build or lock/source-edit barrier was used.

Related editor/reference UI tests, TypeScript and focused lint pass. Reproduction uses playwright.research-ux.config.ts through the existing with-test-isolation wrapper, --grep=R4, WX_RESEARCH_UX_R4_EVIDENCE=<absolute output>. This is real routes/login/API/PG with dev compilation, not deployed production evidence.

## Main delivery and shared verification

This PR's product diff is only the two wrapping classes. The shared spec/config is owned here once. Its default filter is R4, so an independent R4 head does not claim the pending R1/R2/R3 fixes. Explicit --grep=R2/R3 selects those cases only when the corresponding product delta is present. WX_RESEARCH_UX_ALL=1 selects the complete integration suite; WX_RESEARCH_UX_PRODUCTION=1 reuses the standard fresh production build/start servers. Full-suite receipts must identify the assembled source commits and must not be attributed to an independent single-round head.
