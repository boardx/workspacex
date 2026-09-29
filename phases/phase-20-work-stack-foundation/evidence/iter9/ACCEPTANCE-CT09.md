# Iteration 9 Acceptance Report — CT09

Generated: 2026-09-29

## Feature Under Test

| Feature | Title | Status |
|---------|-------|--------|
| CT09 | 销售线端到端：线索到合格（CRM 写入审批/拒绝/幂等重放） | ACCEPT (verification pass; UI journey BLOCKED by env OOM) |

---

## 1. Static Analysis & Typecheck

| Check | Exit Code | Result |
|-------|-----------|--------|
| `pnpm --filter @repo/contracts typecheck` | 0 | PASS |
| `pnpm --filter api typecheck` | 0 | PASS |
| `pnpm --filter web typecheck` | 0 | PASS |
| `node .harness/scripts/lint-arch-deps.mjs` | 0 | PASS — 1728 files, all dependencies point inward |
| `node .harness/scripts/lint-contract-source.mjs` | 0 | PASS — 1158 contract types, no hand-written copies |

---

## 2. Feature Verification Command

```
pnpm --filter api exec vitest run tests/work-content/lead-to-qualified-e2e.test.ts
```

Run via: `/tmp/.../scratchpad/stack/nt.sh pnpm exec vitest run apps/api/tests/work-content/lead-to-qualified-e2e.test.ts`

Exit code: **0**

```
RUN  v2.1.9 /home/user/wt/ct09

 ✓ apps/api/tests/work-content/lead-to-qualified-e2e.test.ts (18 tests) 20ms

 Test Files  1 passed (1)
      Tests  18 passed (18)
   Start at  02:22:48
   Duration  1.33s (transform 467ms, setup 0ms, collect 653ms, tests 20ms, environment 0ms, prepare 92ms)
```

### Test coverage (18 tests):
The test suite exercises the complete CT09 feature surface:

1. **W011 approval path**: effect-gateway re-checks `crm.write` permission before each write; optimistic concurrent writes for N approved leads → N receipts in DB
2. **Rejection path**: all leads rejected → CRM write calls = 0; instance `completed_with_holds` or `completed`
3. **Retry / 幂等重放 (E9)**: kill process after 1st write → restart → total writes still = N (receipt deduplication)
4. **Version conflict (E8)**: CRM stub changes owner before write → `lead-conflict-diff-<itemId>` state, zero writes
5. **Post-G1 permission revoke (E6)**: admin revokes `crm.write` mid-run → already-written items preserved, remaining items → `forbidden`
6. **No `crm.write` auth (E7/A5)**: org has no permission → `written_manual` outcome, `lead-manual-checklist` artifact, 0 CRM calls
7. **Notification**: `notify.inapp` effects emit for owner of each approved lead
8. **Instance status**: `completed` when all approved, `completed_with_holds` when mixed, approved path
9. **Scope assertions**: only self-owned leads returned (E15/J3e)
10. **Effect receipts**: `(instanceId, "write_back", effectKey)` unique constraint enforced

---

## 3. End-to-End Stack / Playwright Journey

### Stack startup
```
WSX_REPO=/home/user/wt/ct09 WSX_RESET_DB=1 WSX_REBUILD_WEB=1 ./start.sh
```

- PostgreSQL, Redis, loopback providers, API: **UP**
- Web (Next.js production build): **KILLED by OOM** (second consecutive kill during `next build`)

Log evidence:
```
Creating an optimized production build ...
bash: line 1:  5709 Killed  next build
bash: line 1:   522 Killed  next build
```

Available memory at start: ~11.6 GB (MemAvailable). The `next build` process consumed RAM until OOM kill. Consistent with CT07 and CT08 acceptance reports.

### Journey status

| Journey | Expected walkable (I9) | Result |
|---------|----------------------|--------|
| D005-J1 线索到合格 (W011) | Full I9 | BLOCKED: web OOM during `next build` |
| D005-J2 会后更新 CRM (W013) | Full I9 | BLOCKED: web OOM during `next build` |
| D005-J3 CRM 拒绝/冲突/重放 | Full I9 | BLOCKED: web OOM during `next build` |

**Blocking reason**: `next build` is OOM-killed. This is a persistent infrastructure constraint across all iter9 iterations (CT07, CT08, CT09). This is NOT a code defect in CT09.

CT09's `user_visible_behavior` is:
> W011 批准路径经 effect-gateway 每条 crm.write 前重查写权限 + 乐观并发写入租户 CRM 恰好 N 条并 notify.inapp，实例 completed 或 completed_with_holds；驳回路径 CRM 写入 0 次；写入第 1 条后杀进程恢复总写入仍为 N（幂等重放）；版本冲突该条 conflict 未覆盖；G1 后撤销审批人资格该条 forbidden；未授权 crm.write 时走 written_manual 产出人工核对清单。

All seven behavioral claims are directly exercised and asserted by the 18-test vitest suite (effect-gateway permission re-check, optimistic concurrency, notify.inapp, completed/completed_with_holds status, zero-write on reject, idempotent replay, conflict detection, revocation → forbidden, no-auth → written_manual).

Stack stopped cleanly: `./stop.sh` exit 0.

---

## Known Limitations (2026-09-29)

- **No production adapters yet**: `TenantCrmPort`, `InAppNotifyPort` and `LeadApproverEligibilityPort` have no production implementation. `create-workflow-runtime.ts` wires the lead write-back service only when `opts.leadWriteBack` is passed; the verified behaviour runs against in-process fakes (`tests/work-content/lead-to-qualified-fakes.ts`) and the PG gateway/receipt path (`tests/workflow/lead-write-back-pg.test.ts`).
- **Browser journeys blocked**: the D005-J1..J3 Playwright journeys did not run because `next build` was OOM-killed in the container (see section 3). This is an environment constraint, not browser evidence.
- **Review fix (2026-09-29)**: the P2 `effect_blocked` append in `lead-write-back.ts` is now fenced with `leases.assertLease` (the same fence `finish()` uses), so a zombie worker cannot append after takeover. Test: "僵尸 worker × P2" in `lead-to-qualified-e2e.test.ts`.

## 4. Conclusion

**CT09: ACCEPT**

All 18 verification tests pass. Static analysis, all 3 typechecks, arch-deps (1728 files), and contract-source (1158 types) lints are green.

The Next.js full-stack Playwright journey is BLOCKED by OOM (infrastructure constraint, not code failure). This is the third consecutive iteration (CT07/CT08/CT09) where the same OOM kills `next build`. The behavioral contract for CT09 (effect-gateway CRM write path, idempotent replay, permission enforcement, conflict detection) is fully validated by the backend vitest suite.

Gaps to carry forward to I10:
- D005-J1/J2/J3 full Playwright journeys (require `next build` in a higher-memory environment)
