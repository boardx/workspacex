# Research planning and parallel acquisition implementation plan

> Execute inline with superpowers:executing-plans. User approved 2026-11-06.

**Goal:** Reduce plan latency and collect independent chapter sources concurrently before composing the report.
**Architecture:** Keep existing read/model quotas, share one bounded task coordinator across chapters, serialize persisted mutations, and keep the report barrier after all acquisition settles. Avoid redundant brief generation when server semantics already preserve every user field.
**Tech Stack:** TypeScript, Vitest, existing runtime and source reader.
**Spec:** `../specs/2026-11-06-research-parallel-acquisition-design.md`; user-approved design in this chat: faster plans, parallel acquisition, consolidated report, honest progress. Supersedes prior sequential section scheduling requirement.

## Constraints
- Reuse restored e6f1 worktree; fetched main/develop, integrate into develop.
- No provider, schema migration, accounts, credentials or production configuration changes.
- Preserve exact evidence, coverage, cancellation, recovery and report quality gates.
- Existing model/read concurrency remains 2/3 during acquisition; bound whole-section work to 3.

## Review focus
- Shared URLs cannot overwrite approvals or associations under reversed completion.
- Cancellation drains all dispatched callbacks and prevents late persistence.
- Recovery/supplements must not starve untouched sections or multiply quotas.
- User-supplied brief survives without unnecessary model dispatch; default names still need generation.
- Progress represents actual work; controlled speed measurements are not production claims.

## Tasks
- [x] Add RED tests: independent section starts while first search/recovery/supplement is blocked; cancellation has no late writes; global quotas and URL dedup preserved.
- [x] Replace section barrier with bounded section workers and retain shared permits/serialized commits. Run acquisition/recovery suite GREEN.
- [x] Add RED tests for named brief prepare_plan making only dependent directions/outline calls. Skip redundant brief model work, retain validation and default-name generation.
- [x] Expose reading/screening progress through existing progress transport, and test UI interpretation with real runtime snapshots.
- [x] Run research suite, API typecheck/lint, focused web tests and deterministic delayed-source comparison; review diff, open PR and follow CI. Record live-model/production timing limits.

## Execution ledger
- Baseline init.sh quick health passed. Coordination tick unavailable because COORD_GATEWAY_URL is unset; no fabricated lease. Direct user incident takes precedence over unrelated readiness items.

- Ruling: retain existing plan schemas/repair instead of adding unrelated provider schema changes; measured optimization is omission of a redundant named-brief call. Default-topic subject generation remains unchanged.
- Ruling: progress phase starts persist immediately; updates within the same phase coalesce for 250ms, with no background timer or unsaved observer snapshot. This fixes normal polling visibility and same-revision SSE regression risks.

- Final local validation: init.sh quick health; research40files/920 tests; focused web2files/36tests; API/web typecheck; API lint; diff check. Independent review completed and P2 polling issue fixed; follow-up reviewer ran33tests green. Controlled final results and limitations: docs/evidence/research-parallel-acquisition-6332/README.md. PR/CI delivery remains to finish.
