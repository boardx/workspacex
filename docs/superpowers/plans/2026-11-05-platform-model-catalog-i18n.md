# Platform Model Catalog Internationalization Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL superpowers:subagent-driven-development, task-by-task.

Goal: complete actual model-management page localization, with zero functional/provider/financial changes.
Spec: docs/design/platform-model-catalog-i18n/spec.md. Issue6255, branchworker/i18n-platform-model-catalog-6255. Base latest fetched origin/develop ef49474134137e7d07cef97577d4799fbd9c0eb8; origin/main e44119db91e9539418ad605ca6aaef2c155d0116 fetched before development. Reuse the same existing worktree. Previous Draft6254 cloud acceptance remains active and any actual failure takes priority.

Global constraints: root owns normal Git/gates/resource handoff/evidence; workers source-only, not alone, never revert others. Fresh sole handoff before any gate/hook/normalcommit, stop first failure and release before diagnosis. No local Next/DB/browser; existing cloud CI runtime. Raw authenticated artifacts private, every finalPNG individually viewed before READY.

### Task 1: Full-page namespace and mocked acceptance

Own production: apps/web/components/admin/model-screen.tsx, org-core-model-panel.tsx, bailian-model-catalog.tsx, entity-catalog.tsx, disable-dialog.tsx; typed namespace entries and en/zh-CN dictionary wiring. No filtering/helper/SDK/contracts/API/provider/accounting changes. Existing shared labels must remain single-source; preserve tag keys independently of translated display labels. Preserve all old tests.

- [x] StageA new tests only: apps/web/tests/ui/platform-model-catalog-i18n.test.tsx. Full English and locale-switch ownership/draft/filter/validation/call/payload/financial-display assertions with faithful SDK fixtures; no production changes.
- [x] Root freeze + focused semantic RED with legacy/resource controls. Schema/driver/type/collection mistakes are not valid RED.
- [x] StageB minimum complete display implementation only after root release.
- [ ] Root related GREEN/lint/types/init/raw/testid/wiring/static and independent task review.

### Task 2: Native route and cloud acceptance

- [ ] Freeze actual supported native journey/actors and unchanged local-only behavior; source-only dedicated spec plus additive existing config selection if needed, no new backend fixture/provider feature.
- [ ] Actual discovery/source review then explicit Draft publication via normal scan/hooks to develop, Closes6255.
- [ ] Existing cloud actual run, first failure repair and all actual375/1280 screenshot QA. No green-check-only acceptance.
- [ ] Final runtime/whole-branch review and main-controlled all-green queue/actual merge. Update issue/progress/handoff without false completion.
