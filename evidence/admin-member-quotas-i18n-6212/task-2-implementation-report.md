# Task 2 implementation handoff — source frozen

Changed only:
- `apps/web/components/admin/limit-policy-tab.tsx`
- `apps/web/components/admin/limit-rules-live.tsx`
- Used degradation/task grading display metadata in `apps/web/lib/mock/admin-limits.ts`
- New pure `apps/web/lib/i18n/namespaces/admin-limit-policy.ts`
- Namespace import/spread registrations in messages/en.ts and zh-CN.ts

Live cards/list, create/edit controls, all enum labels, loading/empty/read failure, validation, actionable rule errors, success/delete feedback and toggle accessibility now use bilingual resources. Generic failures reuse Task 1 memberFailure; only the two existing actionable rule-specific codes remain local mappings. Feedback is stored as semantic functions with setter wrappers, preserving explicit error presence for falsey or function-valued thrown values. Render uses current t/locale. Locale is absent from load callback/effect dependencies. Existing modal/draft/view and pending request state is retained.

Preserved API paths/payload construction, raw refs/model names/IDs, enum keys and their original ordering, scope trimming, Number/finite/positive validation and Math.trunc, server usedRatio rounding, agent no-metering disclosure, existing CRUD/reload flow and org/session behavior. No new pending guards, cancellation semantics, backend, permission or contract changes.

Prototype copy is bilingual, local toggle feedback remains local, and NoBackendNotice remains in place. Chinese default mock metadata derives from canonical pure Chinese resources. Sample 吴桐 remains unchanged in English; 98 and the sample name are shared display facts, as are Scout/Ledger numeric detail fragments. 90/85 trigger values, sonnet-4.6 and Scout/Ledger/Ava names/IDs remain unchanged. Unused usage sample data was not moved or translated.

Owned headers/actions wrap, select controls have min-width bounds, cards have min-w-0, and the task table retains contained scrolling. Raw long degradation target display can wrap. Actual mobile geometry requires root browser verification.

Self-review by source reading covered complete original source files, generated rendering expressions, resource registrations, callback/setter semantics, noUncheckedIndexedAccess concerns, raw data boundaries and absence of locale-driven request effects. No tests, typecheck, lint, builds, init, Git actions, browser/PG, resources or subagents were run by this worker. Root owns all verification; no validation success is claimed.

## Root actual covering gate after source freeze

`WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web exec vitest run tests/ui/admin-limit-policy-i18n.test.tsx tests/ui/admin-limit-policy-live.test.tsx tests/ui/admin-members-usage-limits-tabs.test.tsx tests/ui/ai-usage-format-i18n.test.ts tests/ui/ai-usage-i18n.test.tsx`: Task2 new9+legacy13 all22PASS; Task3 not implemented, all15 meaningful UI/formatRED, normal collection/no unhandled errors; total37cases/16.74s, expected commandexit1 from Task3RED. Scoped9fileESLint exit0. No type/PG/browser claim. Process actually exited and main-authorized window released to phase1 thenphase2. Independent source review SPEC/QUALITYPASS applies frozen6file hashmanifest; no productdelta after review.
