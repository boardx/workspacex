# Root retention / manifest recovery acceptance

Tested SHA `16da83132`. Root ran the isolated API/PostgreSQL/FS lane, exit 0 in 1.5 minutes. The Playwright wrapper executed the four real Vitest maintenance cases and required both metadata-only evidence records. No browser UI or production data was used.

Command: `PGUSER=postgres PGPASSWORD=<local-test-password> FULLSTACK_E2E_SERVER_TIMEOUT_MS=600000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.board-maintenance.config.ts`.

Proved: retention/dry-run/replay and fresh revoked authority; independent backup pins; live document/comment/update/active asset-root preservation; real mark/sweep physically deletes only the eligible orphan; restore from archive still works after pins release; corrupt archive and preparing restore reject release; missing primary snapshot is repaired without PG body bytes or revision change; concurrent canonical edit prevents stale repair publication. Historical ages are fixture timestamps, not a claim of elapsed real retention time.

Format scope: same-revision FS manifest v1 repair. Unknown-format downgrade remains rejected. This does not prove arbitrary old-version binary rollback or all R8/R10 acceptance.
