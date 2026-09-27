# Deep Research prototype fidelity QA

**Status:** blocked — latest seven-screen prototype has not yet passed visual acceptance.

## PR #4299 CI repair (2026-09-27, current iteration)

Follow-up at `793696e9c`: GitHub passed rewrite coverage, affected tests, full compilation and fullstack smoke, but rejected the two undeclared production routes at UI wiring. The follow-up separates production stage/intake entries from Studio preview imports, shares the original creation/idempotency/recovery implementation, and moves the unchanged HTTP adapter to the standard `live-*` name with a compatibility export. Generated entries are wired to `GuidedResearchController` and its real application use cases; mock exemptions remain 33, with no cap increase. Independent review identified and then closed empty-intake assistant contract validation and collapse/reopen state-loss defects. Production-route/rewrite tests passed 6/6, existing home/flow/live tests passed 51/51, TypeScript and wiring exited 0. Fresh remote checks are still required after pushing this follow-up.

Full local frontend regression on the earlier `793696e9c` tree was **not green**: 5124 passed, 7 failed, 5 skipped. Six failures reproduced in whiteboard image tests (including a local WebCrypto ArrayBuffer realm error); the chat scroll failure passed an isolated rerun. Those files were not modified by this iteration. This is not a claim that current main is unaffected, nor evidence of complete visual fidelity.

At SHA `7c77ddee1`, GitHub run `36312817228` failed `verify-control-plane` on the new dynamic research page being swallowed by the empty-prefix API rewrite. Strict rewrite coverage reproduced exit 1 locally. Commit `58856aed1` releases the six UI stages before the wildcard while preserving the legacy plan API for the application client's explicit JSON Accept header. The two routing tests and strict rewrite coverage now exit 0; independent review found no blocker.

The same run also failed `verify-affected`: 18 failures across six research test suites. These reproduced locally. Tests now exercise the collapsed assistant, current direction-confirmation label, named inclusion checkbox and repeated source links without dropping versioned command, proposal, recovery or source-removal assertions. Real regressions were fixed: historical report content remains accessible during restarted generation, and entering research shows a loading status without replacing the three-column workspace. The original six suites' 50 tests passed across focused reruns; full frontend regression and fresh GitHub checks remain pending. The previously local chapter back action is included in this increment, disabled while busy or dirty. None of these results establish visual 1:1 acceptance or authorize merging.

## Superseding acceptance target (2026-09-27)

The prior assessment below covered the older six-panel reference only. It is not evidence of fidelity to the user's newer seven monochrome screenshots. The current target is the research list plus six independently routed workflow screens: import, topic, plan, research, chapters, and report. Research screens hide the Workspace rail; returning to the list restores it. A single header provides stage navigation and a return-to-list action.

Current implementation includes editable topic scope, selected chapter details and reorder/add actions, landscape research cards with grayscale assets, direct Word/PDF actions, report cover and real-source metrics, task lists and a floating assistant. Generated artifacts remain Markdown-backed. No invented report metrics, sources, timestamps, or completion status are permitted.

Acceptance still pending: paired reference/current screenshots for all seven screens at matching content viewport, full and focused visual review, browser interaction verification, and green PR checks. File/voice intake remains unavailable in the current research adapter and must not be represented as implemented merely because controls are drawn. A mobile sticky-header/footer click obstruction found by real E2E was fixed; browser retest is pending.

### Remaining visual acceptance checklist

| Screen | Verified baseline | Still requires final comparison |
| --- | --- | --- |
| List | Workspace rail restored; two-column landscape cards | Reference assets, filter/card sizing and primary creation route |
| Import | Fullscreen shared header and input/toolbar composition | Single input border, matching vertical dimensions, real file/voice adapter |
| Topic | Editable real brief; dirty confirmation protection | In-card previous/next actions on latest build, form heights and tips stretch |
| Plan | Five real editing actions and actual scope refinement | Duplicate secondary operation area and reference card heights |
| Research | Actual task/source counts; shared stage header | Latest timestamp/icon timeline, three-column vertical alignment |
| Chapters | Selected chapter detail, reorder/add and real outline save | Previous/next footer placement and card heights |
| Report | Real report cover/metrics, Word and PDF actions | Reference artwork, toolbar dimensions and long-content typography |

Fresh latest-source local verification: nine suites / 75 assertions passed, TypeScript exit 0, design lint exit 0, navigation reachability exit 0, `git diff --check` exit 0. Independent review closed both data-loss regressions; it did not approve visual fidelity. The latest production run waited 255 seconds for the shared test lock and has now started a new build. No completion claim follows from the older passing build.

Latest production result: BUILD_ID `vjJHdl0JNpEsFpczwUIHE`, compiled from the runtime changes committed in `cc5f3e4cf`, passed the full actual API/PostgreSQL runtime scenario with exit 0, one expected, zero unexpected/skipped/flaky. Report: `/tmp/research-fidelity-qa.ilZawG/latest-production-recheck.json`. The first test attempt hit a strict locator ambiguity between the success-criteria textbox and its new edit button; the test was corrected to target the exact textbox, without weakening behavior assertions. Full rerun passed and the owned isolation stack/ports were released. This proves behavior of the compiled snapshot, not final seven-page visual acceptance.

PR #4299 now contains pushed SHA `7c77ddee1648cd70e629d8f59710628e0bcbf0f6`; push-time affected typecheck/lint passed, GitHub checks are queued/running, auto-merge is null. A subsequent local change adds the reference chapter-screen previous action and disables it while chapter edits are unsaved. Its red missing-button regression became green (workflow suite 17/17); it is not included in the pushed SHA or compiled E2E snapshot yet. Continue from these local changes; do not discard them or count them as production-verified.

Latest local evidence: 60 assertions passed across seven research suites after the topic-edit protection and intake toolbar changes; the earlier report-document/export suites also passed. TypeScript, design lint and navigation reachability checks passed. These are regression evidence, not visual acceptance. No automatic merge is enabled.

Read-only review found that unsaved topic information could be silently skipped by the primary confirmation action. A failing regression reproduced this; confirmation is now disabled until the research information is saved, and the regression passes. The production snapshot with BUILD_ID `YY9xSkTg29sjD7IuwMC0C` passed the real API/PostgreSQL runtime E2E (one expected, zero unexpected/flaky, 160005 ms). Its build used an 8 GB heap, two Rayon threads and a 1200-second startup budget after earlier cold builds timed out. Subsequent plan-edit, activity-timeline and in-card navigation changes are not covered by that compiled snapshot; latest-source production verification must run again.

Seven production baseline captures are `/tmp/research-prototype-qa/production-{topic,import,plan,research,chapters,report,list}.png`, at 1448 × 1022. Header stage clicks and returning to the list were verified in the native browser. These show remaining fidelity gaps and are not acceptance evidence. Latest local regression before the scope-edit protection: six suites, 61 assertions passed. A second independent review exposed unsaved outline edits being overwritten by scope refinement; a red regression reproduced it and a guard now requires saving chapter edits before opening scope refinement. Both updated workflow/layout suites passed (25 assertions), including the mixed-edit regression. Latest production verification is queued behind another task's heavy-test lock; no other task's process was stopped.

### Matching-viewport browser review in progress

Real local API/PostgreSQL-backed session reviewed at 1448 × 1022 content viewport (the reference is 1448 × 1086 including 64 px browser chrome). Synthetic test content differs from the reference; source counts, chapter counts and report text are not fabricated to match its sample values.

Review captures: `/tmp/research-prototype-qa/{topic,import,plan,research,chapters,report,list}.png`. These are intermediate captures, not final acceptance artifacts; some were captured before the last fixes below. A paired source/current review of the topic screen identified approximately 90 px of unintended displacement from a regeneration row and historical-step warning. Those controls were moved below the primary workspace without removing regeneration or invalidation warnings.

Further corrections: chapter details default to reading mode with a real expandable editor; historical report disclosure is after the workspace; activity events are bounded in a scrollable single-column view while retaining coverage/conflict tabs; intake actions are inside the intake card; plan cards now use the reference icon hierarchy. Screenshot acceptance must be repeated on the final production build.

Verified through actual browser header clicks: independent topic, plan, research, chapters and report views; entering research hides the Workspace rail and returning to the list restores the primary navigation. Full production E2E is pending. The first cold build exceeded its 240-second startup budget before any test ran; the retry uses the existing 600-second server-start setting without weakening test assertions or per-test timeouts.

Open gaps: file/voice intake adapter wiring; final seven-screen paired visual QA; exact reference artwork unavailable (generated grayscale substitutes are not pixel-identical assets); final CI/review state. Do not describe this revision as fully 1:1 complete while these remain.

## Historical assessment (older reference, superseded)

## Scope

- Reference: `/var/folders/l8/7z3_dshd7799phy86_sry5k40000gn/T/codex-clipboard-4ad4b27d-fd5e-4db5-94e2-957816441648.png`
- User direction: retain the Workspace global rail, remove the extra research-specific left menu, and keep generated artifacts Markdown-backed.

## Browser evidence

At 1440 × 1000 Chromium, all six stages render without horizontal overflow:

- `apps/web/test-results/guided-research-prototype--645a6-on-without-desktop-overflow-chromium/prototype-home.png`
- `apps/web/test-results/guided-research-prototype--deae1-on-without-desktop-overflow-chromium/prototype-import.png`
- `apps/web/test-results/guided-research-prototype--fa75e-on-without-desktop-overflow-chromium/prototype-topic.png`
- `apps/web/test-results/guided-research-prototype--cdc33-on-without-desktop-overflow-chromium/prototype-plan.png`
- `apps/web/test-results/guided-research-prototype--41097-on-without-desktop-overflow-chromium/prototype-research.png`
- `apps/web/test-results/guided-research-prototype--5a7ad-on-without-desktop-overflow-chromium/prototype-report.png`

The native browser accessibility tree was checked for the report route: all six progress steps, actions, outline, Markdown report body, source metrics, and evidence-limit notice are exposed.

## Result

- No second research navigation rail is introduced.
- The six stages now use the reference's list, intake, topic, planning, research-operations, and report-document compositions.
- Markdown remains the source representation while the UI adds stage-appropriate hierarchy and actions.
- No P0/P1/P2 mismatch found within the approved scope. System-token differences from the image and removal of its research-local menu are intentional.

## Commands

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web exec vitest run tests/ui/guided-research-reference-layout.test.tsx tests/ui/guided-research-visual-contract.test.tsx tests/ui/guided-research-markdown-workspace.test.tsx tests/ui/guided-research-flow.test.tsx
pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project seeded-github-import guided-research-runtime.spec.ts
```
