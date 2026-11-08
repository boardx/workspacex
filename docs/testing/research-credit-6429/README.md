# Research Credit finalization — #6429

A real `CreditConsumptionError` escaped the research service before its final write, leaving the persisted runtime busy with a ten-minute lease. A separate controlled source-screening counterexample showed the same typed refusal being converted to recoverable search failure and dispatched through supplemental queries.

The service now persists the failed outcome, busy=false, leaseUntil=null and request done through the existing request-ID/version-fenced store before rethrowing the original typed exception. If final persistence fails, that failure wins. Search classification propagates Credit before recovery. No payer selection, accounting settlement, quota, production data or provider policy changes.

Optional nullable `creditFailure` reuses the canonical billing contract and owned-run projection. GET, replay, steering and SSE pass through the central viewer projection before progress/patch/compact-plan construction. Personal payer scope is null for another viewer; the durable owner guidance is retained. New claims clear old guidance. UI reuses the existing shared personal/team/monthly/outage messages and never submits work on reload or recharge navigation.

## Evidence

- `lease-red.txt`: actual original service + typed error + clone-persisting store, busy assertion fails after refusal. Temporary fixture, not another checkout.
- `screening-red.txt`: 16 pass, one actual failure before task classifier repair: typed refusal resolves as search failure with supplemental attempts instead of rejecting.
- `research-green.txt`: 41 files / 948 pass after terminal/projection/stream changes, before the final task-classifier line.
- `targeted-green.txt`: final classifier change, seven affected orchestration/search/delta/composite suites / 201 pass, including 17 Credit tests and both RED counterexamples.
- `web-green.txt`: two files / 36 pass; remount guidance across five payer/reason conditions, no command dispatch, progress/patch clearing of previous scope.
- `postgres-green.txt`: real isolated PostgreSQL / four pass. Two actual service refusals followed by new store/service replay; request-ID and version fences independently reject stale cleanup, preserving newer busy lease and undone request. Peak connections=3; wrapper cleanup=3s.

Controller tests call the real controller/service with an in-memory store and a stubbed session lookup; they are not HTTP authentication acceptance. PostgreSQL tests use the actual SQL store and isolated tenant role. All model errors are controlled typed injections; no production or successful real-model generation is claimed.

Commands from the repository root:

```sh
pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts
pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts tests/research/guided-credit-finalization.test.ts tests/research/guided-runtime-orchestration.test.ts tests/research/guided-progressive-candidates.test.ts tests/research/guided-negative-screen-cache-pipeline.test.ts tests/research/guided-search-recovery.test.ts tests/research/guided-runtime-delta.test.ts tests/research/guided-three-step.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-live.test.tsx tests/ui/guided-research-progress.test.ts --maxWorkers=1 --minWorkers=1
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/research/guided-credit-finalization.db.test.ts
```

A standalone typecheck and an initial full research run were deliberately stopped during host load pressure; neither is counted as a pass. Standard push hooks and CI remain required. Prior baseline quick-suite PostgreSQL-disconnect/supervisor failures are documented by #6428 and are not silently reclassified as fixed here.

Production research `grs_77ebcd8398174df38078d632b7aa09e9` had unavailable/unknown progress during the seven-category retest, but its exact remote cause is unproven. Other real production model tasks were blocked by personal Credit. This patch does not repair old busy records unconditionally, fund accounts, deploy code, or establish positive production generation acceptance.
