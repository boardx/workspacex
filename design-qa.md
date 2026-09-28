# Interview prototype acceptance

final result: blocked

## Source visual truth

The eight user-provided grayscale screenshots, beginning with `/var/folders/l8/7z3_dshd7799phy86_sry5k40000gn/T/codex-clipboard-f966283d-98d3-41b1-acde-25c756e7eb02.png`, define the list, intake, analysis, experts, virtual-expert modal, questions, execution and report states. Fixed SVG avatars are an explicitly requested deviation from photographic reference avatars.

## Browser evidence limits

- Implementation: local branch `codex/interview-prototype-completion`, PR #4486.
- Native browser without a seeded session opened `http://localhost:3000/itv/new` and redirected to `/login?next=%2Fitv%2Fnew`; this does not count as interview acceptance.
- With the user's authorization, isolated authenticated API/DB/Chromium regression now captures the list, six stages, and virtual-expert modal at 1440 × 1000. See `apps/web/test-results/fullstack-smoke/digital-interview-research-745c5--all-six-full-screen-stages-seeded/` (transient, ignored screenshots). All six `digital-interview-research-quality.spec.ts` browser cases pass.
- Source/implementation pairs were viewed together. The shared selected-workflow header was about 345 px tall and its active step was white-on-white; it is now under 220 px with a dark active marker. List title/search and stage heading sizing were enlarged; the browser test measures these and verifies all direct routes and return-to-list shell behavior.
- The reference's photographic avatars intentionally differ from the requested generated SVG expert icons. Browser fixture content is sparse (one expert/question group), so screenshot density cannot prove parity for a populated six-card list, multiple experts, or a long report. Pixel-perfect acceptance is not claimed.

## Populated-density follow-up (#4544)

- A separate, deterministic canonical-Markdown browser fixture renders six list cards, four analysis cards, five named expert/question groups, five execution states, and an eight-heading report. It uses an isolated real API/DB/Chromium stack, but intercepts the interview responses; it proves rendering and navigation, **not** persistence.
- A second, no-`page.route` Chromium test (`digital-interview-density-live.spec.ts`) logs in with a seeded account, creates six interviews via the real Next proxy/API, initializes a Markdown revision, saves intake/analysis/experts/outline/report through the live controller, reloads the report route, then re-reads PostgreSQL-backed source via API. All five raw Markdown strings and the version are unchanged after reload. This isolated test passed (1/1). It does not simulate real participant evidence or AI model output.
- At 1280 px, a RED browser assertion found the first two analysis cards 131 px apart vertically. The cards now use a responsive two-column grid; the same assertion is green. The outline intentionally shows one editable group at a time with five selectable groups in its left navigation.
- The long report body was 13 px in a RED browser assertion. Report-only typography is now 16 px, leaving compact chat and preview Markdown unchanged. The fixture includes multi-paragraph sections, a GFM table, lists and a blockquote; browser assertions measure all content bounds at 768/390 px in addition to whole-page overflow. The first table assertion failed because the fixture had blank lines between GFM rows; the row formatting was corrected and the same browser test passed.
- Reviewable list/analysis/report desktop and report-mobile screenshots are generated under `docs/evidence/interview-density/` by the fixture. The exact commands and measured assertions are documented there; local `apps/web/test-results/fullstack-smoke/` remains transient.
- This is content-density and responsive evidence, not pixel-perfect visual signoff. It does not validate real model output quality or report metric correctness.

## Confirmed functional findings and fixes

1. Queued expert tasks were labeled active. Regression failed before the fix; pending tasks now show 等待访谈. Related 32 UI tests pass.
2. Three new RLS policy migrations failed on forced replay. Policy recreation now preserves tenant restrictions; real isolated migration checks rebuild 322 migrations and verify schema/data equality after replay (exit 0).
3. Navigation reachability did not recognize the conditional creation route. Explicit scoped/default router branches preserve navigation behavior and pass the gate.
4. Two CI browser cases retained obsolete legacy fixtures for canonical routes. Fixtures and assertions are updated while preserving avatar persistence/reset, responsive checks, six-step navigation and legacy Skill coverage; the isolated six-case browser regression now passes.
5. Real browser comparison exposed oversized stage chrome, invisible active-step contrast, undersized headings and a cramped list search. A RED-first browser assertion reproduced each mismatch, and the corrected list/workbench layouts pass.
6. The question screen was only a raw Markdown textarea. A RED-first UI test now covers per-question editing and order; the screen projects question rows from Markdown and writes all edits back to the same Markdown document. The virtual-expert dialog now has an adjacent live Markdown preview and explicit simulation-boundary review.

## Verification boundary on this iteration

- The targeted 60 UI tests, web typecheck and lint, and six isolated authenticated Chromium cases pass.
- `pnpm run verify:quick` is **not green**: 25/27 affected tasks succeeded, while `web#test` reported 8 failures among 5,513 tests. Six reproduce in the unmodified whiteboard image test file with a `SubtleCrypto.digest`/cross-realm buffer error; the other two (Skill content editor and CopilotKit permission dialog) pass when rerun in isolation. These are not counted as interview acceptance or silently ignored. Current-head CI must adjudicate this broader test lane before merge readiness.

## Remaining acceptance

- Verify report Word/PDF exports against the same saved version and validate live execution-state grouping; the no-mock persistence journey now proves saved Markdown and reload, but not those two downstream consumers.
- Verify upload and voice failure recovery in an authenticated real browser; the six passing cases do not exercise these error states.
- The prototype's AI-generated virtual-expert fields and rich live-report statistics are not established by the current modal/report browser evidence. Preserve the simulated-versus-real evidence boundary while implementing or explicitly accepting these differences.
- Re-run current-head browser CI and resolve every genuine failure/review before claiming prototype acceptance or merge readiness.

No assertion of complete one-to-one reconstruction or merge readiness is made.
