# #6268 verification log

No deployment or global production activation is claimed.

1. Initial targeted service/repository tests: 7 passed. Initial isolated PostgreSQL batch: credit-consumption16 passed, payer-fallback10 passed, global4 passed/1 failed. Failure was fixture updating total_credits without base_credits, rejected by existing catalog constraint. Test corrected to update both; snapshot/debit assertions retained. Scope wsx-f68313a4ea80ad00dd3a cleaned by wrapper finally; docker ps for project empty.
2. After DB constraints/lifecycle review: targeted service/repository9 passed, including actual Nest context close. Isolated global PG4 passed/1 failed: fixture omitted nativeUsage.source=reported, correctly retaining unknown hold. Corrected to match real image accounting receipts (quantity1/source reported, tokensTotal0/totalSource not-applicable), preserving settled, old-rate and exactly-one-ledger assertions. Scope wsx-8125a3ce6c7c80284524 cleaned by wrapper finally; docker ps for project empty.
3. Final isolated global PostgreSQL rerun: 6/6 passed (39.18s), including direct writer authentication, both membership directions denied, database constraint counterexamples and old-rate settlement with exactly one debit. Scope wsx-c9484ea1c49cf2ee1e16 cleaned by wrapper finally; docker ps for project empty. API typecheck and contracts typecheck both exited0 afterward. Earlier failed batches did not run typecheck; those failures remain recorded above.

Commands: `pnpm --filter @repo/api exec vitest run --config vitest.image.config.ts tests/agent-runtime/global-image-tariff-service.test.ts tests/agent-runtime/global-image-tariff-repository.test.ts`; `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/billing/global-image-tariff-pg.test.ts`; `pnpm --filter @repo/api typecheck`; `pnpm --filter @repo/contracts typecheck`. Normal pre-push lint and CI are still pending.

Tests do not issue supplier requests or modify production data. Temporary provisioning password is an isolated fixture. Dedicated role connection uses actual username/password, not owner SET ROLE.
