# Ledger foundation verification

Base: caf445c3c. Scope: focused unit/static checks only. No DB, Docker, provider or UI started.

## pnpm --filter @repo/api exec vitest run --config vitest.usage-unit.config.ts

Exit code: 0

```text

 RUN  v2.1.9 /private/tmp/wsx-platform-org-plans/apps/api

 ✓ tests/auth/token-usage-single-write-path.test.ts (18 tests) 62ms
 ✓ tests/auth/token-usage-receipt.test.ts (8 tests) 3ms

 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  02:49:10
   Duration  989ms (transform 511ms, setup 0ms, collect 757ms, tests 65ms, environment 0ms, prepare 39ms)


```

## pnpm --filter @repo/api typecheck

Exit code: 0

```text

> @repo/api@0.0.0 typecheck /private/tmp/wsx-platform-org-plans/apps/api
> tsc --noEmit


```

## pnpm --filter @repo/api lint

Exit code: 0

```text

> @repo/api@0.0.0 lint /private/tmp/wsx-platform-org-plans/apps/api
> node scripts/lint-error-leak.mjs && node scripts/lint-permission-paths.mjs && node scripts/lint-no-builtin-capabilities.mjs && node scripts/lint-global-scope-test-fixtures.mjs && node scripts/lint-design-facet-single-source.mjs && tsx scripts/gen-design-facet-catalog.ts --check && tsx scripts/gen-agenda-tier-catalog.ts --check && node scripts/lint-skill-context-api-only.mjs && node scripts/lint-naming-single-source.mjs && tsx scripts/lint-work-skill-manifests.ts && node ../../.harness/scripts/lint-arch-deps.mjs apps/api/src

✅ lint-error-leak: 169 files in the interface layer, no error detail reaches a response
scanned=169
✅ lint-permission-paths: every tenant-table read goes through the guarded read path
scanned=1935 tenant-tables=308 allowlisted=149
· [debt] apps/web/lib/mock/admin-limits.ts:31  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/admin-limits.ts:32  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/admin-limits.ts:33  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/admin-limits.ts:114  list-shaped constant `USAGE_MATRIX_MODELS` with 5 entries
· [debt] apps/web/lib/mock/admin.ts:378  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/admin.ts:379  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/admin.ts:380  built-in capability entry `Echo`
· [debt] apps/web/lib/mock/admin.ts:381  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/agent-runtime.ts:229  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/agent-runtime.ts:270  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/agent-runtime.ts:271  built-in capability entry `Atlas`
· [debt] apps/web/lib/mock/agent-runtime.ts:272  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/agent-runtime.ts:273  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/agent-runtime.ts:274  built-in capability entry `Warden`
· [debt] apps/web/lib/mock/agent-runtime.ts:275  built-in capability entry `Echo`
· [debt] apps/web/lib/mock/agent-runtime.ts:288  built-in capability entry `Atlas`
· [debt] apps/web/lib/mock/agent-runtime.ts:343  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/agent-runtime.ts:344  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/agent-runtime.ts:389  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/agent-runtime.ts:391  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/agent-runtime.ts:393  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/agent-runtime.ts:395  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/agent-runtime.ts:400  built-in capability entry `Atlas`
· [debt] apps/web/lib/mock/agent-runtime.ts:402  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/agent-runtime.ts:404  built-in capability entry `Atlas`
· [debt] apps/web/lib/mock/agent-runtime.ts:406  built-in capability entry `Atlas`
· [debt] apps/web/lib/mock/agent-runtime.ts:411  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/agent-runtime.ts:413  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/agent-runtime.ts:415  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/agent-runtime.ts:417  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/agent-runtime.ts:422  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/agent-runtime.ts:424  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/agent-runtime.ts:426  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/agent-runtime.ts:428  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/agent-runtime.ts:433  built-in capability entry `Warden`
· [debt] apps/web/lib/mock/agent-runtime.ts:435  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/agent-runtime.ts:437  built-in capability entry `Warden`
· [debt] apps/web/lib/mock/agent-runtime.ts:439  built-in capability entry `Warden`
· [debt] apps/web/lib/mock/agent-runtime.ts:444  built-in capability entry `Echo`
· [debt] apps/web/lib/mock/agent-runtime.ts:446  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/agent-runtime.ts:448  built-in capability entry `Echo`
· [debt] apps/web/lib/mock/agent-runtime.ts:450  built-in capability entry `Echo`
· [debt] apps/web/lib/mock/agent-runtime.ts:472  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/asset-governance.ts:385  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/canvas.ts:268  list-shaped constant `templates` with 3 entries
· [debt] apps/web/lib/mock/canvas.ts:268  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/canvas.ts:269  list-shaped constant `templates` with 6 entries
· [debt] apps/web/lib/mock/canvas.ts:269  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/canvas.ts:270  list-shaped constant `templates` with 3 entries
· [debt] apps/web/lib/mock/canvas.ts:270  list-shaped constant `skills` with 6 entries
· [debt] apps/web/lib/mock/canvas.ts:271  list-shaped constant `templates` with 3 entries
· [debt] apps/web/lib/mock/canvas.ts:271  list-shaped constant `skills` with 3 entries
· [debt] apps/web/lib/mock/chat-diagram-fabric.ts:39  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/chat-viz.ts:48  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/chat.ts:56  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/chat.ts:57  built-in capability entry `Atlas`
· [debt] apps/web/lib/mock/chat.ts:58  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/chat.ts:59  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/chat.ts:60  built-in capability entry `Warden`
· [debt] apps/web/lib/mock/chat.ts:61  built-in capability entry `Echo`
· [debt] apps/web/lib/mock/chat.ts:372  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/chat.ts:413  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/chat.ts:422  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/chat.ts:450  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/chat.ts:484  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/chat.ts:485  list-shaped constant `models` with 4 entries
· [debt] apps/web/lib/mock/chat.ts:530  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/chat.ts:733  list-shaped constant `skills` with 6 entries
· [debt] apps/web/lib/mock/chat.ts:738  list-shaped constant `skills` with 4 entries
· [debt] apps/web/lib/mock/chat.ts:744  list-shaped constant `skills` with 5 entries
· [debt] apps/web/lib/mock/chat.ts:749  list-shaped constant `skills` with 4 entries
· [debt] apps/web/lib/mock/chat.ts:785  list-shaped constant `presetSkills` with 3 entries
· [debt] apps/web/lib/mock/interview-studio.ts:426  built-in capability entry `Echo`
· [debt] apps/web/lib/mock/live-collab-orchestration.ts:278  list-shaped constant `skills` with 2 entries
· [debt] apps/web/lib/mock/live-collab-orchestration.ts:279  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/live-collab-orchestration.ts:279  list-shaped constant `skills` with 2 entries
· [debt] apps/web/lib/mock/live-collab-orchestration.ts:282  list-shaped constant `skills` with 2 entries
· [debt] apps/web/lib/mock/live-collab-orchestration.ts:285  list-shaped constant `skills` with 2 entries
· [debt] apps/web/lib/mock/live-collab-orchestration.ts:289  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/live-collab-orchestration.ts:289  list-shaped constant `skills` with 2 entries
· [debt] apps/web/lib/mock/rec.ts:351  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/rec.ts:417  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/rec.ts:418  built-in capability entry `Ava`
· [debt] apps/web/lib/mock/rec.ts:419  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/research-studio.ts:90  list-shaped constant `RS_SOURCE_DEFAULT` with 2 entries
· [debt] apps/web/lib/mock/skill.ts:695  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/tasks.ts:161  built-in capability entry `Ledger`
· [debt] apps/web/lib/mock/tasks.ts:171  built-in capability entry `Scout`
· [debt] apps/web/lib/mock/tpl.ts:343  built-in capability entry `Scout`
✅ lint-no-builtin-capabilities: no built-in capability list in product code
scanned=3354 violations=0 debt=89 migrations=396
✓ global-scope test fixtures：28 个文件全部已声明
· [debt] apps/web/lib/mock/tpl.ts:95  second design-facet definition table spread over multiple lines (13 distinct keys)
· [debt] apps/web/lib/mock/tpl.ts:523  hardcoded completeness denominator in `usedCount: 12, satisfaction: { mean: 4.6, sampleSize: 9 }, d`
· [debt] apps/web/lib/mock/tpl.ts:529  hardcoded completeness denominator in `usedCount: 3, satisfaction: { mean: 4.3, sampleSize: 3 }, do`
· [debt] apps/web/lib/mock/tpl.ts:541  hardcoded completeness denominator in `usedCount: 4, satisfaction: { mean: 4.4, sampleSize: 5 }, do`
· [debt] apps/web/lib/mock/tpl.ts:560  second design-facet slot list (3 keys: flow-agenda, project-materials, outputs…)
· [debt] apps/web/lib/mock/tpl.ts:562  second design-facet slot list (2 keys: grouping-rule, skill-binding…)
· [debt] apps/web/lib/mock/tpl.ts:564  second design-facet slot list (3 keys: topic-and-background, survey, report-template…)
· [debt] apps/web/components/tpl/designer-panels.tsx:710  second design-facet definition table spread over multiple lines (11 distinct keys)
✅ lint-design-facet-single-source: the definition table has one source
scanned=4928 violations=0 debt=8 keys=13 groups=5
✅ design-facet catalog is in sync with the definition table
✅ agenda tier catalog is in sync with the definition table
✅ lint-skill-context-api-only: 78 个文件，skill 取数只经 Context API（I-25）
scanned=78 violations=0
✅ lint-naming-single-source: 0 处败选名（stepId / step_id / agenda_stage / stage.<action>）
scanned-roots=4
lint-work-skill-manifests: 89/89 个 Work Skill manifest 通过
✅ lint-arch-deps: 1933 files, all dependencies point inward
scanned=1933

```

## Independent review

Separate reviewer ledger_review reviewed current source and independently reran focused tests: 26/26 pass. Initial P2 findings (pre-dispatch metering and empty paused/interrupted envelopes) were fixed and re-reviewed. No remaining source blocker for entering draft; complete feature remains unfinished.

Real PG replay/RLS tests and additive migration are authored, not executed. All-provider HTTP attempts, durable compensation, quota reservations, catalog/plans, cost policies and full analytics remain incomplete. No screenshot evidence exists; this is not end-to-end evidence.

## Catalog source checkpoint

Focused API suite: 42/42 passed, including real loopback SSE transport (no external provider cost). UI fixture tests: 17/17 previously passed, current rerun pending. Independent source review confirmed literal search, formal-only catalog, fail-closed permissions and plan transaction structure. Its save/selection finding was fixed by disabling organization switching/search/refresh/pagination during save; failed detail state is explicit.

Real PG catalog/RLS/concurrency/audit tests are authored for isolated CI only. No local DB, Docker, heavy build, production provisioning or screenshot capture occurred. Full accounting, reservations, bounded fallback and expanded analytics remain unfinished.

## Request/admission checkpoint (in progress)

Owner lightweight API suite passed 53/53 (real loopback HTTP with sandbox escalation, no external provider calls); API typecheck passes. Reviewer independently passed 32 tests; its 16 HTTP cases were not executed due sandbox listen EPERM, so independent full-suite success is not claimed. Reviewer confirmed request lifecycle source boundary; terminal recovery/all-provider coverage remains absent.

Admission review found row-lock permissions, held-receipt double counting and incomplete settlement context; corrected using canonical advisory locks, one conservative hold and provider/model/window matching. Real PG admission and start-receipt tests are authored, not locally run. Existing isolated CI on f0a98af26 failed RLS audit for platform access table; corrected source is pending push/rerun. No production SQL, role provisioning, migrations or budget activation occurred.

## Analytics source checkpoint

Owner focused API 57/57 and UI fixtures 20/20 pass; API/web typecheck and lint pass. Independent source review checked query parameter/alias/authorization paths and bounded output, no confirmed blocker. Real PG report parity/filter/cursor/RLS tests are authored, not locally executed. Browser/live endpoint/screenshots remain unverified. asOf is a timestamp cutoff, not strict cross-request MVCC; late commits can change pages. Partial coverage and group truncation are explicit.
