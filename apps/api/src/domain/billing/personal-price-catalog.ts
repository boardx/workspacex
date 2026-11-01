import { MONTHLY_SUBSCRIPTION_CREDITS } from "@repo/contracts/billing-subscription";

/** Server price source for new personal purchases; amounts are integer minor units. */
export const PERSONAL_PRICE_CATALOG_VERSION = "pricing-2026-11-v1";
export const PERSONAL_PRICE_CATALOG = {
  cn: [
    { sku: "pro-cn-month-v1", kind: "subscription", currency: "CNY", amountMinor: 19900, cycle: "month", monthlyCredits: MONTHLY_SUBSCRIPTION_CREDITS },
    { sku: "pro-cn-year-v1", kind: "subscription", currency: "CNY", amountMinor: 199000, cycle: "year", monthlyCredits: MONTHLY_SUBSCRIPTION_CREDITS },
    { sku: "credit-cn-10000-v1", kind: "credit_topup", currency: "CNY", amountMinor: 12900, credits: 10000 },
    { sku: "credit-cn-50000-v1", kind: "credit_topup", currency: "CNY", amountMinor: 59900, credits: 50000 },
    { sku: "credit-cn-200000-v1", kind: "credit_topup", currency: "CNY", amountMinor: 219900, credits: 200000 },
  ],
  us: [
    { sku: "pro-us-month-v1", kind: "subscription", currency: "USD", amountMinor: 2900, cycle: "month", monthlyCredits: MONTHLY_SUBSCRIPTION_CREDITS },
    { sku: "pro-us-year-v1", kind: "subscription", currency: "USD", amountMinor: 29000, cycle: "year", monthlyCredits: MONTHLY_SUBSCRIPTION_CREDITS },
    { sku: "credit-us-10000-v1", kind: "credit_topup", currency: "USD", amountMinor: 1900, credits: 10000 },
    { sku: "credit-us-50000-v1", kind: "credit_topup", currency: "USD", amountMinor: 8900, credits: 50000 },
    { sku: "credit-us-200000-v1", kind: "credit_topup", currency: "USD", amountMinor: 32900, credits: 200000 },
  ],
} as const;
