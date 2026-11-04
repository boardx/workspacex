# Home configuration implementation plan

Use subagent-driven development for the bounded production task after root records semantic RED. Root owns tests, fixture/browser, verification, evidence and delivery; independent reviewers own their reports. Product work is multi-file integration, standard model; final whole-branch review uses most capable model.

## Task 1 — Localize the complete existing home configuration

Ownership: apps/web/components/org-admin/home-config-screen.tsx, home-config-theme-section.tsx, home-config-appearance-section.tsx, home-config-content-sections.tsx, home-config-recommend-sections.tsx, home-config-form-model.ts; lib/home-config-catalog.ts only default copy references, lib/home-theme.ts only THEME_LABELS references; new lib/i18n/namespaces/org-home-config.ts and the two message aggregates. Do not touch palette algorithms, API/runtime/provider/permissions/CI or other screens. You are not alone; preserve concurrent edits. No own commits/checkouts/push/worktrees/subagents.

- [ ] Read evidence/org-home-config-i18n-6204/design.md and root contract apps/web/tests/ui/org-home-config-i18n.test.tsx first (17 semantic cases). Base bfb608070b6ebb77156e63fde2d7f6b7c97101a6, same soleworktree /Users/shenyangjun/boardx/workspacex-i18n-agent-skill, branchworker/i18n-org-home-config-6204. Preserve exact current source data and state/request semantics.
- [ ] Root runs and records RED before any product changes; do not weaken assertions. Reuse existing canonical action.* and common/Nav/state/error resources, do not duplicate copy facts.
- [ ] Complete all tabs/sections/pickers/preview and all controlled asynchronous feedback, retaining raw authored content and stable identifiers.
- [ ] Preserve existing Skill picker filter status === "已启用"; it is a stable adapter value, not controlled display copy. Exact controlled English in root tests is part of this UI contract; string accessible-name match is already exact without Testing Library's unsupported ByRole exact option.
- [ ] Only run focused tests/ESLint if root explicitly grants a window; otherwise implementation is light. No independent heavy validation.
- [ ] Write .superpowers/sdd/org-home-config-6204/task-1-report.md with all branches, source invariants, command evidence and remaining boundaries.

## Task 2 — Root integration, actual evidence and delivery

- [ ] Task review on exact tree, existing home-config/theme/resource regressions, canonical metadata before/after, type/lint/init as affected.
- [ ] Actual administrator/member browser: draft/locale/no-refetch/save/reload, real inert preview and selected controls/pickers/upload/403 paths, explicit screenshots and cleanup.
- [ ] Most-capable whole-branch review and bounded fix/re-review; evidence committed.
- [ ] Wait actual6203 merge, merge fresh develop and verify pure6204 delta. Normal push/independent Closes6204 PR, source CI then main-only native queue/merge. Continue workflow-grants complete subtree next.
