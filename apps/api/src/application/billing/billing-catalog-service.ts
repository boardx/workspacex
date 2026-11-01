import { PricingCatalog, type PricingCatalog as CatalogView } from "@repo/contracts/billing-pricing";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../domain/billing/personal-price-catalog";
import type { BillingConfigPort } from "./billing-config.port";

export interface BillingCatalogConfig extends BillingConfigPort {
  getPricingMarket(): CatalogView["market"] | null;
}
export class BillingCatalogUnavailableError extends Error {
  constructor() { super("billing_catalog_unavailable"); }
}
export class BillingCatalogService {
  constructor(private readonly config: BillingCatalogConfig) {}
  catalog(principal: Principal): CatalogView {
    assertPrincipal(principal);
    const market = this.config.getPricingMarket();
    if (!market) throw new BillingCatalogUnavailableError();
    return PricingCatalog.parse({
      version: PERSONAL_PRICE_CATALOG_VERSION, market,
      enabledProviders: this.config.getPublicConfig().enabledProviders,
      products: PERSONAL_PRICE_CATALOG[market],
    });
  }
}
