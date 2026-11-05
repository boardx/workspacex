# Final implementation — no backward compatibility

The user explicitly instructed on 2026-11-05: old data is disposable test data;
do not implement compatibility. This supersedes the earlier view/archive design.

The migration drops the old organization tariff and audit tables. It creates no
view/archive or old-price consolidation path. Global prices start empty and require
operator activation. Existing configured global rows and immutable global audit
survive replay. The historical consumption migration is restored exactly.

Verification of this final implementation:

- Full `migrate:check`: 457 files rebuilt and force-replayed, schema/data digests
  identical (`no-compat-migrate.log`).
- Real PostgreSQL: native tariffs, credit consumption, organization export and
  exhaustive cross-tenant RLS suites: 4 files, 45/45 (`no-compat-tests.log`).
- API lint: exit 0.
- Independent read-only review: no actionable findings.

The unchanged export/RLS suites now pass without filtering or legacy exceptions.
Owned isolation stacks were released. CI remains the full integration gate.

## Shared-ledger regression fixture correction

The replay unit test previously executed unrelated historical consumption DDL in
an already populated current-schema database. That narrowed the ledger CHECK and
rejected valid `subscription_expire` rows from earlier tests (CI SQLSTATE 23514).
It now constructs only the obsolete tariff-table fixtures, runs the final cleanup
migration twice, and asserts an explicit newer ledger row is preserved unchanged.
Full historical replay remains covered by the independent migrate:check gate.
Native tariff and both credit-period suites passed 12/12 (`isolated-replay.log`).
Production migration SQL is unchanged by this test correction.
