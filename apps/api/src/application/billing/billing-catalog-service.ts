import { PricingCatalog, type PricingCatalog as CatalogView } from "@repo/contracts/billing-pricing";
import { assertPrincipal, type Principal } from "../../domain/principal";
import type {BillingCatalogReader} from "./billing-catalog-reader";
import type { BillingConfigPort } from "./billing-config.port";

export interface BillingCatalogConfig extends BillingConfigPort {
  getPricingMarket(): CatalogView["market"] | null;
}
export class BillingCatalogUnavailableError extends Error {
  constructor() { super("billing_catalog_unavailable"); }
}
export class BillingCatalogService {
  constructor(private readonly config: BillingCatalogConfig,private readonly reader:BillingCatalogReader) {}
  async catalog(principal: Principal): Promise<CatalogView> {
    assertPrincipal(principal);
    const market = this.config.getPricingMarket();
    if (!market) throw new BillingCatalogUnavailableError();
    try {
      const stored=await this.reader.read(principal,market);
      return PricingCatalog.parse({...stored,market,enabledProviders:this.config.getPublicConfig().enabledProviders});
    } catch { throw new BillingCatalogUnavailableError(); }
  }
}
