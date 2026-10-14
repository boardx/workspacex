import { describe, expect, it } from "vitest";
import { billingCredits, billingSubscription } from "../../src/index";
import * as credits from "../../src/billing-credits";
import * as subscriptions from "../../src/billing-subscription";

describe("billing public contracts", () => {
  it("exports the signed operations without rebuilding a separate route model", () => {
    expect(billingCredits.operations).toBe(credits.operations);
    expect(billingSubscription.operations).toBe(subscriptions.operations);
    expect(billingCredits.operations.getBillingConfig.out).toBe(credits.BillingConfig);
  });
  it("accepts absent channels and the shared provider set, rejects secrets and unknown providers", () => {
    const schema = billingCredits.operations.getBillingConfig.out;
    expect(schema.parse({ enabledProviders: [] })).toEqual({ enabledProviders: [] });
    expect(schema.parse({ enabledProviders: billingCredits.BillingEnabledProvider.options })).toEqual({ enabledProviders: ["wechat", "stripe"] });
    expect(schema.safeParse({ enabledProviders: ["unknown"] }).success).toBe(false);
    expect(schema.safeParse({ enabledProviders: [], privateKey: "never-public" }).success).toBe(false);
  });
});
