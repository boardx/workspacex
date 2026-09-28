# Root vendor schema diagnostics — 91679d216

2026-09-27. Main-session real isolated API/PostgreSQL/MinIO/browser run, exit 0: three passed (1.9m), wrapper 1m55s including 1s cleanup.

Command: `WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=<local fixture> FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config e2e/support/board-vendor-migration-fullstack.config.ts --workers=1`.

Passed schema-derived fixtures: miro-workshop (8.6s), mural-diagram (8.6s), miro-media (8.8s). Each checks import reporting/idempotency, original/reloaded owner and independent peer local object state, portable export and new-board reimport/replay, complete canonical fields with only object references rebound, and authenticated media bytes plus actual image pixels where present. Product mapImages now retains stored content instead of persisting read-time defaults; strict comparison unchanged.

These are synthetic schema diagnostics. realAccountBoards remains 0. They do not prove three captured-account migrations or large-board pagination. Successful list-reporter attachments were not preserved as standalone transport data; this record reports actual observed result and executed assertion scope.
