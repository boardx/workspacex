# Billing overview verification — #6054

## Review follow-up: canceled legacy history
PR review identified that canceling a legacy subscription removed its history fallback. Added a real PostgreSQL regression for active-to-canceled continuity, known start/end preservation, unknown fees, owner isolation and incomplete/incomplete_expired exclusion. The regression first failed because canceled history was empty; after including canceled snapshots and reading the known period start, all 58 API tests passed across subscription-history/monthly-pass/subscription-links. Existing incomplete purchases remain excluded. No entitlement or payment write behavior changed.

Confirmed design: `docs/superpowers/specs/2026-10-31-billing-overview-design.md`.
Base: develop `4d3bebf8db27348cbd9257fcdf7522d48f42eab0`. User confirmed implementation on 2026-10-31.

## Passed verification
- API real PostgreSQL + HTTP: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/billing/subscription-history.test.ts tests/billing/monthly-pass.test.ts tests/billing/subscription-links.test.ts --maxWorkers=1 --minWorkers=1` — 55 passed. Covers principal isolation, pagination, unknown fees, deduplicated settled periods, verified amount snapshots, unauthenticated requests, forged-owner rejection, payment lifecycle regression.
- Web components: `pnpm --filter web exec vitest run tests/ui/billing-overview-history.test.tsx tests/ui/billing-overview.test.tsx tests/ui/billing-subscription-live.test.tsx tests/ui/monthly-pass-live.test.tsx tests/ui/billing-cashier.test.tsx --maxWorkers=1 --minWorkers=1` — 92 passed. Includes 100 permanent + 15,000 subscription credits => left100/right75%, history pagination and failure states.
- Contracts: `pnpm --filter @repo/contracts exec vitest run tests/billing-subscription.test.ts tests/billing/billing-operations-export.test.ts` — 12 passed.
- API, web, contracts `typecheck` all passed; API/web `lint` passed.
- Browser: `NEXT_PUBLIC_API_URL=http://localhost:3197/api pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test e2e/billing-subscription-live.spec.ts --project=chromium` — passed. Actual production React page, controlled HTTP/provider-page fixtures; purchase/reload/paid return/expiry/failure plus375/768/1280 widths, no page horizontal overflow. Screenshots under browser/. Not a real merchant settlement claim.
- Red-to-green: new frontend tests first failed for missing progress/history and mixed balance; initial isolated PG history fixture failed for missing amount snapshot columns. After implementation both passed. First browser attempt used defaultAPI3200 while fixtures targeted3197; rerun with explicit same-originAPI3197 passed.

## Operational boundary
New additive migration `20261031150000_billing_subscription_amount_snapshot.sql` is required before runtime update. Existing amounts remain unknown/null; no backfill with current price. This change does not execute production SQL, charge a customer or publish to CN/US.

`harness readiness` ran. `harness tick` could not obtain an authoritative clock because COORD_GATEWAY_URL is unconfigured; user previously explicitly skipped agent identity. No authority state or passing flag was fabricated.

Independent review caught history pagination retained on identity change. Added failing account-switch regression, keyed history by userId/sessionToken; regression passed after fix.

Cashier browser regression: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.billing-cashier.config.ts` — 1 passed (three widths, keyboard/QR/payment polling/ledger and unified personal menu). Screenshots copied under browser/cashier-*.png. Desktop and mobile overview screenshots inspected visually.

Final exact-SHA review additionally caught sibling React keys sharing the same identity value. Added subscription:/history: key namespaces; all 92 UI regressions passed again without duplicate-key warnings.

CI control-plane check reproduced a missing same-origin history rewrite (would return 404). Added the exact /billing/subscription/history proxy rule. rewrite-coverage, contract-route-coverage, ui-wiring, contract-negative-assertion, body-path-param-leak and e2e-testid-gate passed. Subscription browser regression rerun passed.

CI integration follow-up: adapted real billing browser tests to the unified purchase entry, Pro status and subscription progress value; seeded the companion subscription snapshot in the grant-helper fixture. No DB/payment assertions removed. Full isolated real Next/API/PostgreSQL + signed loopback merchant regression: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run --config vitest.billing-cashier.config.ts` — 11/11 passed (2 files). Includes WeChat, Stripe, duplicate callbacks, consumption, expiry, personal/enterprise debt and self usage. Billing HTTP was not intercepted; no real money charged.

Simulation failures both traced to UNREVIEWED_MIGRATION_SUFFIX. Added only this additive SQL to reviewedSuffix; migration-scope tests 2/2 and global-scope-fixture lint passed. API typecheck passed. Initial local attempts were interrupted/stalled by owned Next processes; final clean isolated 11/11 run took 1m42s and cleaned up.
