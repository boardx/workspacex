# Feedback inbox tag disclosure (#3633)

The shared `applyTags` preserves the existing D3 result (`body === null` means withheld feedback). It clears tags before list filtering and byTag aggregation, without introducing a new role decision or changing the sole `inbox_item_tags` store. Design and exception projections retain their existing behavior.

## Verification

- `./init.sh`: default quick dependency health succeeded (not `--full`). `pnpm harness readiness` completed; issue comment records user-authorized queue exception.
- `pnpm --filter @repo/api exec vitest run --config vitest.inbox-unit.config.ts`: before fix, three regressions failed (list, private tag filter, shared/private tag counts); after fix, 62/62 passed. Includes archived view, submitter/admin access, non-member rejection before reading tags, existing design/exception cases. `red.txt` and `green.txt` contain actual output.
- `pnpm --filter @repo/api typecheck`: passed (`typecheck.txt`).
- `pnpm --filter @repo/api lint`: passed (`lint.txt`). First sandbox attempt failed because tsx IPC was blocked; the documented passing run used normal escalation.

The unit lane contains only existing in-memory inbox application/repository guard tests; real database tests retain the canonical isolated lane. No frontend layout or browser behavior was changed.

## PostgreSQL environment limitation

`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/feedback/product-feedback-persistence.test.ts` was admitted, but Docker's `compose exec ... pg_isready` never returned, and an independent scoped `docker ps` inspection also hung. The owned CLI processes were canceled. `postgres.txt` is an incomplete run log, **not a passing database result**. The new test uses real `PgProductFeedbackRepository` and `PgInboxTagRepository` through listInbox/getInboxCounts, including two populated organization tag maps with the same item ID. It must pass in canonical CI before delivery.

`cleanup.txt` records the bounded cleanup attempt for owned compose project `wsx-b73871b27e9e945052c4`; daemon unavailability prevents confirming container state. No shared Docker restart or other task's stack cleanup was attempted.
