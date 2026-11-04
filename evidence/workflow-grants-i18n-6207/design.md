# Organization workflow grants localization — #6207

Translate the complete real `/org-admin/workflow-grants` screen and confirmation dialog. Both capability and workflow views, deep-link focus/missing, summary/shortfall, capability explanations, levels/impact, notice/errors/pending and audit need English/Chinese. Existing Chinese defaults remain byte-compatible. Unknown/authored workflow titles and member names stay raw.

## Global constraints
- Preserve all capability IDs, four canonical levels, rank/coverage computations, workflow keys/IDs/stage IDs, audit event IDs/timestamps, request payloads and authorization checks. No API/backend/model changes.
- Locale switches only rendering: no request/effect dependency changes, no grant/revoke, no dialog selection reset, no refetch. Store errors and notice intent as semantic/raw data rather than translated strings.
- Existing CAP_LEVEL remains a backward-compatible Chinese export. Add optional-locale `capabilityCopy`, `describeWorkflowGrantFailure`, `targetSystemText` and a localized level helper, backed by a typed namespace imported only by messages. Do not duplicate Chinese canonical copy. Shared helper legacy callers remain default Chinese until independently adopted.
- workflowDisplayName(key,title,locale) and memberLabel(id,me,names,locale) already exist and must be reused, not reimplemented. Preserve unknown title interpolation exactly.
- Intl.DateTimeFormat uses current locale and existing options, preserving the instant and local timezone semantics.
- Do not edit workflow-grant-model.ts, contracts, live API, workflow-display-copy.ts, Chat capability-picker files, fixture/scanner/timeout budgets, or other feature product code.
- One existing worktree, one issue/PR. This branch starts from profile #6203 source (common resources) and excludes home #6204 changes. An explicit stacked PR may target profile; develop integration and queue remain main-owned.

## Acceptance and proof boundaries
Root adds semantic tests for English rendering and legacy Chinese behavior, selection/no-refetch through locale toggles, grant/revoke exact API arguments and semantic notices, raw errors safely localized, audit member and unknown workflow raw text, empty/deep-link/denied states. Root executes RED before product implementation, focused regressions and type/lint, then real admin and member browser journey with strict contracts and screenshot QA. Unit mocks prove view behavior only. Actual backend capability authorization and audit must come from real browser/API. Every source change after actual runtime evidence is explicitly bounded.
