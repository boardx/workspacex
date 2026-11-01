import type { z } from "zod";
import type { PricingProduct } from "@repo/contracts/billing-pricing";
export const PERSONAL_WECHAT_PAYMENT_TTL_MS = 15 * 60_000;
export const PERSONAL_CHECKOUT_RETRY_WINDOW_MS = Object.freeze({ stripe: 23 * 3_600_000, wechat: PERSONAL_WECHAT_PAYMENT_TTL_MS });

/** Immutable quote persisted before the first provider request. */
export type PersonalPurchase = Readonly<{
  purchaseRef: string; userId: string; provider: "stripe" | "wechat";
  generation: string; catalogVersion: string; product: z.infer<typeof PricingProduct>; createdAt: Date;
}>;
