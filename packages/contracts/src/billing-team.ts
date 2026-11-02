/**
 * Proposed Team / Enterprise contract design material, issue #6099.
 * Authority: phases/phase-21-billing-payment/design-deltas/team-enterprise-v1/.
 * Human signoff remains pending. These schemas do not register a runtime route,
 * grant permission, activate billing or decide remaining prepaid credit treatment.
 */
import {z} from "zod";
import {BillingProvider,CreditBalance,CreditLedgerAmount} from "./billing-credits";
import {BillingCycle,PricingCurrency,PricingProduct,RenewalMode} from "./billing-pricing";
import {operations as PlatformOrganizations} from "./platform-organizations";

export const TEAM_INCLUDED_SEATS=5;
export const TEAM_MONTHLY_CREDITS=100000;
export const TEAM_SEAT_MONTHLY_CREDITS=15000;
export const ENTERPRISE_MANUAL_CREDIT_MAX=1000000;
const Identifier=z.string().min(1).max(128);
const IdempotencyKey=z.string().min(16).max(128);
const Timestamp=z.string().datetime({offset:true});
const Count=z.number().int().nonnegative().safe();
const teamMonthlyCredits=(seats:number)=>TEAM_MONTHLY_CREDITS+(seats-TEAM_INCLUDED_SEATS)*TEAM_SEAT_MONTHLY_CREDITS;
// Reuse the existing Plan write's version and reason constraints; no second range.
const ExpectedPlanVersion=PlatformOrganizations.setPlan.in.shape.expectedVersion;
const OperatorReason=PlatformOrganizations.setPlan.in.shape.reason;

/** orgId is a route parameter; actor and generation come from trusted state. */
export const EnterpriseCreditGrantRequest=z.object({
 credits:z.number().int().min(1).max(ENTERPRISE_MANUAL_CREDIT_MAX),
 reason:OperatorReason,idempotencyKey:IdempotencyKey,
}).strict();
export const EnterpriseCreditGrantResult=z.object({
 orgId:Identifier,grantRef:Identifier,ledgerRef:Identifier,auditRef:Identifier,
 credits:EnterpriseCreditGrantRequest.shape.credits,balance:CreditBalance,createdAt:Timestamp,
}).strict();
/** Upgrade reason is the fixed server operation, not another form field. */
export const EnterpriseUpgradeRequest=z.object({
 expectedPlanVersion:ExpectedPlanVersion,idempotencyKey:IdempotencyKey,
}).strict();

const QuoteBase=z.object({sku:Identifier,catalogVersion:Identifier,provider:BillingProvider}).strict();
const LicenseQuote=QuoteBase.extend({expectedPlanVersion:ExpectedPlanVersion});
export const TeamQuoteRequest=z.discriminatedUnion("purpose",[
 LicenseQuote.extend({purpose:z.literal("initial"),seats:Count.min(TEAM_INCLUDED_SEATS)}),
 LicenseQuote.extend({purpose:z.literal("renewal"),seats:Count.min(TEAM_INCLUDED_SEATS)}),
 LicenseQuote.extend({purpose:z.literal("add_seats"),additionalSeats:Count.positive()}),
 QuoteBase.extend({purpose:z.literal("credit_topup")}),
]);
export const TeamCheckoutRequest=z.object({quoteRef:Identifier,idempotencyKey:IdempotencyKey}).strict();

/** Paid term and monthly quota are separate facts. Annual payment is not 12 grants. */
export const TeamPaidTerm=z.object({
 purchaseAnchor:Timestamp,paidPeriodStart:Timestamp,paidPeriodEnd:Timestamp,
 billingCycle:BillingCycle,purchasedSeats:Count.min(TEAM_INCLUDED_SEATS),monthlyCredits:CreditLedgerAmount,
}).strict().superRefine((value,ctx)=>{
 const anchor=Date.parse(value.purchaseAnchor),start=Date.parse(value.paidPeriodStart),end=Date.parse(value.paidPeriodEnd);
 if(anchor>start)ctx.addIssue({code:"custom",path:["purchaseAnchor"],message:"purchase anchor cannot follow the paid period"});
 const days=(end-start)/86400000;
 const [minimum,maximum]=value.billingCycle==="month"?([28,31] as const):([365,366] as const);
 if(days<minimum||days>maximum)ctx.addIssue({code:"custom",path:["paidPeriodEnd"],message:"paid period must match its billing cycle"});
 const credits=teamMonthlyCredits(value.purchasedSeats);
 if(!Number.isSafeInteger(credits)||value.monthlyCredits!==credits)ctx.addIssue({code:"custom",path:["monthlyCredits"],message:"monthly quota must match purchased capacity"});
});

export type EnterpriseCreditGrantRequest=z.infer<typeof EnterpriseCreditGrantRequest>;
export type EnterpriseCreditGrantResult=z.infer<typeof EnterpriseCreditGrantResult>;
export type EnterpriseUpgradeRequest=z.infer<typeof EnterpriseUpgradeRequest>;
export type TeamQuoteRequest=z.infer<typeof TeamQuoteRequest>;
export type TeamCheckoutRequest=z.infer<typeof TeamCheckoutRequest>;
export type TeamPaidTerm=z.infer<typeof TeamPaidTerm>;

/** Immutable server quote; estimates never establish payment, capacity or a new anchor. */
const QuoteSnapshot=z.object({
 orgId:Identifier,generation:Identifier,quoteRef:Identifier,catalogVersion:Identifier,sku:Identifier,
 provider:BillingProvider,currency:PricingCurrency,amountMinor:PricingProduct.options[0].shape.amountMinor,
 createdAt:Timestamp,expiresAt:Timestamp,
}).strict();
const LicenseQuoteSnapshot=QuoteSnapshot.extend({
 seats:Count.min(TEAM_INCLUDED_SEATS),monthlyCredits:CreditLedgerAmount,
 billingCycle:BillingCycle,renewalMode:RenewalMode,planVersion:ExpectedPlanVersion,
});
export const TeamQuote=z.discriminatedUnion("purpose",[
 LicenseQuoteSnapshot.extend({purpose:z.literal("initial")}),
 LicenseQuoteSnapshot.extend({purpose:z.literal("renewal")}),
 QuoteSnapshot.extend({
  purpose:z.literal("add_seats"),term:TeamPaidTerm,additionalSeats:Count.positive(),
  monthlyCreditsAfter:CreditLedgerAmount,estimatedFirstCredits:CreditBalance.refine(value=>value>=0,"credit estimate must be nonnegative"),
  creditPeriodStart:Timestamp,creditPeriodEnd:Timestamp,planVersion:ExpectedPlanVersion,
 }),
 QuoteSnapshot.extend({
  purpose:z.literal("credit_topup"),credits:PricingProduct.options[1].shape.credits,renewalMode:z.literal("manual"),
 }),
]).superRefine((value,ctx)=>{
 if(value.provider==="wechat"&&value.currency!=="CNY")ctx.addIssue({code:"custom",path:["currency"],message:"WeChat quotes require CNY"});
 const created=Date.parse(value.createdAt),expires=Date.parse(value.expiresAt);
 if(expires<=created||expires-created>300000)ctx.addIssue({code:"custom",path:["expiresAt"],message:"quote lifetime must be positive and at most five minutes"});
 if(value.purpose==="initial"||value.purpose==="renewal"){
  const expected=teamMonthlyCredits(value.seats);
  if(!Number.isSafeInteger(expected)||value.monthlyCredits!==expected)ctx.addIssue({code:"custom",path:["monthlyCredits"],message:"quote monthly quota must match purchased capacity"});
  const renewal=value.provider==="wechat"?"manual":"automatic";
  if(value.renewalMode!==renewal)ctx.addIssue({code:"custom",path:["renewalMode"],message:"subscription renewal must match its payment provider"});
 }
 if(value.purpose==="add_seats"){
  const termStart=Date.parse(value.term.paidPeriodStart),termEnd=Date.parse(value.term.paidPeriodEnd);
  const start=Date.parse(value.creditPeriodStart),end=Date.parse(value.creditPeriodEnd),days=(end-start)/86400000;
  if(created<termStart||created>=termEnd||expires>termEnd)ctx.addIssue({code:"custom",path:["expiresAt"],message:"seat quote must remain inside the original paid term"});
  if(start<termStart||end>termEnd||created<start||created>=end||days<28||days>31)ctx.addIssue({code:"custom",path:["creditPeriodEnd"],message:"seat estimate requires the current monthly credit window"});
  const seats=value.term.purchasedSeats+value.additionalSeats,expected=teamMonthlyCredits(seats);
  if(!Number.isSafeInteger(seats)||!Number.isSafeInteger(expected)||value.monthlyCreditsAfter!==expected)ctx.addIssue({code:"custom",path:["monthlyCreditsAfter"],message:"seat quote must preserve existing capacity and add the requested increment"});
  if(value.estimatedFirstCredits>value.additionalSeats*TEAM_SEAT_MONTHLY_CREDITS)ctx.addIssue({code:"custom",path:["estimatedFirstCredits"],message:"first estimate cannot exceed one full monthly increment"});
 }
});
export type TeamQuote=z.infer<typeof TeamQuote>;
