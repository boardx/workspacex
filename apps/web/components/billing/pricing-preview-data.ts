import {TeamSubscriptionHistory,TeamCatalog,TeamEntitlement,TeamQuote,TEAM_INCLUDED_SEATS,TEAM_MONTHLY_CREDITS,TEAM_SEAT_MONTHLY_CREDITS} from "@repo/contracts/billing-team";
/** UI-only fixtures for #6086. Not an API contract or a production price catalog. */
export type PricingRegion = "cn" | "us" | "devapp";
export type PricingCycle = "month" | "year";
export type PricingView = "personal" | "team" | "admin";
export type PricingState = "default" | "loading" | "empty" | "invalid" | "depfail" | "denied" | "success";
export const PRICING_STATES: readonly PricingState[] = ["default", "loading", "empty", "invalid", "depfail", "denied", "success"];
export const STATE_LABELS: Record<PricingState, string> = {
  default: "默认", loading: "加载", empty: "空", invalid: "校验失败", depfail: "依赖失败", denied: "无权限", success: "成功",
};
const prices = {
  cn: { symbol: "¥", pro: { month: 199, year: 1990 }, team: { month: 999, year: 9990 }, seat: { month: 149, year: 1490 }, enterprise: 29800, packs: [129, 599, 2199] },
  us: { symbol: "$", pro: { month: 29, year: 290 }, team: { month: 149, year: 1490 }, seat: { month: 25, year: 250 }, enterprise: 6000, packs: [19, 89, 329] },
} as const;
export const PACK_CREDITS = [10000, 50000, 200000] as const;
export function previewPrices(region: PricingRegion) { return prices[region === "us" ? "us" : "cn"]; }
export function previewMoney(region: PricingRegion, value: number) {
  return `${previewPrices(region).symbol}${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
export const numberLabel = (value: number) => value.toLocaleString("en-US");

/** Owned mock quote only; production must read a server quote, never compute money here. */
export function previewSeatQuote(region:PricingRegion,cycle:PricingCycle,seats:number,provider:"wechat"|"stripe"){
 const year=cycle==="year",catalog=previewTeamCatalog(region),product=findPreviewTeamSubscription(catalog,cycle);
 if(!catalog.enabledProviders.includes(provider))throw Error("preview_payment_channel_unavailable");
 const createdAt=year?"2027-05-02T22:00:00Z":"2026-11-16T10:00:00Z";
 const creditPeriodStart=year?"2027-05-01T10:00:00Z":"2026-11-01T10:00:00Z";
 const creditPeriodEnd=year?"2027-06-01T10:00:00Z":"2026-12-01T10:00:00Z";
 const fraction=(Date.parse(creditPeriodEnd)-Date.parse(createdAt))/(Date.parse(creditPeriodEnd)-Date.parse(creditPeriodStart));
 const parsed=TeamQuote.parse({
  orgId:catalog.orgId,generation:"pricing-preview-only",quoteRef:`preview-${region}-${cycle}-${seats}-${provider}`,
  catalogVersion:catalog.version,sku:product.sku,provider,
  currency:product.currency,amountMinor:Math.ceil(product.additionalSeatAmountMinor*seats*0.5),
  createdAt,expiresAt:new Date(Date.parse(createdAt)+300000).toISOString(),purpose:"add_seats",planVersion:1,
  term:{purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",
   paidPeriodEnd:year?"2027-11-01T10:00:00Z":"2026-12-01T10:00:00Z",billingCycle:cycle,
   purchasedSeats:TEAM_INCLUDED_SEATS,monthlyCredits:TEAM_MONTHLY_CREDITS},additionalSeats:seats,
  monthlyCreditsAfter:TEAM_MONTHLY_CREDITS+seats*TEAM_SEAT_MONTHLY_CREDITS,
  estimatedFirstCredits:Math.floor(TEAM_SEAT_MONTHLY_CREDITS*seats*fraction*100)/100,creditPeriodStart,creditPeriodEnd,
 });
 if(parsed.purpose!=="add_seats")throw Error("preview_seat_quote_required");
 return parsed;
}

/** UI-only account facts. Licensing status does not bypass membership or AI/credit policy. */
export function previewTeamEntitlement(region:PricingRegion,cycle:PricingCycle,expired:boolean){
 const year=cycle==="year",provider=region==="us"?"stripe":"wechat";
 const paidPeriodStart=expired?(year?"2025-10-31T10:00:00Z":"2026-09-30T10:00:00Z"):"2026-11-01T10:00:00Z";
 const paidPeriodEnd=expired?"2026-10-31T10:00:00Z":year?"2027-11-01T10:00:00Z":"2026-12-01T10:00:00Z";
 const periodStart=expired?"2026-09-30T10:00:00Z":"2026-11-01T10:00:00Z",periodEnd=expired?"2026-10-31T10:00:00Z":"2026-12-01T10:00:00Z";
 const remainingCredits=expired?0:64000,asOf="2026-11-16T10:00:00Z";
 const parsed=TeamEntitlement.parse({
  orgId:"preview-organization",generation:"pricing-preview-only",planVersion:1,asOf,
  licenseStatus:expired?"expired":"active",memberCount:4,
  teamPayment:{term:{purchaseAnchor:expired&&!year?"2026-08-31T10:00:00Z":paidPeriodStart,
   paidPeriodStart,paidPeriodEnd,billingCycle:cycle,purchasedSeats:TEAM_INCLUDED_SEATS,monthlyCredits:TEAM_MONTHLY_CREDITS},
   provider,renewalMode:provider==="stripe"?"automatic":"manual",cancelAtPeriodEnd:false,subscriptionStatus:provider==="stripe"?(expired?"canceled":"active"):null},
  creditGrant:{status:expired?"expired":"granted",grant:{credits:TEAM_MONTHLY_CREDITS,remainingCredits,periodStart,periodEnd}},
  wallet:{ownerType:"team",ownerId:"preview-organization",balance:8600+remainingCredits,permanentBalance:8600,
   subscriptionCredits:remainingCredits,subscriptionExpiresAt:expired?null:periodEnd,totalPurchased:10000,
   totalGranted:expired&&year?TEAM_MONTHLY_CREDITS*12:TEAM_MONTHLY_CREDITS,updatedAt:asOf},
  checkoutPending:false,paymentReviewRequired:false,
 });
 const payment=parsed.teamPayment,grant=parsed.creditGrant.grant;
 if(!payment||!grant)throw Error("preview_paid_team_facts_required");
 return {...parsed,teamPayment:payment,creditGrant:{...parsed.creditGrant,grant}};
}

/** Preview-only projection of the same price fixture; no second production price list. */
export function previewTeamCatalog(region:PricingRegion){
 const p=previewPrices(region),market=region==="us"?"us":"cn",currency=market==="us"?"USD":"CNY";
 return TeamCatalog.parse({orgId:"preview-organization",version:"preview-only-v1",market,
  enabledProviders:region==="devapp"?["wechat","stripe"]:region==="us"?["stripe"]:["wechat"],
  products:[...(["month","year"] as const).map(cycle=>({
   sku:`team-${market}-${cycle}-v1`,kind:"subscription",currency,cycle,amountMinor:p.team[cycle]*100,
   includedSeats:TEAM_INCLUDED_SEATS,monthlyCredits:TEAM_MONTHLY_CREDITS,
   additionalSeatAmountMinor:p.seat[cycle]*100,additionalSeatMonthlyCredits:TEAM_SEAT_MONTHLY_CREDITS,
  })),...PACK_CREDITS.map((credits,index)=>({sku:`credit-${market}-${credits}-v1`,kind:"credit_topup",currency,credits,amountMinor:p.packs[index]!*100}))],
 });
}
function findPreviewTeamSubscription(catalog:TeamCatalog,cycle:PricingCycle){
 const product=catalog.products.find(product=>product.kind==="subscription"&&product.cycle===cycle);
 if(!product||product.kind!=="subscription")throw Error("preview_team_product_required");
 return product;
}
export function previewTeamSubscription(region:PricingRegion,cycle:PricingCycle){
 return findPreviewTeamSubscription(previewTeamCatalog(region),cycle);
}

/** One fixture payment row, not one row per scheduled monthly credit grant. */
export function previewTeamSubscriptionHistory(region:PricingRegion,cycle:PricingCycle,expired:boolean){
 const facts=previewTeamEntitlement(region,cycle,expired),term=facts.teamPayment.term,product=previewTeamSubscription(region,cycle);
 const ref=`preview-team-${region}-${cycle}-${expired?"expired":"active"}`;
 return TeamSubscriptionHistory.parse({orgId:facts.orgId,generation:facts.generation,asOf:facts.asOf,
  items:[{purchaseRef:ref,receiptRef:`receipt-${ref}`,purpose:term.purchaseAnchor===term.paidPeriodStart?"initial":"renewal",
   sku:product.sku,provider:facts.teamPayment.provider,currency:product.currency,amountMinor:product.amountMinor,
   paidAt:term.paidPeriodStart,paidTerm:term,additionalSeats:null}],nextCursor:null,
 });
}
