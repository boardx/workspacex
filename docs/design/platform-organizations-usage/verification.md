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

## CI counterproof correction checkpoint

Remote `gates-runtime` passed on 2cd3d992f after tenant-scoping the platform access audit. Remote test shard 8 exposed six invalid personal-local fixtures (missing required owner) and the metadata-adapter allowance ceiling. The fixture now supplies its owner; the ceiling documents exactly three new metadata adapters (catalog, admission, usage), with executable metadata/content/tenant/operator premises and companion PostgreSQL authorization/concurrency tests. No gate is skipped.

The earlier 90/90 combined-suite report is withdrawn as lightweight evidence: independent review found its database counterproof has an automatic database initializer. It has been removed from the no-DB configuration; the counterproof stays in its existing remote database CI lane. UI fixtures remain 20/20. PostgreSQL execution remains remote-only. No production changes or browser screenshot evidence.

Corrected no-database owner suite passes 63/63. UI wiring normal fact regeneration and verification pass, including `/usage`; regenerated chat use-case facts are generator-derived existing source imports, not hand-authored scope additions.

Independent reviewer passed all 6 dynamic premise tests and accepted the three explicitly bounded adapter allowances. Normal pre-push caught a strict TypeScript optional mock-call access; fixed before retry, without bypassing hooks.

## Subset and CI boundary fixes

Configured stream loopback and ledger subset tests pass with total unchanged. API lightweight suite 65/65 and usage UI 3/3 pass before final shared helper extraction; current final checks pending. Reviewer independently passed writer 9/9, source review found no blocker and requested more cancellation/failed-response subset cases. Real database subset migration not locally executed. Remote prior analytics-head failures included generic table SELECT tests against the deliberately write-only access audit and the thin-gateway line guard; tests now assert SELECT denial instead of broadening grants, and accounting observers were extracted to a shared helper. These changes require remote rerun.

Final subset review caught stale details across corrected stream frames; sanitize after stream and error merges now preserves valid totals, with a loopback counterexample. API focused suite 74/74 including thin-gateway passes; API/web typecheck and usage UI 3/3 pass. PG access-denial changes remain pending CI.

## Private runtime receipt source checkpoint (2026-10-04)

Owner no-DB API suite 80/80 and two usage UI fixture suites 9/9 pass; API typecheck and full lint pass. Independent reviewer ran private API mock 5/5, Python OpenAI 3.1.0 + MockTransport 10/10 and permission lint; source review accepted child/root attribution, auxiliary lease identity, typed errors, and the narrowly bounded metadata adapter exemption. The existing remote counterproof ceiling is explicitly increased by exactly one (127 -> 128) for that reviewed adapter, with table/content/tenant/void-return premises. It is not run locally because its setup automatically initializes a database. No permissions or generic guards are widened.

Python tests include real SDK automatic 429 retry, not a real vendor: two actual MockTransport dispatches get different request IDs, billed failure usage survives. SQLite pending receipts survive reopening and repair only accounting. Spool-write failure preserves the provider response, attempts direct receipt delivery and blocks later dispatches in that process; the fault flag does not survive a restart. An unmatched durable start remains explicit coverage missing, not free usage. Root/child LangGraph propagation, crash gaps, restart fault handling, real PostgreSQL migration/FK/RLS and idle-period replay are still unverified or unfinished. Both production accounting flags stay disabled. No screenshot/live endpoint/all-provider certification is claimed.

Remote c84 CI failures are repaired in source: migration140 column/constraint replay, catalog test SET LOCAL ROLE within an actual transaction, and UI adapter schema validation with correctly routed unavailable-new-endpoint fixture. CI-only commit 2caddee6a is authored; push initially rejected normally because hooks inspect current private-interface source. The new source errors and metadata boundary have since been corrected; next normal push is pending.

### Follow-up library-level evidence

Owner no-DB suite is now 94/94, including existing child execution/cancel/signal regressions. Python 13/13 includes actual LangGraph 1.2.11 asynchronous nodes and LangChain/OpenAI SDKs using MockTransport for root, child and summary context; this is library-level propagation, not the deployed WorkspaceX graph/checkpointer or live provider. Reviewer independently passed private API mock 7/7 and Python 13/13 and accepted full metadata revalidation on concurrent start-ID collision. Callback key is now read from the Python service environment, not emitted in the persisted configurable runtime payload. Remote gates-runtime succeeded on 44c58070e; catalog shard8 and affected UI were still in progress when checked.


### Audited policy and exact-dispatch source checkpoint

At pushed HEAD 3c29e1683, remote backend run 37154450951 gates-runtime and gates-test(8) succeeded. Shard8 log confirms all 6 organization repository PostgreSQL cases passed. Harness run 37154450957 verify-affected succeeded; verify-control-plane failed in the existing lint-startup-discovery.test.ts with spawnSync git ls-files ENOBUFS. This is not a whole-CI-green claim, and no gate was changed or bypassed.

Policy batch adds explicit window/timezone, ordinary per-user Token cap (nullable), finite cost/currency, immutable provider/runtime binding prices and ordered bounded fallback configuration. All new configuration states expose enforcement=pending. Operator guard/audited formal-org access precede secret-free current model-pool candidate projection. Version conflict and established-window overlap reject writes; plan kind remains independent. Migration160 permits INSERT-only immutable member windows; migration170 adds bounded logical-call attempt slots. Neither migration has run locally or in production.

Independent policy review ran 14 no-DB cases and found no new definite blocker after two P2 fixes (stale org UI save responses; fresh pool context/capability recheck). UI policy/catalog/usage fixtures pass 11/11. Exact ConfiguredModelProvider loopback composition exercises serialized-body measurement, admission before HTTP, same request ID start/terminal, smaller output cap, zero dispatch on denial/replay and no release/retry on failed ledger write. Measurement fixtures are deliberately synthetic; they are not production tokenizer certification. Known billed failed usage prices cache/reasoning subsets once and writes the sole ledger before settlement; unknown cache differential or incomplete usage keeps the hold.

No authentic operator browser screenshot is available: CUA Chrome inventory is blocked by request-header policy loading. No UI tool policy was bypassed, and fixture tests are not screenshots. Unified executor/auxiliary/child/Python wiring, real verified input bounds and all-provider/native billing units remain unfinished. The source helper is not registered in runtime DI or enabled in production. New policy/materialization/logical-slot PostgreSQL tests are authored for the normal remote lane only.

Owner final no-DB suite passes 118/118; API/web typecheck and full lint pass. Independent reviewer accepted exact-dispatch helper and logical attempt-slot source after adding persistent caps, explicitly reserving PostgreSQL concurrency/RLS certification and trusted logical-call identity derivation. UI fixtures remain 11/11 after hook cleanup correction.


Second source batch: owner API126/126 and independent coordinator7/7 pass; typed HTTP classification has actual loopback 429/503 versus401/400/500 counterexamples. Selection metadata/callback and capability/confidential fallback denial are tested. Owner/independent Python20/20 include idle restart repair, receiver isolation, cancellation, poison receipt rotation across batches and immutable receiver/run/payload replay identity. Independent reviewer found then closed P2 starvation after durable queue rotation. API typecheck/full lint pass. These are source/MockTransport/SQLite results, not deployed runtime or full-path enable evidence.

At12c04b4e8, remote backend run37157288809 gates-runtime and all8 test shards passed. Exact logs confirm organization repository10/10 in shard8 (111303263876) and admission repository8/8 in shard6 (111303263861), including actual immutable member-window materialization and concurrent logical-slot/replay/cap negatives. Harness verify-affected job111303189738 passed; verify-control-plane job111303189943 failed and remains a separate blocker. Subsequent coordinator/idle batch still needs its own remote run.

2026-10-04 c2cf6814 remote verification: backend run37161448973 and harness37161448901 completed success. Retrieved backend log `/tmp/wsx-c2-backend.log` explicitly shows isolated PG ai-admission-repository10/10 (including immutable old price and legacy in-flight), ai-usage-repository3/3, platform-organization-repository10/10. These results precede native migration180 and the runtime-wiring batch; they do not verify the new native tests or new operator UI screenshots.

2026-10-04 frozen529488455 backend run37163173323 completed success with all8 PostgreSQL shards. Saved log `/tmp/wsx-529-backend.log` explicitly confirms ai-usage-repository5/5 (including native original-unit summary/call parity, database constraints, immutability and cross-tenant negatives), ai-admission-repository10/10, platform-organization-repository10/10. Unit suites ai-native-ledger5/5 and ai-context-runtime-wiring4/4 also passed remotely; these latter mock suites are not PostgreSQL certification. deep-agent37163173368, Native Board37163173364, Skills37163173354, self-host37163173366 and Board lanes37163173613 completed success. harness37163173327 completed success, including control-plane, fullcompile/merge, affected and fullstack smoke. These results certify frozen529 only.

The locally added durable-child ownership test and revised coverage/next-hook plan are NOT in529. API typecheck and coverage guard exit0, source review no blocker; no local DB execution. Cancellation fixture explicitly preserves the required timestamp/state pair. Do not claim this test executed or parallel lock blocking certified. No parent-running/active-lease gate was added.


### Run-scoped retrieval dispatch batch

Owner lightweight API167/167 and Python52/52 pass. Python uses the actual OpenAI/LangChain SDK with httpx MockTransport, metadata-only mock callbacks and SQLite; this is not a live vendor, actual API receiver or PostgreSQL end-to-end certification. Added tests exercise per-batch HTTP request IDs, original reported input-only usage without fabricated completion, explicit rerank output limit, zero dispatch on missing/forged identity or admission denial, concurrent context isolation, missing usage, single 503 failure and cancellation with durable terminal repair. Independent review of core source passed API7/7 and Python49/49; independent final retrieval suite9/9 passed, including the three new cases; no source blocker. Cancellation is transport-level CancelledError, not every cancellation timing window.

The trusted standard-tool controller forwards only org/run/attempt/lease after existing authority checks; API receipt handling rederives the original user. Both retrieval flags remain default off. Ordinary default-off calls preserve existing payloads; enabled receipt mode requires a trusted context. Admission mode with no verified input-only embedding capability denies HTTP. No model rates, policy limits, production flags or service owner have been invented.

Machine-checkable dispatch-inventory.json audits seven concrete transmission primitives: three full receipt hooks, one context-limited hook and three missing. Two of seven known retrieval producer routes now propagate the trusted run reference; KG, ingestion, cosine query/candidate and service warmup remain missing. External research underlying vendor dispatch count and the whole-repository denominator are unknown. Family-level sourceMissing remains10 because each family has some source work left; it is not a completion percentage.

New real-PG hybrid retrieval and durable-child ownership tests are authored and typechecked but not locally executed and not covered by frozen529. Child ownership intentionally retains its own running epoch/attempt plus child and parent cancellation, without adding parent-running/active-lease semantics. No database, Docker, heavy build, deployed-provider acceptance or new operator browser screenshots were run for this batch.


### OpenAI image receipt subset (source checkpoint)

Trusted standard-image context forwards server-owned run/attempt/lease, never user IDs from tool args. PgImageRequestAccounting uses the existing shared root/child owner resolver and sole ledger writer. Durable start stores original user, root/child, epoch, attempt and metadata before fetch; terminal uses captured identity even after cancellation. Actual vendor usage retains input/output Tokens when reported; native image quantity remains unknown rather than inferred from n=1 or returned bytes. No price is guessed.

Owner full pre-final suite197/197 and final image-specific9/9 pass; API typecheck and lint exit0. Existing image provider/selection/service regression23/23 is included. Evidence is localhost HTTP/mock PG, not provider billing or real PostgreSQL. Independent review found terminal failure overriding paid success; fixed to preserve response, warn without content/key and block subsequent dispatch in that instance. Durable start remains unmatched; cross-process fault/reconciliation remains missing. Both image flag and production quota stay disabled. Native admission missing => quota mode denies before start/HTTP, with no new default rates. Bailian opt-in cannot silently claim these OpenAI hooks. Independent final image review9/9 passed using real localhost HTTP after permitted socket retry, with no source blocker.

Current remote retrieval head4d4afffd4 normal pre-push20/20 passed. Python, Native Board, Board, Skills and self-host CI successful at the last read; backend37166332957 and harness37166332969 still running. Source-only image work is not in that remote head.


### Trusted local trial and frozen retrieval remote acceptance

Owner final no-DB suite218/218, API typecheck/lint exit0. Independent local trial8/8 passed using actual localhost inference requests. Probe is excluded from inference receipts, original Ollama input/output counters retained, absent total/cost unknown. Existing local egress guard remains active. Server authenticated principal/checked membership/capability supplies the context; membership is rechecked before sole-ledger durable start. Non-Agent trial run_id remains NULL, never a synthetic Agent run. Additive migration190 restricts NULL run to named non-run purpose and NULL execution identities, preserves RLS/freeze/append-only/grants; two real-PG constraint/tenant tests authored, not locally executed or covered by frozen4d. Local admission remains missing; quota mode denies before start/HTTP. Terminal failure preserves output, warns and blocks later inference in that instance; no cross-process repair claim. The accounting flag remains default off.

Frozen remote4d4afffd4 backend37166332957 and harness37166332969 completed SUCCESS, all8 PG shards and runtime/core/native jobs. Saved log /tmp/wsx-4d-backend.log explicitly confirms hybrid-retrieval7/7 and subtask-run-store-real-db21/21, including the newly authored trusted reference/child independent-lifecycle cases; usage repository5/5. These are isolated API/PG acceptance with fake internal service responses, not deployed Python-to-vendor ledger/admission certification. This evidence precedes image/local receipt batches and nullable migration190. No new operator screenshot or production changes.

Single writer normally merged origin/main9dfd4da39 into branch with no textual conflict: merge a627ca172. API199/199 and typecheck passed immediately after merge before local batch. Current audited7-point source inventory is receipt3 full hooks,3 trusted-context subsets,1 missing (ASR actual WebSocket); opaque research and whole-repository denominator remain unknown. Source subset counts do not imply native/local admission complete.
