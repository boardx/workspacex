Review4184935085/5100: partial or failed-task provenance now blocks publication readiness, and old partial drafts are archived before resetting the flag; generation cannot overwrite their original partial history. RED3failed21passed; GREEN498researchtests21files. Original quality/completion/checkpoint assertions retained. Actualgates2run37321019336 repeated the PG snapshot truncation failure already fixed in PR5395 commit80d4c26c1; the identical shared snapshot fix/regression is applied here. Real isolated PostgreSQL12passed with owned cleanup0s; APItypecheck/officiallint exit0; independent review ACCEPT. Logs and hashes retained. No online session/model/deployment/performance acceptance claimed.

Reproduce:
```sh
pnpm --filter api exec vitest run --config vitest.research-unit.config.ts
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/auth/ai-usage-repository.test.ts
pnpm --filter api exec tsc --noEmit
pnpm --filter api lint
```
