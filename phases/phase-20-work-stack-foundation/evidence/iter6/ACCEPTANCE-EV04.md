# Acceptance Evidence — Phase 20 Iteration 6 (EV01–EV04)

> Browser journey (`journeys/ev04-gate-status.journey.ts`) BLOCKED in this container: `next build` was OOM-killed, so the web server never started. API behaviour is proven by real-HTTP tests against PostgreSQL; the journey must be re-run where `next build` succeeds.

Date: 2026-09-28 (EV01–EV03) / 2026-09-29 (EV04)
Worktree: /home/user/wt/ev04 (branch claude/tender-maxwell-dh21fg-ev04)

---

## EV01 — eval suite format + S003 suite

### Verification commands

**contracts suite-schema test**
```
pnpm --filter @repo/contracts exec vitest run tests/work-eval/suite-schema.test.ts
```
Result: 7 tests passed (7), EXIT 0

**api s003-suite-shape test**
```
pnpm --filter api exec vitest run tests/work-eval/s003-suite-shape.test.ts
```
Result: 5 tests passed (5), includes CLI exits non-0 with field path on missing field. EXIT 0

### UX notes
- `evals/work-stack/S003/suite.json` exists with stableId=S003, 10 cases (E1–E10) in cases.jsonl
- Missing-field validation prints the exact field path, e.g. `suite.json missing: stableId`
- Suite includes permission-reject case and prompt-injection case (verified by s003-suite-shape test assertions)

---

## EV02 — pnpm harness eval loopback runner and report

### Verification commands

**eval-runner test**
```
pnpm --filter api exec vitest run tests/work-eval/eval-runner.test.ts
```
Result: 16 tests passed (16), EXIT 0
Key assertions: version digest runs; unknown version → SUITE_INVALID; broken suite exits 2; pii fixture rejected.

**eval-report-baseline test**
```
pnpm --filter api exec vitest run tests/work-eval/eval-report-baseline.test.ts
```
Result: 4 tests passed (4), EXIT 0

### User-visible acceptance (developer path)

**Without --baseline:**
```
pnpm harness eval --entity S003
```
Output:
```
eval S003 run S003-20260928T155428-fea194 (loopback)
  subject entity-doc:S003-enterprise-search.md|lb:s003-loopback-1.0.0 sha256:13b090e...
  grader s003-rules-1.0.0  fixtures sha256:2d60ddf...
  E1     subject=pass
  ...
  E10    subject=pass
  subject 10/10 pass
  report evals/work-stack/S003/reports/S003-20260928T155428-fea194.json
```
EXIT 0. Report written with keys: schemaVersion, runId, stableId, subjectVersionDigest, subjectVersionLabel, fixturesDigest, graderVersion, lane, partial, subject.

**With --baseline:**
```
pnpm harness eval --entity S003 --baseline
```
Output shows side-by-side: `subject=pass  baseline=fail` for 8/10 cases (baseline is generic agent). EXIT 0.

**UX assessment:** Output is clear and developer-readable. Report path is printed. Exit codes: 0 on all-pass, non-0 on any fail/error. The --baseline flag shows the value proposition clearly (10/10 vs 2/10).

---

## EV03 — lint-work-stack-gates G0–G4 with counterproofs

### Verification commands

**gates-g0-g4 test**
```
pnpm --filter api exec vitest run tests/work-eval/gates-g0-g4.test.ts
```
Result: 12 tests passed (12), EXIT 0
Key: gate script runs against repo, passes exit code through; bad args rejected.

**gates-counterproof test**
```
pnpm --filter api exec vitest run tests/work-eval/gates-counterproof.test.ts
```
Result: 12 tests passed (12), EXIT 0
Key: broken fixtures (missing license, unregistered category, missing inject case, stale report, no suite) each cause the expected gate to fail. A fixture that would pass when it should fail turns the test red.

### User-visible acceptance (gate on clean tree)

```
node .harness/scripts/lint-work-stack-gates.mjs
```
Output:
```
S003 (evals/work-stack/S003)
  G0 fail  STABLE_ID_MISMATCH  evals/work-stack/S003 exists but no SKILL.md/WORKFLOW.md/AGENT.md declares metadata.work.stableId=S003 (orphan suite)
  G1 fail  PRIOR_GATE_FAILED  no package for this stableId (G0)
  ...
✗ work-stack gates: G0–G4 failed for S003
```
EXIT 1.

---

## EV04 — gate status writeback & catalog gate status display

### Verification commands

**API gate-status-writeback test (run from apps/api dir via nt.sh)**
```
/path/to/nt.sh pnpm exec vitest run tests/work-eval/gate-status-writeback.test.ts
```
Result: **11 tests passed (11)**, EXIT 0

All sub-cases verified:
- Platform operator writes WorkGateStatus for current version; members see it via GET
- G5 pass → operator sees canMarkVerified, member does not
- Concurrent requests with same idempotency key → all 200, exactly one event
- Idempotent replay returns 200 without second event; same key + different body → 409
- Org admin / member (non-platform operator) → 403 WORK_EVAL_PLATFORM_ADMIN_REQUIRED (E9)
- Platform operator writing into a non-official org's catalog → 403, nothing written (I-10)
- stableId mismatch → 422; unknown digest → 409; unknown skill → 404
- After importing a new version: current gate status is not_evaluated; old version record kept (A4/I-2)

**Web UI gate-status test**
```
pnpm exec vitest run tests/ui/work-eval-gate-status.test.tsx
```
Run from apps/web dir. Result: **5 tests passed (5)**, EXIT 0

### Additional checks

| Check | Result |
|-------|--------|
| `pnpm --filter @repo/contracts typecheck` | EXIT 0 |
| `pnpm --filter api typecheck` | EXIT 0 |
| `pnpm --filter web typecheck` | EXIT 0 |
| `node .harness/scripts/lint-arch-deps.mjs` | EXIT 0 (1716 files, all deps inward) |
| `node .harness/scripts/lint-contract-source.mjs` | EXIT 0 (1158 contract types) |

### E2E Full Stack — BLOCKED (infrastructure)

Attempted: start native stack with WSX_REPO=/home/user/wt/ev04 WSX_RESET_DB=1 WSX_REBUILD_WEB=1

Result: `next build` was killed (SIGKILL — OOM or resource limit). The web server could not start.

Subsequent attempt: copied `.next-fullstack-e2e/BUILD_ID` from main workspacex and tried `next start -p 25100`. 
The web log was empty (process started but produced no output and did not respond on port 25100).

The Playwright journey `/skill?screen=work-catalog` + gate badge assertions could NOT be executed.

**Root cause**: The native stack was unable to serve the web application in this session. This is an infrastructure/environment issue, not a code defect. The API-level behavior is fully verified by the 11-test vitest suite.

**What the E2E would verify (not yet demonstrated):**
- `/skill?screen=work-catalog` loads and shows `work-catalog-row-S003`
- Clicking row opens detail drawer with `work-skill-gates` section
- Six `work-gate-badge-G0..G5` elements visible in drawer
- `work-catalog-gate-summary` visible in catalog row
- Non-platform member: `work-skill-change-channel` count = 0
- Direct fetch to `/api/admin/skills/catalog/S003/gate-status` as non-operator → 403

---

## Evidence files

- evidence/iter6/journeys/ev04-gate-status.journey.ts — Playwright spec (not run; E2E blocked)

---

## Verdict

**REVISE — E2E full stack not demonstrated (infrastructure blocked)**

All formal verification commands EXIT 0. Typechecks and architecture lint pass. The blocking issue is the web server's inability to start in this environment (next build OOM killed). The API-level gate status writeback behavior is fully proven by 11 real-HTTP tests against a live Postgres database. A re-run of E2E in an environment where `next build` succeeds (or where a pre-built `.next` dir is available) is required to close the loop.
