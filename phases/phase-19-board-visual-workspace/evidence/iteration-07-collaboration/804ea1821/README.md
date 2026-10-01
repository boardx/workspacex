# Root spatial acceptance — 804ea1821

Date: 2026-09-27. Root session, one Playwright worker, isolated PostgreSQL/MinIO.

Command: `WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=<local fixture> FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps board-spatial-relationships.spec.ts --workers=1`

Result: exit 1; 3 passed, 1 failed. Full isolated run 1m42s; cleanup completed.

- PASS: multi-select transform, Panel clip/expand, connector preservation, total z-order and reload (8.1s). The previous pending-sync timeout did not recur in this run; this is not a general performance guarantee.
- FAIL: selection transform locks (2.6s), fixture precondition at line 265 expected distance <= 5, received 243.5. Object identity selected by positional index is under investigation; no tolerance relaxation authorized.
- PASS: copy/paste sanitization (1.9s).
- PASS: contextual controls availability (1.9s).

API `tsc --noEmit` passed before this run. Full collaboration regression and shared-outbox acceptance remain outstanding. This evidence does not mark R7 complete.
