# Root collaboration regression — 42fd7e5b1

2026-09-27. Root executed the real isolated API/PostgreSQL/MinIO/browser suite after single-worker validation optimization. Runtime baseline 42fd7e5b1; concurrent later commits only changed the separate shared-outbox test and evidence, not runtime or this suite.

Command: `WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=<local fixture> FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded --no-deps whiteboard-live.spec.ts --workers=1`.

Exit 0, six passed (2.6m), wrapper 2m38s including 1s cleanup:

- Realtime presence and field convergence: 17.2s.
- Comments anchor and ACL: 7.2s.
- Undo/offline/reconnect recovery: 6.2s.
- Multi-user undo/redo preserves other editor and survives reload: 6.8s.
- Confirmed downgrade retires offline delete/undo/redo before regrant: 6.1s.
- Structural undo/redo keeps connectors added later by another editor: 8.0s.

The four spatial scenarios also passed separately on 4adf18ab8. Shared-outbox same-browser replay and PR/CI remain separate gates. This is not full R7 completion.
