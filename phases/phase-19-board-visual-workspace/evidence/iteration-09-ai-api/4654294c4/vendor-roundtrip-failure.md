# Vendor portable roundtrip root failure — 4654294c4

2026-09-27: all three schema-derived diagnostics failed (miro-workshop, mural-diagram, miro-media). Real isolated browser/API run, exit 1, wrapper total 2m7s including cleanup. These are explicitly synthetic, not captured vendor-account acceptance.

Command: `WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=<local fixture> FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config e2e/support/board-vendor-migration-fullstack.config.ts --workers=1`.

Full canonical deep equality after portable roundtrip detected extra fields: diamond contentObject gained semanticRole=decision; image contentObject gained retryCount=0. Producer had reached portable comparison; later target-page assertions are not counted as passed. Investigation found mapImages writing parsed/default-expanded content back for every object. Fix must preserve stored fields rather than delete differences from assertions. Runtime product correction and same-scenario rerun remain required.
