# Shared outbox first real run — failure before workload

2026-09-27, runtime 4adf18ab8 (subsequent 42fd7e5b1 only added evidence). Root isolated browser/API run exited 1 after 2m3s; cleanup completed.

Command: `WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=<local fixture> FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.board-shared-outbox.config.ts --workers=1`.

Failure: POST /whiteboards returned HTTP 400 before workload setup. Producer used `title`; strict CreateBoard contract requires `name`. Candidate 2696a7e0f, integrated as e3c7aeda7, uses CreateBoard.parse and records only HTTP method/pathname/status. No request headers, tokens or bodies are included in evidence. Replay/ACK/deduplication were not reached and are not considered tested. Fresh root rerun required.
