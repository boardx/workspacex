import {TeamProduct} from "@repo/contracts/billing-team";
import type {ProductConfigurationRow} from "./product-catalog-configuration";
/** Same configured rows and catalog fingerprint as personal; no second price source. */
export function teamConfiguredProducts(rows:ProductConfigurationRow[]){
 return rows.filter(row=>row.owner_type!=="user").sort((a,b)=>a.sort_order-b.sort_order||a.package_id.localeCompare(b.package_id)).map(row=>{
  const base={sku:row.package_id,currency:row.currency,amountMinor:row.amount_fen};
  return TeamProduct.parse(row.product_kind==="subscription"?{...base,kind:"subscription",cycle:row.billing_cycle,includedSeats:row.included_seats,monthlyCredits:row.total_credits,additionalSeatAmountMinor:row.extra_seat_amount_fen,additionalSeatMonthlyCredits:row.extra_seat_monthly_credits}:{...base,kind:"credit_topup",credits:row.total_credits});
 });
}
