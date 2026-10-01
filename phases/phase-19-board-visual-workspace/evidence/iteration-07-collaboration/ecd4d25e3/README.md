# Root real PostgreSQL authorization races

Tested SHA `ecd4d25e3`. Command: `PGUSER=postgres PGPASSWORD=<local-test-password> FULLSTACK_E2E_SERVER_TIMEOUT_MS=600000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.board-acl-race.config.ts`. Exit 0, 1 test passed in 27.5s; six independently asserted races.

Each operation was observed waiting on the actual revocation transaction via pg_blocking_pids before commit. Comments list/new/replay returned 404 without the comment body after member removal. Recovery read denied removed membership. Checkpoint publish denied downgrade/archive and left zero checkpoint rows. HTTP uses real seeded auth/API; direct recovery adapter uses real PostgreSQL with SET LOCAL ROLE app_rw. Local-isolation guards run before connecting. No browser UI is asserted by this API-specific lane.

Existing four browser scenarios and new structural Undo/regrant cases remain separate; this evidence does not claim all R7 requirements complete.
