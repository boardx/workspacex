# Phase-20 Iter4 Acceptance Report

Date: 2026-09-29
Features: WF04, WF05, WF06, WF08
Worktree: /home/user/wt/iter4

---

## Environment Fixes Applied (Infrastructure Gaps)

The test setup required two patches to handle this sandbox's native PostgreSQL environment:

1. **`apps/api/tests/support/db.ts`**: Added `WORKSPACEX_NATIVE_PG_PORT` env var support in `nativePostgresReady()` and `createDatabaseNative()`. The `with-test-isolation.ts` wrapper overrides `PGPORT` to an isolated port (20xxx), but native postgres is on 55432. Without this patch, all API tests failed.

2. **`.harness/scripts/with-test-isolation.ts`**: When `WORKSPACEX_NATIVE_POSTGRES=1`, preserve the native PGPORT (55432) instead of the isolation-assigned port, while still using the isolated DB name.

Run command pattern: `WORKSPACEX_NATIVE_POSTGRES=1 WORKSPACEX_NATIVE_PG_PORT=55432 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run <test>`

---

## Verification Commands — Exit Codes

| Feature | Command | Exit Code | Tests |
|---------|---------|-----------|-------|
| WF04 | `pnpm --filter api exec vitest run tests/workflow/effect-gateway-recheck.test.ts` | **0** | 11/11 pass |
| WF04 | `pnpm --filter api exec vitest run tests/workflow/effect-no-replay.test.ts` | **0** | 4/4 pass |
| WF05 | `pnpm --filter api exec vitest run tests/workflow/human-gate-approve-deny.test.ts` | **0** | 8/8 pass |
| WF06 | `pnpm --filter api exec vitest run tests/workflow/trigger-pgboss-webhook.test.ts` | **0** | 17/17 pass |
| WF08 | `pnpm --filter web exec vitest run tests/ui/workflow-run-panel.test.tsx` | **0** | 27/27 pass |

All 5 verification commands: **PASS**

---

## Type Checks

| Package | Exit Code |
|---------|-----------|
| `pnpm --filter @repo/contracts typecheck` | **0** |
| `pnpm --filter api typecheck` | **0** |
| `pnpm --filter web typecheck` | **0** |

---

## Lint / Architecture

| Check | Exit Code | Result |
|-------|-----------|--------|
| `node .harness/scripts/lint-arch-deps.mjs` | **0** | 1706 files, all dependencies inward |
| `node .harness/scripts/lint-contract-source.mjs` | **0** | 1153 contract types match |

---

## Test Details

### WF04 — effect-gateway-recheck (11 tests)
- assertLease → permission recheck (E2/E4)
- blocked_permission with reasonCode on auth failure
- cancel during effect → EffectCancelledError
- default read-only for unconfigured capability (ADR-120)
- idempotency_key_reused surfaces correctly

### WF04 — effect-no-replay (4 tests)
- E1: crash recovery → needs_attention (no reconciler)
- Not-begun receipt → no-op reconcile
- A1-style replay: cached result, tool called exactly once

### WF05 — human-gate-approve-deny (8 tests)
- A5: two concurrent approvers → exactly one wins, other gets 409
- A4 deny: reason required, no effect receipt, onDeny branching
- A4 deny with forward stage: rejected, fallback runs
- E4/V7: approve + permission recheck fails → blocked_permission
- HTTP: 403/422/200/409 contract bodies; approve + instance succeeds

### WF06 — trigger-pgboss-webhook (17 tests)
- R9 key rotation: previous secret slot still accepted
- webhook secret not SELECTable by app_rw
- Shape validation: non-object body 422, short Idempotency-Key 422
- Non-runnable agent → workflow_not_allowed
- E8: pg-boss {kind:'workflow'} job wakes trigger; job id = requestId → 1 instance

### WF08 — workflow-run-panel (27 tests)
- Run panel renders all 7 states: running/awaiting/denied/blocked_permission/reconnecting/failed-retryable/empty
- SSE live log, stage timeline with attempt/version
- Approval drawer: preview, approve/deny buttons, expected state version
- needs_attention and blocked_permission banners
- No-permission: entry point not visible

---

## API-Level E2E Evidence (curl)

Stack was started with `WSX_REPO=/home/user/wt/iter4 WSX_RESET_DB=1 WSX_REBUILD_WEB=1 ./start.sh`:
- READY state logged successfully
- DB migrations applied: 20260929060000_wf06_workflow_triggers.sql, 20260929070000_wf05_workflow_human_gate.sql

**WF06 webhook 401 assertion:**
```
curl -X POST http://127.0.0.1:24100/workflow-triggers/nonexistent/webhook \
  -H "X-Webhook-Signature: sha256=badsig" \
  -H "Idempotency-Key: test-$(date +%s)"
→ {"code":"webhook_signature_invalid","message":"webhook_signature_invalid"} HTTP 401
```
This confirms WF06's "bad signature → 401" behavior is live in the running API.

---

## Browser E2E — BLOCKED (Infrastructure)

**Blocking condition:** Disk space (ENOSPC). Available: 5.4G. Two concurrent agent sessions both performed Next.js builds (ct03: 2.2G, ct05: 2.2G), leaving insufficient space for iter4's web rebuild (~1G). The second `start.sh` call failed at webpack cache write phase.

**Additional blocker:** Another agent session (ct03) held the shared stack flock during the entire E2E window, preventing iter4's Playwright tests from running.

**Routes confirmed to exist in code:**
- `/home/user/wt/iter4/apps/web/app/workflows/runs/page.tsx` ✓
- `/home/user/wt/iter4/apps/web/app/workflows/runs/[instanceId]/page.tsx` ✓
- `/home/user/wt/iter4/apps/web/app/workflows/approvals/page.tsx` ✓

**WF08 browser behavior**: Covered by 27 unit tests in `tests/ui/workflow-run-panel.test.tsx` which mount the components in jsdom with all 7 states, mock SSE, and assert testids/copy.

---

## Walkable Slices — Per ACCEPTANCE-JOURNEYS.md

| Slice | Expected in I4 | Status |
|-------|---------------|--------|
| effect-gateway permission recheck (demo workflow) | ✓ | VERIFIED via API tests |
| human-gate approve/deny (demo workflow) | ✓ | VERIFIED via API tests |
| webhook trigger 401/409 | ✓ | VERIFIED via API tests + curl |
| `/workflows/runs` page exists | ✓ | Route confirmed in code; browser load BLOCKED |
| `/workflows/approvals` page exists | ✓ | Route confirmed in code; browser load BLOCKED |
| Guided research original e2e remain green | Not blocked | Not tested (no DB state for guided-research) |
| `/agent` (J0-B) | NOT IN I4 (I5) | Correctly absent |
| W001 full journey | NOT IN I4 (I7) | Correctly absent |

---

## Verdict

**Unit/Integration tests: ALL PASS** (67 tests across 5 suites)
**Typechecks: ALL PASS**
**Lint: ALL PASS**
**Browser E2E: BLOCKED** by infrastructure (ENOSPC + concurrent session lock)

The browser blocking is not caused by code defects — it is an operational constraint of the shared native stack running on a capacity-constrained disk with multiple concurrent agent sessions. The WF08 UI correctness is covered by 27 vitest tests.

**Recommendation: REVISE** — browser E2E should be re-run once disk space is freed (remove old .next-fullstack-e2e artifacts from other worktrees).
