# #3634 — bounded GitHub label provisioning

Scope: `FetchGithubIssueCreator` label preparation only. Four workers share a 120-second batch deadline, while every lookup, create, and 422 confirmation receives the configured request deadline (10 seconds by default). The issue POST gets a fresh request deadline and is never retried automatically. With default configuration, label provisioning plus issue creation is bounded by 130 seconds, below the five-minute creation claim lease.

Failure cancels the batch signals; guards also prevent an abort-ignoring late response from advancing to another label or issue creation. Existing system labels and the draft labels are preserved. A 422 is accepted only after a successful name-matching lookup.

Validation on 2026-09-15:

- `./init.sh`: passed with network access; initial sandbox installation failed DNS resolution and was rerun without changing dependencies.
- `pnpm harness readiness`: passed with local IPC permission; this queue-external user-authorized fix is recorded on issue #3634.
- Before implementation, new virtual-clock tests: **5 failed, 1 passed**, reproducing the shared deadline and late-request problems.
- `pnpm --dir apps/api exec vitest run --config vitest.feedback-unit.config.ts`: **78/78 passed**, including 7 deadline tests, 27 existing GitHub adapter tests, 22 triage tests, 12 draft tests and 10 design-workbench tests.
- `pnpm --dir apps/api run typecheck`: exit 0.
- `pnpm --dir apps/api run lint`: exit 0 (requires local tsx IPC permission).

New virtual-clock cases cover 22 mixed labels at two seconds per request (including concurrent-create 422 confirmation), a 120-second batch limit with individually sub-deadline requests, each individual request stage timing out, and HTTP failure aborting sibling workers. Stalled fakes intentionally ignore abort to prove no late issue POST occurs. These are deterministic adapter tests with injected fetch, not live GitHub/network or browser E2E claims.

No deployment or automatic merge is performed. PR CI and independent review remain required on the submitted head.
