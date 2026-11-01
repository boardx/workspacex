import type { z } from "zod";
import type { PricingProduct } from "@repo/contracts/billing-pricing";

/** Immutable quote persisted before the first provider request. */
export type PersonalPurchase = Readonly<{
  purchaseRef: string; userId: string; provider: "stripe" | "wechat";
  generation: string; catalogVersion: string; product: z.infer<typeof PricingProduct>; createdAt: Date;
}>;
