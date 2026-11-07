import type {PricingCatalog} from "@repo/contracts/billing-pricing";
import type {Principal} from "../../domain/principal";
export type ConfiguredPersonalCatalog=Pick<PricingCatalog,"version"|"products">;
export interface BillingCatalogReader {
 read(principal:Principal,market:PricingCatalog["market"]):Promise<ConfiguredPersonalCatalog>;
}
