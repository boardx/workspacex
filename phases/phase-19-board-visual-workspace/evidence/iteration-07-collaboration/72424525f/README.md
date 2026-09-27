# Root shared-outbox acceptance — 72424525f

2026-09-27. Main session, real isolated API/PostgreSQL/MinIO and two tabs sharing one browser storage context. Exit 0: one test passed, workload 11.8s; full wrapper 2m14s including 1s cleanup. Later 7ebafd076 only adds previous suite evidence.

Command: `WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=<local fixture> FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.board-shared-outbox.config.ts --workers=1`.

Assertions passed: original has pending durable operations before peer opens; both tabs send actual identical update IDs; both acknowledge identical sequence numbers; final checkpoint sequence delta equals unique operation count; all eight panel IDs/geometry/text converge; both reload and checkpoint sequence remains unchanged. Metadata recorder drops zero events. The bounded queue-drain limit is 45s; this is not a 5s interactive-latency benchmark.

Successful run used the list reporter; in-memory attachment was not persisted as a standalone file. This document records observed exit/test output and executed assertion scope, not a fabricated raw transport capture. Raw persistent transport evidence can be produced by a later JSON-reporter run if required.
