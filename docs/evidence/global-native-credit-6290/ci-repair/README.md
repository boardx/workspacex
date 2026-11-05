> Superseded intermediate evidence: the initial replay repair below retained a
> compatibility view. The user subsequently instructed removal of all compatibility
> and authorized deletion of old test prices. The final migration and verification
> are described in `no-compatibility.md`; these logs record the earlier iteration.

# PR #6298 CI repair — 2026-11-05

The runtime gate force-replayed the historical consumption migration against the new
read-only compatibility view. Table RLS operations failed, and the global cutover
also attempted to create existing objects. The release simulation rejected the
new migration because its exact name was missing from the reviewed recovery suffix.

Historical replay now leaves the view alone. Global cutover only consolidates and
renames a table once, reapplies view privileges on replay, and invokes the existing
freeze-policy function so first installation and replay have identical schemas.
Regression cases preserve operator-adjusted prices and audit IDs across repeated
replay and retain the legacy-access and compatibility-write denials.

Verified locally:

- `./init.sh`: passed.
- `pnpm --filter @repo/api typecheck`: passed.
- `pnpm --filter @repo/api lint`: passed.
- `COMPOSE_PROJECT_NAME=wx6298-ci PGPORT=55439 WORKSPACEX_DB=wx6298_ci pnpm --filter @repo/api migrate:check`: 457 files rebuilt and replayed; schema and populated data digests identical (`migrate-check.log`).
- Isolated PostgreSQL `tests/billing/native-credit-tariff-pg.test.ts`: 7/7 (`tariff-pg.log`).
- `pnpm exec tsx --test tests/fixtures/cn-application-recovery/migration-scope.test.ts`: 2/2 (`migration-scope.log`).
- `python3 -m unittest discover -s tests -p test_cn_release_application_recovery_fixture.py`: 9/9 (`recovery-tests.log`).

Full Linux release simulation and all backend shards remain CI checks; these local
results do not claim those checks passed. No deployed database was changed.
