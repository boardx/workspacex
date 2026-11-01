import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  include: ["tests/billing/personal-payment-reconciler.test.ts","tests/billing/personal-wechat-payment.test.ts","tests/billing/global-error-boundary.test.ts","tests/billing/personal-checkout-service.test.ts","tests/billing/personal-stripe-receipt.test.ts","tests/billing/personal-stripe-checkout.test.ts","tests/billing/welcome-schema-source.test.ts","tests/billing/personal-credit-period-worker.test.ts","tests/billing/personal-credit-calendar.test.ts","tests/billing/pricing-topup-market.test.ts","tests/billing/pricing-package-source.test.ts","tests/billing/pricing-catalog.test.ts","tests/billing/provider-switches.test.ts","tests/billing/monthly-checkout-client.test.ts","tests/billing/stripe-credit-client.test.ts","tests/billing/wechat-monthly-client.test.ts"], maxWorkers: 1, minWorkers: 1,
} });
