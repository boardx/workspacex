# Billing overview verification — #6054

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
