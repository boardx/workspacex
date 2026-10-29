# Credit period ledger verification — #5995

Scope: implementation plan Task 1 only. Monthly credit batches share the existing wallet and immutable consumption ledger. API responses distinguish permanent/debt balance, monthly remainder, and expiry. Stripe grant wiring, the new admission policy, old-user backfill, and UI/query delivery remain subsequent tasks.

Baseline: origin/develop `707139c85a5799fd51250edaf2527bb9e8f40f60`; user explicitly requires first integration into develop. Reused the same session worktree.

## Observed RED → GREEN

- `red-wallet.md`: 1 failed assertion because the existing wallet lacked permanent/monthly fields.
- `red-periods.md`: 6 failed assertions because no persisted credit-period relation existed.
- `red-expiry-display.md`: a fully consumed but still active period lost its expiry date; the read projection now retains its date until actual expiry.
- `postgres.md`: final 5 files / 48 tests passed, no failures, wrapper exit 0. Includes new period tests and original wallet, consumption, and migration regressions.
- `api-typecheck.md`, `contracts-typecheck.md`, `api-lint.md`: commands exited 0. API lint includes the complete existing architecture/security chain.

Database command:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/billing/credit-periods-pg.test.ts tests/billing/credit-period-lifecycle-pg.test.ts tests/billing/wallet-ledger-query.test.ts tests/billing/credit-consumption-pg.test.ts tests/billing/schema-migration.test.ts
```

Earlier combined runs exposed fixture mistakes (multiple owners in one personal-local org, then overlength org IDs) and two stale fixture annotations. The fixtures were corrected to one personal org per owner with bounded IDs; production guards were unchanged. Earlier failures are not represented as passing verification.

The isolation wrapper released its owned database/compose scope (final database `wsx_cbbb9e54638f56531839`). No real payment, production migration, deployment or whole-project release verification is claimed. Existing phase feature status/signoffs are untouched.
