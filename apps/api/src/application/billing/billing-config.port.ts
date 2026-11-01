import type { z } from "zod";
import type { BillingConfig } from "@repo/contracts/billing-credits";
import type { PricingCatalog } from "@repo/contracts/billing-pricing";

export interface BillingConfigPort {
  getPublicConfig(): z.output<typeof BillingConfig>;
  getPricingMarket(): PricingCatalog["market"] | null;
}
export const BILLING_CONFIG_PORT = Symbol("BillingConfigPort");
