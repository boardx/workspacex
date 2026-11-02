export type { PersonalPurchase } from "../../domain/billing/personal-purchase";
import type { PersonalPurchase } from "../../domain/billing/personal-purchase";
import type { PersonalCheckoutRequest } from "@repo/contracts/billing-pricing";
import type { Principal } from "../../domain/principal";

export type StoredPersonalPurchase = PersonalPurchase & Readonly<{
  idempotencyKey: string; sessionRef: string | null; url: string | null; expiresAt: Date | null;
  fulfilledAt: Date | null; closedAt: Date | null;
  paymentReviewRequired: boolean;
}>;
export type PersonalCheckoutBinding = Readonly<{ sessionRef: string; url: string; expiresAt: Date }>;
export interface PersonalCheckoutRepository {
  find(principal: Principal, key: string): Promise<StoredPersonalPurchase | null>;
  reserve(principal: Principal, request: PersonalCheckoutRequest, product: PersonalPurchase["product"]): Promise<StoredPersonalPurchase>;
  bind(principal: Principal, purchaseRef: string, result: PersonalCheckoutBinding): Promise<StoredPersonalPurchase>;
}
export interface PersonalCheckoutProvider {
  enabled(provider: PersonalPurchase["provider"]): boolean;
  create(purchase: StoredPersonalPurchase): Promise<PersonalCheckoutBinding>;
}
