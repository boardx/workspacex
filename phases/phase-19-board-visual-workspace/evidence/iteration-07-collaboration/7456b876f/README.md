# R7 collaboration acceptance

Runtime SHA: `7456b876fd22adbade3dec9c135fbd3a5662453d`. Main session executed the isolated real PostgreSQL/Redis/API/Next/browser stack on 2026-09-27. Result: **6 passed (6.1m)**, exit 0, isolated stack cleanup completed.

Command: `PGUSER=postgres PGPASSWORD=postgres_dev FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded --no-deps whiteboard-live.spec.ts --workers=1`.

Scenarios are listed in result.json. They include named mentions and remote comments, ACL denial, recovery, multi-user text history, persisted offline draft retirement after downgrade/regrant, and preservation of peer-created connectors during structural undo/redo. The earlier run failed because dismissing the mention list shifted the publish button between pointer down/up; this rerun uses normal browser clicks with the fixed overlay.

This does not establish 50-client load, 30-minute room reliability, all-object undo coverage, visual 9/10, or deployment on devapp. Six independent PG permission races are recorded under ../ecd4d25e3.
