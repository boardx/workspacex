import type { PersonalCheckoutProvider, StoredPersonalPurchase } from "../../application/billing/personal-checkout-ports";
import type { PersonalStripeCheckoutClient } from "./personal-stripe-checkout-client";
import type { PersonalWechatPaymentClient } from "./personal-wechat-payment-client";

export class PersonalCheckoutRouter implements PersonalCheckoutProvider {
  constructor(private readonly stripe: PersonalStripeCheckoutClient, private readonly wechat: PersonalWechatPaymentClient) {}
  enabled(provider: StoredPersonalPurchase["provider"]) { return provider === "stripe" ? this.stripe.enabled() : this.wechat.enabled(); }
  async create(purchase: StoredPersonalPurchase) {
    if (purchase.provider === "wechat") return this.wechat.create(purchase);
    const session = await this.stripe.create(purchase);
    if (session.status !== "open" || typeof session.url !== "string" || typeof session.id !== "string" || typeof session.expires_at !== "number") throw Error("personal_checkout_not_payable");
    return { sessionRef: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000) };
  }
}
