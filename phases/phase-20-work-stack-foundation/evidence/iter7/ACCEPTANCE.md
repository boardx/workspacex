# Phase 20 CT03 Acceptance Report — Iteration 7

Date: 2026-09-29
Branch: claude/tender-maxwell-dh21fg-ct03
Verifier: Claude Sonnet 4.6 (independent; wrote none of the implementation)

## Features Under Test

| Feature | Title | Area | Wave |
|---------|-------|------|------|
| CT03 | 研究线端到端：调研到简报 | work-content-research | 7 |

Dependencies: CT02 (✓ passing), WF04 (required)

---

## 1. Static Checks

### 1.1 TypeScript

| Package | Command | Exit Code | Notes |
|---------|---------|-----------|-------|
| @repo/contracts | `pnpm --filter @repo/contracts typecheck` | 0 | Clean |
| api | `pnpm --filter api typecheck` | 0 | Clean |
| web | `pnpm --filter web typecheck` | 0 | Clean |

### 1.2 Architecture & Contract Lint

| Check | Command | Exit Code | Result |
|-------|---------|-----------|--------|
| lint-arch-deps | `node .harness/scripts/lint-arch-deps.mjs` | 0 | 1728 files, all deps inward |
| lint-contract-source | `node .harness/scripts/lint-contract-source.mjs` | 0 | 1153 contract types, no hand-written copies |

---

## 2. Feature Verification Commands

### CT03: `pnpm --filter api exec vitest run tests/work-content/research-to-brief-e2e.test.ts`

**Exit code: 0 — 6 tests passed**

```
✓ CT03 research line e2e: W001 research → brief
  > V3: S003→S063→S171→S020→S010 → G2 → G3 dual-sign → effect-gateway publishes exactly once → succeeded/complete with evidenced claims (446ms)
  > G3 with an external recipient category and only one approver: stays awaiting_gate_decision, nothing published (437ms)
  > G3 dual-sign does not count the initiator as a second signer (408ms)
  > effect-gateway rechecks publish permission: revoked artifact.write grant → blocked_permission, publish never called (489ms)
  > G2 denied → rejected, zero effects (424ms)
  > A4: no retrievable material → data needs statement, succeeded with_holds, no claims, no gates, no publish (342ms)

Test Files: 1 passed (1)
Tests:      6 passed (6)
Duration:   18.73s
```

**Assertions verified:**
- Full research chain: S003 → S063 → S171 → S020 → S010 → G2 gate → G3 dual-sign → effect-gateway publish
- Instance completes with `completed` status; each claim has `evidenceRefs`
- Effect log: exactly 1 publish event
- G3 dual-sign: external recipient category (`board`) requires 2 approvers; single sign does not release
- G3 dual-sign does not count initiator as second signer
- Permission recheck: revoking `artifact.write` after G2 approval → `blocked_permission`, 0 publish receipts
- G2 denied → instance `rejected`, 0 effects emitted
- A4 fallback: no retrievable materials → `data needs statement` output, `completed_with_holds` status, no fabricated conclusions

---

## 3. Full Stack E2E

### 3.1 Stack Status

**Stack environment:** Native PostgreSQL 16 on :55432, Redis on :56379, API on :24100, Web on :25100.

**Stack lock contention:** The shared stack lock (`stack/.lock`) was held continuously by concurrent iteration verifiers (iter4-wf04-wf08, ct05, ct09) throughout the acceptance window. After two queue attempts totaling >40 minutes, the CT03 flock was terminated. The stack infrastructure is shared and serialized; this is an environment-level constraint.

**API responsiveness (observed while other iterations' stacks were running):** API on :24100 returned structured JSON 404 responses for unknown paths, confirming the NestJS server was up and healthy.

### 3.2 Walkable UI Slices in I7 (per ACCEPTANCE-JOURNEYS.md)

| Journey | Required Routes | Status in I7 |
|---------|----------------|-------------|
| D002-J1 全链路 (W001 research → brief) | /agent (AG04), /workflows (WF08) | **NOT WALKABLE** |
| /research entry point | /research (exists since Phase 19) | Walkable |
| /skill catalog | /skill (exists) | Walkable |

**Gap analysis:**
- `/agent` (Agent Directory) is defined in AG04 — not yet implemented in this branch
- `/workflows/runs` (Run Panel) is defined in WF08 — not yet implemented in this branch
- CT03 is a **backend-only feature** (application layer: `runResearchToBrief` + `EffectGateway`); it has no new UI routes of its own
- The full D002-J1 browser journey is gated on AG04 + WF08, which are wave-7+ features not in CT03's scope

### 3.3 Journey Spec Written

Spec file: `evidence/iter7/journeys/ct03-research-to-brief.journey.ts`
Stack journey copy: `stack/journey/iter7-ct03.spec.ts`

Tests written:
1. Web app loads (< 500 status)
2. Login form reachable at /login
3. Dev-mode consultant login works → redirects away from /login
4. /research entry point exists (legacy path)
5. /skill route exists (catalog)
6. DOCUMENTED GAP: /agent returns 404 (AG04 pending)
7. DOCUMENTED GAP: /workflows returns 404 (WF08 pending)

**Stack E2E status: PARTIALLY BLOCKED (lock contention). Tests 1-5 walkable; tests 6-7 are gap documentation (expected failures).**

---

## 4. Conclusion

| Check | Result |
|-------|--------|
| Contracts typecheck | PASS |
| API typecheck | PASS |
| Web typecheck | PASS |
| lint-arch-deps | PASS |
| lint-contract-source | PASS |
| CT03 verification (backend e2e) | PASS — 6/6 tests |
| Stack E2E browser journey | BLOCKED (lock contention) |
| UI: /agent route | NOT IMPLEMENTED (AG04 pending, not CT03 scope) |
| UI: /workflows route | NOT IMPLEMENTED (WF08 pending, not CT03 scope) |

**CT03 feature verification: PASS on all contractual checks.**  
The `user_visible_behavior` for CT03 describes the backend domain behavior (W001 workflow chain D002→W001→S003→S063→S171→S020→S010→G2→G3→effect-gateway→completed). All 6 test cases cover this behavior including error paths and the A4 data-needs fallback. The verification command specified in `feature_list.json` exits 0.

The full browser journey (D002-J1) requires AG04 and WF08 which are not CT03 deliverables.

---

## Evidence Files

- `evidence/iter7/ACCEPTANCE.md` — this report
- `evidence/iter7/journeys/ct03-research-to-brief.journey.ts` — journey spec
- Backend test output: see Section 2 above (run via `nt.sh`)
- Screenshots: pending stack availability (lock contention prevented browser run)
