# Root spatial acceptance — 4adf18ab8

2026-09-27, isolated real API/PostgreSQL/MinIO/browser, single worker. Exit 0: **4 passed** (2.4m); wrapper total 2m26s and cleanup 1s.

Command: `WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=<local fixture> FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps board-spatial-relationships.spec.ts --workers=1`.

Passed: multi-select transforms, Panel clip/expand, connector preservation and z-order after reload (12.7s); locked selection transform with exact geometry and Undo (3.8s); copy/paste sanitization (2.8s); contextual controls (3.0s).

The prior random fixture role exchange is fixed by retaining the first object's canonical ID. No timeout or geometry tolerance was increased. Shared-outbox replay and full collaboration regression remain separate outstanding gates; this is not completion of the whole iteration.
