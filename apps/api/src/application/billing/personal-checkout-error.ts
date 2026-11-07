import type { operations } from "@repo/contracts/billing-pricing";
import type { PersonalCheckoutRequest } from "@repo/contracts/billing-pricing";
import type { StoredPersonalPurchase } from "./personal-checkout-ports";
export type PersonalCheckoutErrorCode = typeof operations.createPersonalCheckout.err[number] | "dependency_unavailable";
export class PersonalCheckoutError extends Error {
  constructor(readonly code: PersonalCheckoutErrorCode) { super(code); }
}
export function assertSamePersonalPurchase(purchase: StoredPersonalPurchase, request: PersonalCheckoutRequest): void {
  if (purchase.product.sku !== request.sku || purchase.provider !== request.provider || purchase.catalogVersion !== request.catalogVersion) throw new PersonalCheckoutError("idempotency_conflict");
}
