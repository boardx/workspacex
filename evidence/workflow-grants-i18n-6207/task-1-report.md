# Task 1 report

Status: implementation ready for root verification and independent review. No test success claimed.

## Files
- apps/web/components/org-admin/workflow-grants-screen.tsx
- apps/web/components/org-admin/workflow-grant-dialog.tsx
- apps/web/lib/workflow-capability-grant-copy.ts
- apps/web/lib/i18n/namespaces/workflow-grants.ts (new)
- apps/web/lib/i18n/messages/en.ts (namespace import/spread only)
- apps/web/lib/i18n/messages/zh-CN.ts (namespace import/spread only)

## Implementation
Complete screen/dialog presentation uses typed translation keys. Namespace contains English and canonical Chinese copy, all 18 known capabilities/descriptions, four levels/descriptions, targets, closed API errors, and safe fallbacks. Namespace imports nothing. Existing CAP_LEVEL remains Chinese, derived from new optional-locale capabilityLevelCopy. capabilityCopy, targetSystemText and describeWorkflowGrantFailure retain Chinese defaults. Unknown dictionary lookups use own-property checks.

Load failures retain unknown values, distinguished by dep-failed state; dialog failures wrap unknown values so falsey errors still render. Functional setter preserves thrown function values as raw data. Success notices retain canonical category/level and render in the current locale. No locale was added to effects or callback dependencies or dialog initialization. Workflow/member shared helpers receive current locale. Audit formatter retains existing options, instant and local timezone semantics.

## Self-review
Reviewed semantic test expectations and original implementation; inspected final changed source and searched Han characters in both TSX files. Remaining Han characters are comments only. Canonical grant/revoke arguments, levels, coverage model, focus resolution and audit IDs unchanged. Unknown/authored titles and member names flow through existing helpers. Other concurrent E2E edits were left untouched.

## Checks
Actually run: read-only source/test inspections, rg searches, git diff --stat. Used temporary Python scripts for scoped edits. Initial direct Python execution failed due environment encoding behavior; explicitly reading UTF-8 and compiling the scripts completed the edits.
Pending (root-owned resource windows): semantic and Chinese regressions, type/lint, browser/API evidence, independent review. No tests, typecheck, lint, builds, browser, PG, commit, push, checkout or worktree operations run by this worker.

## Concerns
No known product blockers. Runtime and static-tool verification remain pending. Existing refresh-after-mutation failure routing is retained from the prior implementation.
