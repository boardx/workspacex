# Research simplification verification — 2026-09-30

Tracking: #4785. Base: 4b957826d. Existing worktree reused. Coordinator gateway
explicitly waived by the user. No production mutation or autonomous merge.

## Executed checks

- `./init.sh`: exit 0 at start.
- `pnpm --filter web exec vitest run tests/ui/guided-research*.test.tsx tests/ui/research*.test.tsx`
  (run from apps/web without the filter): 36 files, 316 tests passed, 56.58s.
- `pnpm --filter web exec vitest run tests/ui/research-report-export.test.tsx`:
  4 tests passed after adding prefixed document regression.
- `pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts`:
  5 files, 121 tests passed, 3.78s. Includes bounded concurrency, durable source
  reads, summary contract roundtrip, permanent failures and resumed persistence.
- `pnpm --filter web typecheck` and `pnpm --filter @repo/api typecheck`: exit 0.
- `pnpm --filter web lint`: exit 0 (ESLint, token scope, design lint).
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import guided-research-runtime.spec.ts`:
  1 test passed, test execution 1.9m, total including build 11.6m.
  Real browser -> API -> isolated PostgreSQL; plan editing and reload, research
  sources and mobile layout, streamed report reload without replay, chapter route,
  saved report and exports. Provider responses use the repository loopback fixture,
  not a live external model. No claim of live provider relevance or production acceptance.
- Main agent visually inspected generated plan, chapter editor and mobile source
  screenshots. Single numbering, no Markdown editor, no source separators/read pills.
- Independent read-only review found no critical/important defects. Its prefixed
  export directory finding was reproduced and fixed with the extra export test.

## Baseline limitation

Review follow-up on 2026-10-01: two failing regressions confirmed newly added plan
and chapter questions were fixed placeholders. The shared save preparation now
derives questions from final titles for new items only. Fresh UI: 319/319 passed
across 36 files, 15s; web typecheck and lint passed. Initial PR head 9390c9c42
passed all cloud checks; the review correction requires fresh exact-head CI.

`pnpm -w run verify:base` stops at `lint:oss-secret-scan`, before the full suite:
existing assigned-secret findings in
`apps/api/tests/whiteboard/joint-drill-diagnostics.test.ts` and
`apps/api/tests/workflow/trigger-pgboss-webhook.test.ts`. Neither file was changed
by this task (`git diff -- <both paths>` empty). No credential values are recorded.
The global base suite is NOT claimed green; affected checks above are green.

## Resource cleanup

Isolation wrapper completed cleanup in 3s. `docker ps` filtered to this run's compose
project `wsx-d9c7d98fbbe4aa84e518` returned no containers. The main checkout's
unrelated changes were preserved. PR CI and review remain the release gate.
