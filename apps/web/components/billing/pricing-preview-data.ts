import {TeamEntitlement,TeamQuote,TEAM_INCLUDED_SEATS,TEAM_MONTHLY_CREDITS,TEAM_SEAT_MONTHLY_CREDITS} from "@repo/contracts/billing-team";
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
 const year=cycle==="year",p=previewPrices(region);
 const createdAt=year?"2027-05-02T22:00:00Z":"2026-11-16T10:00:00Z";
 const creditPeriodStart=year?"2027-05-01T10:00:00Z":"2026-11-01T10:00:00Z";
 const creditPeriodEnd=year?"2027-06-01T10:00:00Z":"2026-12-01T10:00:00Z";
 const fraction=(Date.parse(creditPeriodEnd)-Date.parse(createdAt))/(Date.parse(creditPeriodEnd)-Date.parse(creditPeriodStart));
 const parsed=TeamQuote.parse({
  orgId:"preview-organization",generation:"pricing-preview-only",quoteRef:`preview-${region}-${cycle}-${seats}-${provider}`,
  catalogVersion:"preview-only-v1",sku:`team-${region==="us"?"us":"cn"}-${cycle}-v1`,provider,
  currency:region==="us"?"USD":"CNY",amountMinor:Math.ceil(p.seat[cycle]*100*seats*0.5),
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
   provider,renewalMode:provider==="stripe"?"automatic":"manual",cancelAtPeriodEnd:provider==="stripe"&&expired},
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
