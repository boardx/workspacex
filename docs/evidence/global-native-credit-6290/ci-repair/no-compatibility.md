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
