import type { z } from "zod";
import type { BillingConfig } from "@repo/contracts/billing-credits";

export interface BillingConfigPort {
  getPublicConfig(): z.output<typeof BillingConfig>;
}
export const BILLING_CONFIG_PORT = Symbol("BillingConfigPort");
