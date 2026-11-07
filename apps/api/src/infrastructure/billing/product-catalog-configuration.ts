import {createHash} from "node:crypto";
import {PricingProduct,type PricingCatalog} from "@repo/contracts/billing-pricing";
import type {TenantSession} from "../../application/ports/database.port";
export type ProductConfigurationRow={package_id:string;region:string;currency:string;amount_fen:number;total_credits:number;owner_type:"user"|"team"|"both";product_kind:"credit_topup"|"subscription";billing_cycle:"month"|"year"|null;included_seats:number|null;extra_seat_amount_fen:number|null;extra_seat_monthly_credits:number|null;sort_order:number};
const columns="package_id,region,currency,amount_fen,total_credits,owner_type,product_kind,billing_cycle,included_seats,extra_seat_amount_fen,extra_seat_monthly_credits,sort_order";
const select=`SELECT ${columns} FROM credit_packages WHERE enabled=true AND region=$1 AND product_kind IN ('credit_topup','subscription') ORDER BY package_id`;
export const PRODUCT_CONFIGURATION_SQL=Object.freeze({read:select});
/** One MVCC statement supplies both fingerprint and immutable order facts.
 * Checkout linearizes at this read; the application retains SELECT-only catalog access. */
export async function readProductConfiguration(s:TenantSession,market:PricingCatalog["market"]){
 const rows=(await s.query<ProductConfigurationRow>(PRODUCT_CONFIGURATION_SQL.read,[market])).rows;
 if(!rows.length)throw Error("billing_catalog_unavailable");
 if(rows.some(row=>row.region!==market||row.currency!==(market==="cn"?"CNY":"USD")))throw Error("billing_catalog_invalid");
 const facts=rows.map(({sort_order:_,...row})=>row);
 const version=`catalog-${market}-${createHash("sha256").update(JSON.stringify(facts)).digest("hex")}`;
 return {version,rows};
}
export function personalConfiguredProducts(rows:ProductConfigurationRow[]){
 return rows.filter(row=>row.owner_type!=="team").sort((a,b)=>(a.product_kind==="subscription"?0:1)-(b.product_kind==="subscription"?0:1)||a.sort_order-b.sort_order||a.package_id.localeCompare(b.package_id)).map(row=>{
  if(row.included_seats!==null||row.extra_seat_amount_fen!==null||row.extra_seat_monthly_credits!==null)throw Error("billing_catalog_invalid");
  const base={sku:row.package_id,currency:row.currency,amountMinor:row.amount_fen};
  return PricingProduct.parse(row.product_kind==="subscription"?{...base,kind:"subscription",cycle:row.billing_cycle,monthlyCredits:row.total_credits}:{...base,kind:"credit_topup",credits:row.total_credits});
 });
}
