# Iteration 3 Acceptance Report — WF01 / WF02 / WF03

Date: 2026-09-28  
Branch: claude/tender-maxwell-dh21fg-iter3  
Environment: No Docker daemon (local PostgreSQL 16 on 127.0.0.1:5432)

---

## Infrastructure Note

Docker daemon is not available (`/var/run/docker.sock: no such file or directory`).  
Tests that need PostgreSQL were run with a docker shim (forwards `pg_isready` and `CREATE DATABASE` to local postgres) plus the full isolation env block (`WORKSPACEX_ISOLATION_SEED`, `WORKSPACEX_DB`, `PGHOST=127.0.0.1`, `PGPORT=5432`, `WORKSPACEX_REUSE_INFRA=1`). Each test run got a fresh `wsx_<id>` database created before the run.

---

## WF01 — Workflow domain model, ports, version pinning

### Verification commands

| Command | Exit | Result |
|---------|------|--------|
| `pnpm --filter @repo/contracts exec vitest run tests/workflow/definition-schema.test.ts` | **0** | 6/6 passed (14ms) |
| `pnpm --filter api exec vitest run tests/workflow/version-pinning.test.ts` (via shim) | **0** | 10/10 passed (16.9s) |

### User-visible behavior exercised

version-pinning.test.ts assertions cover:
- Publishing a WorkflowDefinition validates graph factory key:version registered, stage-to-node correspondence, Skill references resolved and published, immutability after publish.
- Starting an instance freezes the definition version and each Skill version into `workflow_instances`.
- After v2 is published, in-flight v1 instances continue running with v1's frozen Skill versions.

All 10 tests green.

---

## WF02 — Checkpointer factory and unified receipt/lease

### Verification commands

| Command | Exit | Result |
|---------|------|--------|
| `pnpm --filter api exec vitest run tests/workflow/checkpointer-factory.test.ts` (via shim) | **0** | 6/6 passed (19.7s) |
| `pnpm --filter api exec vitest run tests/workflow/lease-epoch-cas.test.ts` (via shim) | **0** | 5/5 passed (18.3s) |

### User-visible behavior exercised

checkpointer-factory: factory returns saver with schema `langgraph_workflow`, `checkpoint_ns=key:version`, `thread_id=instanceId`, shared connection pool; receipt begin/finalize idempotent.  
lease-epoch-cas: epoch CAS — two concurrent workers racing to resume, only one wins; after expiry the takeover bumps epoch; old holder's `assertLease` throws `workflow_lease_lost` before any effect.

All 11 tests green.

---

## WF03 — start/resume/cancel API, event log, SSE envelope, demo workflow

### Verification commands

| Command | Exit | Result |
|---------|------|--------|
| `pnpm --filter api exec vitest run tests/workflow/instance-lifecycle-api.test.ts` (via shim) | **0** | 7/7 passed (39.8s) |
| `pnpm --filter api exec vitest run tests/workflow/sse-envelope-resume.test.ts` (via shim) | **0** | 4/4 passed (42.9s) |
| `pnpm --filter api exec vitest run tests/workflow/demo-workflow-crash-recovery.test.ts` (via shim) | **0** | 5/5 passed (22.8s) |

### User-visible behavior exercised

instance-lifecycle-api:
- POST → 201 with pinned version set; stages write business rows; events are 1..N; instance succeeds.
- A1 idempotency: same requestId (concurrent and repeated) creates exactly one instance, replays the first response; different payload → `idempotency_key_reused`.
- A1 on failure path: rejected start (422/403) replays same rejection for same requestId.
- A1 for cancel/resume: same requestId (concurrent) replays first response; failed cancel replays its 409.
- E3: cancel with stale `expectedStateVersion` → 409 `state_version_conflict` carrying latest projection; current version cancels at next stage boundary.
- E2: resume while running worker holds the lease → 409 `lease_conflict`.
- R5/E6: other members/orgs get 404; non-runnable agent is 403; invalid trigger input is 422.

sse-envelope-resume:
- First connect: snapshot then contiguous deltas `{instanceId,seq,type,stateVersion,payload}`; every pushed seq exists in `workflow_events`.
- E10: disconnect mid-run and reconnect with `Last-Event-ID` → resumes at seq+1, no gap, no duplicate, no snapshot.
- Gap beyond retention window → snapshot first, then only newer deltas.
- Cross-org stream attempt → 404.

demo-workflow-crash-recovery:
- Lease renewal while running: run longer than lease TTL still completes (no lease loss).
- Resume from last checkpoint after crash between output write and checkpoint advance: no stage redone, no duplicate events.
- R3: expired lease taken over by scanner (no resume API call); continues from checkpoint.
- E11: lost checkpoint after progress → `needs_attention`; projection still shows completed stages from business rows.

All 16 tests green.

---

## Static analysis

| Check | Exit | Result |
|-------|------|--------|
| `pnpm --filter @repo/contracts typecheck` | **0** | pass |
| `pnpm --filter api typecheck` | **0** | pass |
| `pnpm --filter web typecheck` | **0** | pass |
| `node .harness/scripts/lint-arch-deps.mjs` | **0** | 1694 files, all dependencies point inward |
| `node .harness/scripts/lint-contract-source.mjs` (after fix) | **0** | 1155 contract types, no hand-written copies |

---

## Bug found and fixed

**File:** `apps/api/src/application/workflow/workflow-runtime-ports.ts` line 8  
**Issue:** `WorkflowEventType` was derived via `Extract<WorkflowSseEnvelope, ...>["payload"]["event"]` — a hand-written copy of the contract type, violating ADR-020 single source.  
**Fix:** Changed to `z.infer<typeof WorkflowEventTypeSchema>` importing `WorkflowEventType` from `@repo/contracts/workflow-runtime`.  
`lint-contract-source.mjs` exit 0 after fix; `api typecheck` exit 0 after fix.

---

## Known deferred items (from WF03 notes in feature_list.json)

- **E6 partial (Agent allowlist):** `pg-workflow-access` does not yet validate `workflowAllowlist` in the Agent version snapshot. "Agent not in whitelist → 403" deferred to AG05.
- Both items were noted as known at iteration 3 in the feature's own notes field; no new regressions introduced.

---

## Summary

All 7 required verification commands pass (exit 0). Static analysis passes. One contract-source violation was found and fixed in scope. The three features WF01, WF02, WF03 satisfy their `user_visible_behavior` contracts as demonstrated by the tests above.
