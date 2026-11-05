# CI critical-path optimization implementation plan

> For agentic workers: use superpowers:executing-plans inline, then one independent whole-branch review.

**Goal:** remove unrelated API matrix execution for proven presentation-only candidates without weakening runtime or core-loop checks.
**Architecture:** reuse the existing exact-base/head targeted UI proof in api-test-plan. Backend aggregation explicitly validates the selected route; skipped is permitted only for the unselected API matrix. Unknown inputs retain the full route. Keep all eight isolated shards for full validation rather than increasing runner contention without measurements.
**Tech stack:** Node, TypeScript AST, Vitest, GitHub Actions.
**Spec:** user-approved plan in this chat; issue #6307 and PR #6308.

## Constraints and review focus
- Reuse this worktree and PR; merge latest fetched develop before editing (done).
- No full local regression, database or Docker while the billing task owns the resource window.
- Exact SHA/base identity; failed planner, cancelled job, missing output and unexpected skip reject the route.
- Keep compilation, native lanes, runtime gates, core-loop and static cross-package lints mandatory.
- High-risk edits, mixed backend/config/test changes, changed interpolation or new keys select full.
- No branch-protection or merge-queue settings changes in this batch; no cross-SHA result reuse.

## Tasks
- [x] Add red tests for conditional backend aggregation and workflow plan/matrix wiring.
- [x] Reuse ci-targeted-ui proof in api-test-plan; skip only unrelated gates-test; validate route in ci-backend-required.
- [x] Register existing overview/public-share dictionary suites; preserve unchanged runtime expressions in dictionary comparison while allowing only top-level literal message values to vary.
- [ ] Run focused scope, backend policy, isolation and workflow checks; one independent review; update existing PR and observe remote CI.

## Ledger
- Baseline: fetched main/develop; merged origin/develop 42c2207b3 into existing branch. No new worktree.
- Decision: keep full-route shard count at eight; no duration history sufficient to safely choose a different partitioning policy. First remove the unrelated matrix from low-risk candidates.
- Baseline measurements: required checks completed approximately 25 minutes after initial checks; optional fullstack job 30m50s. Do not claim measured 30-minute merge SLO until real candidates complete.

- Verification: 100 focused scope/backend/workflow tests and 26 existing i18n frontend unit tests passed. actionlint v1.7.12 passed backend-gates.yml; no shellcheck/pyflakes executables used. Full local harness is not rerun; earlier unrelated VM timeout remains recorded on PR.
