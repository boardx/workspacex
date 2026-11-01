/**
 * #6088 pricing design delta. Draft API contracts, not connected to runtime.
 * Existing v1 orders and callbacks keep their original contracts and snapshots.
 */
import { z } from "zod";
import { BillingProvider } from "./billing-credits";
import { MONTHLY_SUBSCRIPTION_CREDITS, SubscriptionInfo } from "./billing-subscription";

export const PricingMarket = z.enum(["cn", "us"]);
export const BillingCycle = z.enum(["month", "year"]);
export const RenewalMode = z.enum(["manual", "automatic"]);
const Identifier = z.string().min(1).max(128);
const Timestamp = z.string().datetime({ offset: true });
const AmountMinor = z.number().int().positive().safe();
const ProductBase = z.object({ sku: Identifier, currency: z.enum(["CNY", "USD"]), amountMinor: AmountMinor }).strict();
export const PricingProduct = z.discriminatedUnion("kind", [
  ProductBase.extend({ kind: z.literal("subscription"), cycle: BillingCycle, monthlyCredits: z.literal(MONTHLY_SUBSCRIPTION_CREDITS) }),
  ProductBase.extend({ kind: z.literal("credit_topup"), credits: z.union([z.literal(10000), z.literal(50000), z.literal(200000)]) }),
]);
export const PricingCatalog = z.object({
  version: Identifier, market: PricingMarket,
  enabledProviders: z.array(BillingProvider).max(2), products: z.array(PricingProduct).max(20),
}).strict().superRefine((value, ctx) => {
  const expected = value.market === "cn" ? "CNY" : "USD";
  if (value.products.some(product => product.currency !== expected)) ctx.addIssue({ code: "custom", message: "market and currency must agree" });
  if (new Set(value.products.map(product => product.sku)).size !== value.products.length) ctx.addIssue({ code: "custom", message: "duplicate product SKU" });
  if (new Set(value.enabledProviders).size !== value.enabledProviders.length) ctx.addIssue({ code: "custom", message: "duplicate payment provider" });
});

/** Caller selects a server-owned SKU; price, credit amounts and owner come from trusted state. */
export const PersonalCheckoutRequest = z.object({
  sku: Identifier, catalogVersion: Identifier, provider: BillingProvider,
  idempotencyKey: z.string().min(16).max(128),
}).strict();
export const PersonalCheckoutResult = z.object({
  purchaseRef: Identifier, url: z.string().url(), expiresAt: Timestamp,
  provider: BillingProvider, renewalMode: RenewalMode,
}).strict().superRefine((value, ctx) => {
  if (value.provider === "wechat" && value.renewalMode !== "manual") ctx.addIssue({ code: "custom", message: "WeChat purchases renew manually" });
});

export const WELCOME_CREDITS = 1000;
export const WELCOME_CREDIT_VALIDITY_DAYS = 30;
const WelcomeGrant = z.object({
  credits: z.literal(WELCOME_CREDITS), remainingCredits: z.number().finite().min(0).max(WELCOME_CREDITS).multipleOf(0.01),
  grantedAt: Timestamp, expiresAt: Timestamp,
}).strict();
export const WelcomeCreditGrant = z.object({
  status: z.enum(["none", "granted", "expired"]), grant: WelcomeGrant.nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.status === "none") !== (value.grant === null)) ctx.addIssue({ code: "custom", message: "welcome state and grant must agree" });
  if (value.grant && Date.parse(value.grant.expiresAt) - Date.parse(value.grant.grantedAt) !== WELCOME_CREDIT_VALIDITY_DAYS * 86400000) ctx.addIssue({ code: "custom", message: "welcome credits expire after 30 days" });
  if (value.status === "expired" && value.grant?.remainingCredits !== 0) ctx.addIssue({ code: "custom", message: "expired welcome credits must be zero" });
});

/** New entitlement read model composes existing subscription facts. currentPeriodEnd remains payment expiry;
 * creditGrant has the monthly credit period. No duplicate wallet or balance is introduced.
 */
export const PricingSubscriptionInfo = SubscriptionInfo.omit({ purchaseMode: true }).extend({
  currentPeriodEnd: Timestamp.nullable(), plan: z.literal("pro").nullable(), billingCycle: BillingCycle.nullable(),
  renewalMode: RenewalMode.nullable(), welcomeCreditGrant: WelcomeCreditGrant,
}).superRefine((value, ctx) => {
  if (value.plan === "pro" && (!value.billingCycle || !value.renewalMode || !value.paymentProvider || !value.currentPeriodEnd)) ctx.addIssue({ code: "custom", message: "Pro payment facts are required" });
  if (value.plan === null && (value.billingCycle !== null || value.renewalMode !== null)) ctx.addIssue({ code: "custom", message: "no plan has no billing cycle" });
  if (value.paymentProvider === "wechat" && value.renewalMode === "automatic") ctx.addIssue({ code: "custom", message: "WeChat purchases renew manually" });
  if (value.plan === "pro" && value.paymentProvider === "stripe" && value.renewalMode !== "automatic") ctx.addIssue({ code: "custom", message: "Stripe subscriptions renew automatically" });
  if (value.creditGrant?.grant && value.currentPeriodEnd && Date.parse(value.creditGrant.grant.periodEnd) > Date.parse(value.currentPeriodEnd)) ctx.addIssue({ code: "custom", message: "credit period cannot exceed paid entitlement" });
  if (value.creditGrant?.grant) {
    const days = (Date.parse(value.creditGrant.grant.periodEnd) - Date.parse(value.creditGrant.grant.periodStart)) / 86400000;
    if (days < 28 || days > 31) ctx.addIssue({ code: "custom", message: "Pro credits use one monthly period, not the payment year" });
  }
});

export const operations = {
  getPricingCatalog: { method: "GET", path: "/billing/catalog", in: z.object({}).strict(), out: PricingCatalog, err: [] as const },
  getPricingEntitlement: { method: "GET", path: "/billing/subscription/entitlement", in: z.object({}).strict(), out: PricingSubscriptionInfo, err: [] as const },
  createPersonalCheckout: {
    method: "POST", path: "/billing/checkout", in: PersonalCheckoutRequest, out: PersonalCheckoutResult,
    err: ["payment_provider_not_configured", "already_subscribed", "catalog_changed", "product_unavailable", "idempotency_conflict"] as const,
  },
} as const;

export type PricingCatalog = z.infer<typeof PricingCatalog>;
export type PersonalCheckoutRequest = z.infer<typeof PersonalCheckoutRequest>;
export type PricingSubscriptionInfo = z.infer<typeof PricingSubscriptionInfo>;
