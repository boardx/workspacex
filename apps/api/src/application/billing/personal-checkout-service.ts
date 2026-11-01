import { PersonalCheckoutRequest, PersonalCheckoutResult } from "@repo/contracts/billing-pricing";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../domain/billing/personal-price-catalog";
import type { BillingConfigPort } from "./billing-config.port";
import type { PersonalCheckoutProvider, PersonalCheckoutRepository, StoredPersonalPurchase } from "./personal-checkout-ports";
import { assertSamePersonalPurchase, PersonalCheckoutError } from "./personal-checkout-error";
import { PERSONAL_CHECKOUT_RETRY_WINDOW_MS } from "../../domain/billing/personal-purchase";

export class PersonalCheckoutService {
  constructor(private readonly repository: PersonalCheckoutRepository, private readonly config: BillingConfigPort, private readonly provider: PersonalCheckoutProvider) {}
  async checkout(principal: Principal, input: unknown) {
    assertPrincipal(principal);
    const request = PersonalCheckoutRequest.parse(input);
    const existing = await this.repository.find(principal, request.idempotencyKey);
    if (existing) { assertSamePersonalPurchase(existing, request); return this.resume(principal, existing); }
    const market = this.config.getPricingMarket();
    if (market !== "cn" && market !== "us") throw new PersonalCheckoutError("dependency_unavailable");
    if (request.catalogVersion !== PERSONAL_PRICE_CATALOG_VERSION) throw new PersonalCheckoutError("catalog_changed");
    const product = PERSONAL_PRICE_CATALOG[market].find(item => item.sku === request.sku);
    if (!product || (request.provider === "wechat" && product.currency !== "CNY")) throw new PersonalCheckoutError("product_unavailable");
    if (!this.config.getPublicConfig().enabledProviders.includes(request.provider) || !this.provider.enabled(request.provider)) throw new PersonalCheckoutError("payment_provider_not_configured");
    const purchase = await this.repository.reserve(principal, request, product);
    return this.resume(principal, purchase);
  }
  private async resume(principal: Principal, purchase: StoredPersonalPurchase) {
    if (purchase.userId !== principal.userId) throw new PersonalCheckoutError("product_unavailable");
    // Terminal recovery only returns the original identity; a missing creation response cannot create a second payment.
    if(purchase.fulfilledAt||purchase.closedAt||purchase.paymentReviewRequired)return this.result(purchase);
    if (purchase.url !== null && purchase.expiresAt !== null) return this.result(purchase);
    // Stripe idempotency expires after at least 24h. Unresolved old intents never create a second payment.
    const maxAge = PERSONAL_CHECKOUT_RETRY_WINDOW_MS[purchase.provider];
    if (Date.now() - purchase.createdAt.getTime() >= maxAge) throw new PersonalCheckoutError("dependency_unavailable");
    let checkout;
    try { checkout = await this.provider.create(purchase); }
    catch { throw new PersonalCheckoutError("dependency_unavailable"); }
    const bound = await this.repository.bind(principal, purchase.purchaseRef, checkout);
    return this.result(bound);
  }
  private result(purchase: StoredPersonalPurchase) {
    const bound=purchase.url!==null&&purchase.expiresAt!==null;
    return PersonalCheckoutResult.parse({ purchaseRef: purchase.purchaseRef, url: bound?purchase.url:null, expiresAt: bound?purchase.expiresAt!.toISOString():null,
      provider: purchase.provider, renewalMode: purchase.provider === "stripe" && purchase.product.kind === "subscription" ? "automatic" : "manual" });
  }
}
