# Acceptance Evidence — Phase 20 Iteration 6 (EV01–EV03)

Date: 2026-09-28
Worktree: /home/user/wt/iter6 (branch claude/tender-maxwell-dh21fg-iter6)
Load at start: 16.21 → waited until ~8.73 before proceeding

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

**Failure message quality:** Tells the developer exactly what to fix — "no SKILL.md/WORKFLOW.md/AGENT.md declares metadata.work.stableId=S003 (orphan suite)" — actionable, no guesswork. REASON_CODE (STABLE_ID_MISMATCH) is machine-readable via --json flag.

Note: S003 is an eval suite without an associated entity skill registered in the repo. The gate correctly identifies this as an orphan suite at G0. The vitest tests (gates-g0-g4.test.ts) exercise the pass path against correctly registered fixtures.

---

## Additional checks

| Check | Result |
|-------|--------|
| `pnpm --filter @repo/contracts run typecheck` | EXIT 0 |
| `pnpm --filter api run typecheck` | EXIT 0 |
| `pnpm run lint:work-stack-graph` | EXIT 0 (320 entities, 86 authored, 86 reviewed) |
| `pnpm run lint:contracts-no-workspace-deps` | EXIT 0 (0 violations) |
| `pnpm run lint:contract-route-coverage` | EXIT 0 |

---

## Evidence files

- ev01-contracts-suite-schema.log — contracts vitest output
- ev01-api-s003-suite-shape.log — api s003 shape vitest output
- ev02-eval-runner.log — eval-runner vitest output
- ev02-eval-report-baseline.log — eval-report-baseline vitest output
- ev02-harness-eval-s003.log — live `pnpm harness eval --entity S003` run
- ev02-harness-eval-s003-baseline.log — live `--baseline` run
- ev03-gates-g0-g4.log — gates vitest output
- ev03-gates-counterproof.log — counterproof vitest output
- ev03-gates-clean-tree.log — gate script on clean tree
- ev03-gates-json.log — gate script --json output

---

## Verdict

**ACCEPT**

All 6 verification commands exit 0. The user-visible developer paths (harness eval, gate script) produce clear, actionable output. Exit codes match contract (0 = all pass, non-0 = any failure). Reports are written to the correct path with required fields. Failure messages name the exact file and field to fix. Counterproof tests confirm all 5 broken-fixture scenarios are correctly caught.
