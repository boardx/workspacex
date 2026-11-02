import type {PricingCatalog} from "@repo/contracts/billing-pricing";
import type {BillingCatalogReader} from "../../application/billing/billing-catalog-reader";
import type {DatabasePort} from "../../application/ports/database.port";
import type {Principal} from "../../domain/principal";
import {readProductConfiguration,personalConfiguredProducts} from "./product-catalog-configuration";
export class PgBillingCatalogRepository implements BillingCatalogReader {
 constructor(private readonly db:DatabasePort){}
 read(principal:Principal,market:PricingCatalog["market"]){return this.db.withTenant(principal.orgId,async s=>{
  const configured=await readProductConfiguration(s,market);
  return {version:configured.version,products:personalConfiguredProducts(configured.rows)};
 });}
}
