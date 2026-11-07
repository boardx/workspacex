# Platform Model Catalog Internationalization Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL superpowers:subagent-driven-development, task-by-task.

Goal: complete actual model-management page localization, with zero functional/provider/financial changes.
Initial planning context: spec docs/design/platform-model-catalog-i18n/spec.md. Issue6255, branchworker/i18n-platform-model-catalog-6255. Base latest fetched origin/develop ef49474134137e7d07cef97577d4799fbd9c0eb8; origin/main e44119db91e9539418ad605ca6aaef2c155d0116 fetched before development. Reuse the same existing worktree. Previous Draft6254 cloud acceptance remains active and any actual failure takes priority.

Global constraints: root owns normal Git/gates/resource handoff/evidence; workers source-only, not alone, never revert others. Fresh sole handoff before any gate/hook/normalcommit, stop first failure and release before diagnosis. No local Next/DB/browser; existing cloud CI runtime. Raw authenticated artifacts private, every finalPNG individually viewed before READY.

### Task 1: Full-page namespace and mocked acceptance

Own production: apps/web/components/admin/model-screen.tsx, org-core-model-panel.tsx, bailian-model-catalog.tsx, entity-catalog.tsx, disable-dialog.tsx; typed namespace entries and en/zh-CN dictionary wiring. No filtering/helper/SDK/contracts/API/provider/accounting changes. Existing shared labels must remain single-source; preserve tag keys independently of translated display labels. Preserve all old tests.

- [x] StageA new tests only: apps/web/tests/ui/platform-model-catalog-i18n.test.tsx. Full English and locale-switch ownership/draft/filter/validation/call/payload/financial-display assertions with faithful SDK fixtures; no production changes.
- [x] Root freeze + focused semantic RED with legacy/resource controls. Schema/driver/type/collection mistakes are not valid RED.
- [x] StageB minimum complete display implementation only after root release.
- [x] Root related GREEN/lint/types/init/raw/testid/wiring/static and independent task source review.

### Task 2: Native route and cloud acceptance

- [x] Freeze actual supported native journey/actors and unchanged local-only behavior; source-only dedicated spec plus additive existing config selection if needed, no new backend fixture/provider feature.
- [ ] Actual discovery/source review then explicit Draft publication via normal scan/hooks to develop, Closes6255.
- [ ] Existing cloud actual run, first failure repair and all actual375/1280 screenshot QA. No green-check-only acceptance.
- [ ] Final runtime/whole-branch review and main-controlled all-green queue/actual merge. Update issue/progress/handoff without false completion.

## Source publication checkpoint

Source5961383 normally merges accepteddevelopfe372 and preserves originalTDD commits.66-case focusedGREEN precedes exact shared-key reuse;30 affectedcases/11filelint pass afterward. Final native-spec lint/type/init/raw-error/testid/wiring/static20/exact3case discovery pass. Independent source reviews close shared-label duplication, body-row capture anchoring, false budget claims, login response timing and array first-row narrowing. No local Next/DB/browser started. Native3cases/atmost22PNGs/finalruntime+wholebranch review remain pending; source publication must stay Draft. Existing6254 actualcloud failures retain priority.

Scanner correction checkpoint: source079706dc changes only two synthetic ApiError rawbody testfield names, retaining all assertions/values. Six affectedcasesPASS, scopedlint0, canonicalscan0/new0; originalreviewer closureclear. No scanner/baseline/provider/product change; native5961383 bytes unchanged.

## Bounded correction after first cloud attempt

At source55d2, case1 passed13.575s, case2 failed the same exact full-card visibility check in both attempts, case3 did not execute. Root individually viewed22 generated images (14 unique planned,6 retry repeats,2 automatic failures), finding the scroll-boundary issue and one missing English notice separator. The approximate162/163 raster interpretation is not an original DOM rectangle.

The independent new semantic case failed before the one-character English correction, then passed at sourcea14e1392 (25 old cases filtered). Resources5,6-file lint, web types, testid and exact3-case discovery pass. Same-node native center/nearest positioning preserves every original ratio1/x/scrollWidth/document assertion and all budgets. Original reviewers cleared this delta. Integration into accepted a002 preserves the exact saved tree and all source ancestry using unchanged normal hooks. New native execution/final image QA remain pending; keep Draft.

## Second cloud attempt and round 5 correction

Run41964623997 at444f65dc passed case162 in18.521s. Member/public-snapshot case270 exceeded the unchanged30s total budget on both attempts; row-dependent case335 was not executed. Both public-detail widths and four detail screenshots completed before later filtered-catalog audit cancellation. Trace confirms cumulative driver work, not a measured ratio failure or missing DOM node. All25 images were individually inspected:15 first-attempt planned,6 retry repeats,4 automatic failures; no new owned-copy finding, and no final page acceptance.

Sourced87fdc474 removes only the redundant Playwright scroll stabilization before the existing same-node native instant centering. All three case bodies, selectors, full-node checks, ratio1/x/fits/document assertions, screenshots and budgets remain identical. Before/after numeric receipts now bracket native centering directly and remain private. Single-spec lint, canonical web types, testid and exact3-case discovery pass; no old suite/init/Next/DB rerun. Cloud timing/acceptance, final PNG QA, runtime and strongest final review remain pending. Draft / NOT READY.

Independent round5 scoped source review: ADDRESSED, no new Critical/Important issue. Only cumulative driver overhead closure is approved; exact-source native fit and final acceptance remain pending.
