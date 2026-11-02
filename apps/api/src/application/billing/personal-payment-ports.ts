/** Internal only: authenticated provider reads establish these facts, never an HTTP purchase body. */
export type VerifiedPersonalReceipt = Readonly<{
  purchaseRef: string; provider: "wechat" | "stripe"; paymentRef: string;
  amountMinor: number; currency: string; paidAt: Date | null;
}>;
import type { PersonalStripeBinding, verifiedPersonalStripeTerm } from "../../domain/billing/personal-stripe-receipt";
export type VerifiedStripePersonalPayment = Readonly<{
  binding: PersonalStripeBinding; term: ReturnType<typeof verifiedPersonalStripeTerm>; paidAt: Date | null;
}>;
