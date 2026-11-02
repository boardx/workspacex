/**
 * Team / Enterprise contracts, signed design #6099 and Team runtime #6110.
 * Authority: phases/phase-21-billing-payment/design-deltas/team-enterprise-v1/.
 * Human signoff is recorded only in design-signoff.md under that authority.
 * Operation metadata below corresponds to implemented routes; schemas alone do not
 * grant permission or activate sales. Prepaid treatment follows the recorded human decision.
 */
import {z} from "zod";
import {BillingProvider,BillingOrderStatus,BillingErrorCode,CreditBalance,CreditLedgerAmount,CreditWallet} from "./billing-credits";
import {BillingCycle,PricingCurrency,PricingProduct,PricingCatalogBase,validatePricingCatalog,RenewalMode,operations as PersonalPricingOperations} from "./billing-pricing";
import {SubscriptionStatus} from "./billing-subscription";
import {creditMonthBoundary,creditMonthWindowAt,paidCreditMonthCount} from "./billing-credit-calendar";
import {PlanState,PlanWrite,OrganizationPlanErrorCode} from "./organization-plan";

export const TEAM_QUOTE_TTL_MS=300000;
export const TEAM_INCLUDED_SEATS=5;
export const TEAM_MONTHLY_CREDITS=100000;
export const TEAM_SEAT_MONTHLY_CREDITS=15000;
export const ENTERPRISE_MANUAL_CREDIT_MAX=1000000;
export const EnterprisePrepaidTeamPolicy=z.literal("continue_until_paid_end");
const Identifier=z.string().min(1).max(128);
const IdempotencyKey=z.string().min(16).max(128);
const Timestamp=z.string().datetime({offset:true});
const Count=z.number().int().nonnegative().safe();
export const TeamPurchasePurpose=z.enum(["initial","renewal","add_seats","credit_topup"]);
const Purpose=TeamPurchasePurpose.enum;
const paymentCurrencySupported=(provider:z.infer<typeof BillingProvider>,currency:z.infer<typeof PricingCurrency>)=>provider!=="wechat"||currency==="CNY";
function anchoredWindowMatches(anchor:string,at:number,start:string,end:string):boolean{
 try{
  const window=creditMonthWindowAt(new Date(anchor),new Date(at));
  return window!==null&&window.start.getTime()===Date.parse(start)&&window.end.getTime()===Date.parse(end);
 }catch{return false;}
}
const teamMonthlyCredits=(seats:number)=>TEAM_MONTHLY_CREDITS+(seats-TEAM_INCLUDED_SEATS)*TEAM_SEAT_MONTHLY_CREDITS;
// Reuse the existing Plan write's version and reason constraints; no second range.
const ExpectedPlanVersion=PlanWrite.shape.expectedVersion;
const OperatorReason=PlanWrite.shape.reason;

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
 LicenseQuote.extend({purpose:z.literal(Purpose.initial),seats:Count.min(TEAM_INCLUDED_SEATS)}),
 LicenseQuote.extend({purpose:z.literal(Purpose.renewal),seats:Count.min(TEAM_INCLUDED_SEATS)}),
 LicenseQuote.extend({purpose:z.literal(Purpose.add_seats),additionalSeats:Count.positive()}),
 QuoteBase.extend({purpose:z.literal(Purpose.credit_topup)}),
]);
export const TeamCheckoutRequest=z.object({quoteRef:Identifier,idempotencyKey:IdempotencyKey}).strict();

/** Paid term and monthly quota are separate facts. Annual payment is not 12 grants. */
export const TeamPaidTerm=z.object({
 purchaseAnchor:Timestamp,paidPeriodStart:Timestamp,paidPeriodEnd:Timestamp,
 billingCycle:BillingCycle,purchasedSeats:Count.min(TEAM_INCLUDED_SEATS),monthlyCredits:CreditLedgerAmount,
}).strict().superRefine((value,ctx)=>{
 const anchor=Date.parse(value.purchaseAnchor),start=Date.parse(value.paidPeriodStart),end=Date.parse(value.paidPeriodEnd);
 if(anchor>start)ctx.addIssue({code:"custom",path:["purchaseAnchor"],message:"purchase anchor cannot follow the paid period"});
 let anchored=false;
 try{
  const anchor=new Date(value.purchaseAnchor),window=creditMonthWindowAt(anchor,new Date(start));
  anchored=window!==null&&window.start.getTime()===start&&creditMonthBoundary(anchor,window.offset+paidCreditMonthCount(value.billingCycle)).getTime()===end;
 }catch{/* Invalid input remains a schema issue, never an invented period. */}
 if(!anchored)ctx.addIssue({code:"custom",path:["paidPeriodEnd"],message:"paid period must follow the original UTC purchase anchor"});
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
 LicenseQuoteSnapshot.extend({purpose:z.literal(Purpose.initial)}),
 LicenseQuoteSnapshot.extend({purpose:z.literal(Purpose.renewal)}),
 QuoteSnapshot.extend({
  purpose:z.literal(Purpose.add_seats),term:TeamPaidTerm,additionalSeats:Count.positive(),
  monthlyCreditsAfter:CreditLedgerAmount,estimatedFirstCredits:CreditBalance.refine(value=>value>=0,"credit estimate must be nonnegative"),
  creditPeriodStart:Timestamp,creditPeriodEnd:Timestamp,planVersion:ExpectedPlanVersion,
 }),
 QuoteSnapshot.extend({
  purpose:z.literal(Purpose.credit_topup),credits:PricingProduct.options[1].shape.credits,renewalMode:z.literal("manual"),
 }),
]).superRefine((value,ctx)=>{
 if(!paymentCurrencySupported(value.provider,value.currency))ctx.addIssue({code:"custom",path:["currency"],message:"WeChat quotes require CNY"});
 const created=Date.parse(value.createdAt),expires=Date.parse(value.expiresAt);
 if(expires<=created||expires-created>TEAM_QUOTE_TTL_MS)ctx.addIssue({code:"custom",path:["expiresAt"],message:"quote lifetime must be positive and at most five minutes"});
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
  if(!anchoredWindowMatches(value.term.purchaseAnchor,created,value.creditPeriodStart,value.creditPeriodEnd))ctx.addIssue({code:"custom",path:["creditPeriodEnd"],message:"seat estimate must use the original-anchor current month"});
  const seats=value.term.purchasedSeats+value.additionalSeats,expected=teamMonthlyCredits(seats);
  if(!Number.isSafeInteger(seats)||!Number.isSafeInteger(expected)||value.monthlyCreditsAfter!==expected)ctx.addIssue({code:"custom",path:["monthlyCreditsAfter"],message:"seat quote must preserve existing capacity and add the requested increment"});
  if(value.estimatedFirstCredits>value.additionalSeats*TEAM_SEAT_MONTHLY_CREDITS)ctx.addIssue({code:"custom",path:["estimatedFirstCredits"],message:"first estimate cannot exceed one full monthly increment"});
 }
});
export type TeamQuote=z.infer<typeof TeamQuote>;

/** Included Team credits only; permanent/manual credits stay in the existing wallet. */
export const TeamMonthlyCreditGrant=z.object({
 status:z.enum(["none","pending","granted","expired"]),
 grant:z.object({credits:CreditLedgerAmount,remainingCredits:CreditBalance.refine(value=>value>=0),
  periodStart:Timestamp,periodEnd:Timestamp}).strict().nullable(),
}).strict().superRefine((value,ctx)=>{
 const hasGrant=value.status==="granted"||value.status==="expired";
 if(hasGrant!==(value.grant!==null))ctx.addIssue({code:"custom",message:"monthly grant state and facts must agree"});
 if(value.grant){
  const days=(Date.parse(value.grant.periodEnd)-Date.parse(value.grant.periodStart))/86400000;
  if(days<28||days>31)ctx.addIssue({code:"custom",message:"included credit grant uses one monthly window"});
  if(value.grant.remainingCredits>value.grant.credits||value.status==="expired"&&value.grant.remainingCredits!==0)ctx.addIssue({code:"custom",message:"invalid remaining monthly credits"});
 }
});
const TeamPayment=z.object({
 term:TeamPaidTerm,provider:BillingProvider,renewalMode:RenewalMode,cancelAtPeriodEnd:z.boolean(),subscriptionStatus:SubscriptionStatus.nullable(),
}).strict().superRefine((value,ctx)=>{
 if(value.provider==="wechat"&&(value.renewalMode!=="manual"||value.cancelAtPeriodEnd||value.subscriptionStatus!==null)||value.provider==="stripe"&&(value.renewalMode!=="automatic"||value.subscriptionStatus===null||value.subscriptionStatus==="none"))ctx.addIssue({code:"custom",message:"Team renewal facts must agree with the provider"});
});
function teamRenewalStopped(payment:z.infer<typeof TeamPayment>):boolean{
 return payment.provider==="wechat"||payment.cancelAtPeriodEnd||payment.subscriptionStatus==="canceled"||payment.subscriptionStatus==="incomplete_expired";
}
/** Licensing read model, never a replacement for membership, AI policy or credit admission. */
export const TeamEntitlement=z.object({
 orgId:Identifier,generation:Identifier,planVersion:PlanState.shape.version,asOf:Timestamp,
 licenseStatus:z.enum(["none","active","expired","enterprise"]),memberCount:Count,
 teamPayment:TeamPayment.nullable(),creditGrant:TeamMonthlyCreditGrant,
 wallet:CreditWallet.required({permanentBalance:true,subscriptionCredits:true,subscriptionExpiresAt:true}),
 checkoutPending:z.boolean(),paymentReviewRequired:z.boolean(),
}).strict().superRefine((value,ctx)=>{
 const {teamPayment:payment,creditGrant,wallet}=value,now=Date.parse(value.asOf),grant=creditGrant.grant;
 if(wallet.ownerType!=="team"||wallet.ownerId!==value.orgId)ctx.addIssue({code:"custom",path:["wallet"],message:"wallet must belong to this organization"});
 if(value.licenseStatus==="none"&&(payment!==null||creditGrant.status!=="none"))ctx.addIssue({code:"custom",message:"unconfigured organization has no paid Team facts"});
 if(value.licenseStatus==="active"||value.licenseStatus==="expired"){
  if(!payment)ctx.addIssue({code:"custom",path:["teamPayment"],message:"paid Team facts are required"});
  else{
   const start=Date.parse(payment.term.paidPeriodStart),end=Date.parse(payment.term.paidPeriodEnd);
   if(value.licenseStatus==="active"&&(now<start||now>=end)||value.licenseStatus==="expired"&&now<end)ctx.addIssue({code:"custom",path:["licenseStatus"],message:"Team licensing status must agree with its paid term"});
  }
 }
 if(value.licenseStatus==="enterprise"&&payment!==null&&!teamRenewalStopped(payment))ctx.addIssue({code:"custom",path:["teamPayment"],message:"Enterprise activation must first stop future owned Team renewal"});
 if(grant){
  const start=Date.parse(grant.periodStart),end=Date.parse(grant.periodEnd);
  if(!payment||start<Date.parse(payment.term.paidPeriodStart)||end>Date.parse(payment.term.paidPeriodEnd)||grant.credits>payment.term.monthlyCredits)ctx.addIssue({code:"custom",path:["creditGrant"],message:"included monthly credits must remain within their paid Team facts"});
  if(payment&&!anchoredWindowMatches(payment.term.purchaseAnchor,start,grant.periodStart,grant.periodEnd))ctx.addIssue({code:"custom",path:["creditGrant"],message:"monthly grant must preserve the original purchase anchor"});
  if(creditGrant.status==="granted"&&(now<start||now>=end)||creditGrant.status==="expired"&&now<end)ctx.addIssue({code:"custom",path:["creditGrant"],message:"grant status must agree with the read time"});
 }
 if(Math.round(wallet.balance*100)!==Math.round((wallet.permanentBalance+wallet.subscriptionCredits)*100))ctx.addIssue({code:"custom",path:["wallet","balance"],message:"wallet components must preserve the signed total"});
 const remaining=creditGrant.status==="granted"&&grant?grant.remainingCredits:0;
 if(wallet.subscriptionCredits!==remaining)ctx.addIssue({code:"custom",path:["wallet","subscriptionCredits"],message:"wallet and current monthly remaining credits must agree"});
 const walletExpiry=wallet.subscriptionExpiresAt===null?null:Date.parse(wallet.subscriptionExpiresAt),grantExpiry=grant?Date.parse(grant.periodEnd):null;
 if(remaining>0&&walletExpiry!==grantExpiry||remaining===0&&walletExpiry!==null&&walletExpiry!==grantExpiry)ctx.addIssue({code:"custom",path:["wallet","subscriptionExpiresAt"],message:"wallet monthly expiry must match the actual grant"});
});
export type TeamMonthlyCreditGrant=z.infer<typeof TeamMonthlyCreditGrant>;
export type TeamEntitlement=z.infer<typeof TeamEntitlement>;

/** Organization-scoped catalog; permanent packs reuse the personal catalog product schema. */
export const TeamProduct=z.discriminatedUnion("kind",[
 PricingProduct.options[0].omit({monthlyCredits:true}).extend({
  includedSeats:z.literal(TEAM_INCLUDED_SEATS),monthlyCredits:z.literal(TEAM_MONTHLY_CREDITS),
  additionalSeatAmountMinor:PricingProduct.options[0].shape.amountMinor,
  additionalSeatMonthlyCredits:z.literal(TEAM_SEAT_MONTHLY_CREDITS),
 }),
 PricingProduct.options[1],
]);
export const TeamCatalog=PricingCatalogBase.omit({products:true}).extend({
 orgId:Identifier,products:z.array(TeamProduct).max(20),
}).superRefine(validatePricingCatalog).superRefine((value,ctx)=>{
 if(value.market==="us"&&value.enabledProviders.includes("wechat"))ctx.addIssue({code:"custom",path:["enabledProviders"],message:"USD catalog cannot enable WeChat"});
});
export type TeamCatalog=z.infer<typeof TeamCatalog>;

const TEAM_HISTORY_PAGE_MAX=50;
const HistoryCursor=z.string().min(1).max(2048);
export const TeamHistoryQuery=z.object({
 cursor:HistoryCursor.optional(),limit:z.coerce.number().int().min(1).max(TEAM_HISTORY_PAGE_MAX).default(10),
}).strict();
/** Paid licensing history only: permanent purchases stay in the existing wallet/order history. */
export const TeamSubscriptionHistoryItem=z.object({
 purchaseRef:Identifier,receiptRef:Identifier,purpose:TeamPurchasePurpose.exclude(["credit_topup"]),
 sku:Identifier,provider:BillingProvider,currency:PricingCurrency,amountMinor:PricingProduct.options[0].shape.amountMinor,
 paidAt:Timestamp,paidTerm:TeamPaidTerm,additionalSeats:Count.positive().nullable(),
}).strict().superRefine((value,ctx)=>{
 if(!paymentCurrencySupported(value.provider,value.currency))ctx.addIssue({code:"custom",path:["currency"],message:"WeChat history requires CNY"});
 if(value.purpose==="add_seats"){
  if(value.additionalSeats===null||value.paidTerm.purchasedSeats-value.additionalSeats<TEAM_INCLUDED_SEATS)ctx.addIssue({code:"custom",path:["additionalSeats"],message:"history must retain original purchased capacity"});
 }else if(value.additionalSeats!==null)ctx.addIssue({code:"custom",path:["additionalSeats"],message:"only an add-on records an increment"});
});
export const TeamSubscriptionHistory=z.object({
 orgId:Identifier,generation:Identifier,asOf:Timestamp,items:z.array(TeamSubscriptionHistoryItem).max(TEAM_HISTORY_PAGE_MAX),nextCursor:HistoryCursor.nullable(),
}).strict().superRefine((value,ctx)=>{
 value.items.forEach((item,index)=>{
  if(Date.parse(item.paidAt)>Date.parse(value.asOf))ctx.addIssue({code:"custom",path:["items",index,"paidAt"],message:"confirmed payment cannot follow the history read time"});
 });
 if(new Set(value.items.map(item=>item.purchaseRef)).size!==value.items.length||new Set(value.items.map(item=>item.receiptRef)).size!==value.items.length)ctx.addIssue({code:"custom",path:["items"],message:"one actual payment must appear only once"});
});
export type TeamSubscriptionHistory=z.infer<typeof TeamSubscriptionHistory>;

const CreditWindow=z.object({periodStart:Timestamp,periodEnd:Timestamp}).strict();
/** The first grant can be zero when its original monthly window has already expired. */
export const TeamPurchaseFulfillment=z.object({
 receiptRef:Identifier,auditRef:Identifier,ledgerRef:Identifier.nullable(),appliedAt:Timestamp,
 paidTerm:TeamPaidTerm.nullable(),firstCreditsApplied:CreditBalance.refine(value=>value>=0),firstCreditPeriod:CreditWindow.nullable(),
}).strict();
/** Read-only owned purchase view. Neither a redirect nor a caller-owned field proves payment. */
export const TeamPurchaseOutcome=z.object({
 purchaseRef:Identifier,quote:TeamQuote,status:BillingOrderStatus,createdAt:Timestamp,asOf:Timestamp,
 paymentPage:z.object({url:z.string().url(),expiresAt:Timestamp}).strict().nullable(),
 paidAt:Timestamp.nullable(),fulfillment:TeamPurchaseFulfillment.nullable(),
}).strict().superRefine((value,ctx)=>{
 const now=Date.parse(value.asOf),paid=value.paidAt===null?null:Date.parse(value.paidAt),receipt=value.fulfillment;
 if(Date.parse(value.createdAt)>now||paid!==null&&paid>now)ctx.addIssue({code:"custom",message:"purchase facts cannot follow their read time"});
 const awaiting=value.status==="PENDING"||value.status==="PROCESSING";
 if(awaiting&&(value.paymentPage===null||value.paidAt!==null))ctx.addIssue({code:"custom",message:"unresolved payment needs its real original page and no confirmed cash"});
 if(value.status==="CLOSED"&&value.paidAt!==null)ctx.addIssue({code:"custom",message:"a closed unpaid purchase cannot claim received cash"});
 if(value.status!=="SUCCESS"){
  if(receipt!==null)ctx.addIssue({code:"custom",path:["fulfillment"],message:"only an applied purchase has a fulfillment receipt"});
  if(awaiting&&value.quote.purpose==="add_seats"&&value.paymentPage!==null&&Date.parse(value.paymentPage.expiresAt)>Date.parse(value.quote.term.paidPeriodEnd))ctx.addIssue({code:"custom",path:["paymentPage","expiresAt"],message:"seat payment cannot outlive the original paid term"});
  return;
 }
 if(paid===null||receipt===null){ctx.addIssue({code:"custom",message:"paid outcome requires confirmed cash and its actual receipt"});return;}
 const applied=Date.parse(receipt.appliedAt),credits=receipt.firstCreditsApplied,term=receipt.paidTerm,window=receipt.firstCreditPeriod;
 if(applied>now||applied<paid)ctx.addIssue({code:"custom",path:["fulfillment","appliedAt"],message:"application must follow confirmed cash and precede the read time"});
 if((credits>0)!==(receipt.ledgerRef!==null))ctx.addIssue({code:"custom",path:["fulfillment","ledgerRef"],message:"a positive first grant requires its real ledger entry"});
 if(value.quote.purpose==="credit_topup"){
  if(term!==null||window!==null||credits!==value.quote.credits)ctx.addIssue({code:"custom",path:["fulfillment"],message:"permanent purchase cannot change license capacity or a monthly window"});
  return;
 }
 if(term===null){ctx.addIssue({code:"custom",path:["fulfillment","paidTerm"],message:"licensing purchase must retain its actual paid term"});return;}
 if(value.quote.purpose==="initial"||value.quote.purpose==="renewal"){
  if(term.purchasedSeats!==value.quote.seats||term.monthlyCredits!==value.quote.monthlyCredits||term.billingCycle!==value.quote.billingCycle||credits>term.monthlyCredits)ctx.addIssue({code:"custom",path:["fulfillment"],message:"license receipt must match the purchased capacity and monthly quota"});
 }else{
  const original=value.quote.term;
  if(paid<Date.parse(original.paidPeriodStart)||paid>=Date.parse(original.paidPeriodEnd))ctx.addIssue({code:"custom",path:["paidAt"],message:"seat cash must arrive inside the original paid term"});
  const termFields=["purchaseAnchor","paidPeriodStart","paidPeriodEnd"] as const;
  if(termFields.some(field=>Date.parse(term[field])!==Date.parse(original[field]))||term.billingCycle!==original.billingCycle||term.purchasedSeats!==original.purchasedSeats+value.quote.additionalSeats||term.monthlyCredits!==value.quote.monthlyCreditsAfter||credits>value.quote.additionalSeats*TEAM_SEAT_MONTHLY_CREDITS)ctx.addIssue({code:"custom",path:["fulfillment"],message:"seat receipt must preserve the original term and apply only the requested increment"});
 }
 if(credits>0&&window===null)ctx.addIssue({code:"custom",path:["fulfillment","firstCreditPeriod"],message:"included first credits require their real monthly window"});
 if(window!==null){
  const start=Date.parse(window.periodStart),end=Date.parse(window.periodEnd),days=(end-start)/86400000;
  if((value.quote.purpose==="initial"||value.quote.purpose==="renewal")&&!anchoredWindowMatches(term.purchaseAnchor,Date.parse(term.paidPeriodStart),window.periodStart,window.periodEnd))ctx.addIssue({code:"custom",path:["fulfillment","firstCreditPeriod"],message:"first license credits belong to the first anchored month of the paid term"});
  if(value.quote.purpose==="add_seats"&&!anchoredWindowMatches(term.purchaseAnchor,paid,window.periodStart,window.periodEnd))ctx.addIssue({code:"custom",path:["fulfillment","firstCreditPeriod"],message:"first seat credits belong to the actual payment month, not the processing month"});
  if(days<28||days>31||start<Date.parse(term.paidPeriodStart)||end>Date.parse(term.paidPeriodEnd)||credits>0&&(applied<start||applied>=end))ctx.addIssue({code:"custom",path:["fulfillment","firstCreditPeriod"],message:"first included credits cannot mint outside a paid current monthly window"});
 }
});
export type TeamPurchaseOutcome=z.infer<typeof TeamPurchaseOutcome>;

/** Operation-specific business codes use the actual HTTP `code` envelope. Generic auth/5xx may have none. */
export const TeamBillingErrorCode=z.enum([
 ...PersonalPricingOperations.createPersonalCheckout.err,...OrganizationPlanErrorCode.options,
 BillingErrorCode.enum.forbidden,BillingErrorCode.enum.owner_not_found,BillingErrorCode.enum.order_not_found,
 "capacity_insufficient","quote_expired","paid_term_expired","commercial_change_pending","payment_review_required",
 "unsupported_plan_transition","dependency_unavailable","enterprise_required","credit_balance_unrepresentable","not_subscribed",
]);
/** Only a failed checkout POST with no known purchaseRef: locked reserve found no original key,
 * and rejected before persisting an intent or calling a provider. Never clears a known purchase. */
export const TEAM_CHECKOUT_UNRESERVED_ERRORS=[
 "quote_expired","capacity_insufficient","PLAN_VERSION_CONFLICT","unsupported_plan_transition","commercial_change_pending","already_subscribed",
] as const satisfies readonly z.infer<typeof TeamBillingErrorCode>[];
export const TeamBillingRejection=z.object({error:z.string().min(1).max(200),traceId:Identifier,code:TeamBillingErrorCode}).strict();
export const EnterpriseUpgradeReceipt=z.object({
 auditRef:Identifier,actorId:Identifier,appliedAt:Timestamp,plan:PlanState,
 prepaidTeamPolicy:EnterprisePrepaidTeamPolicy,retainedTeamPayment:TeamPayment.nullable(),
}).strict().superRefine((value,ctx)=>{
 if(value.plan.plan!=="enterprise"||value.plan.enforcement!=="active"||value.plan.updatedBy!==value.actorId||value.plan.updatedAt===null||Date.parse(value.plan.updatedAt)!==Date.parse(value.appliedAt))ctx.addIssue({code:"custom",path:["plan"],message:"activation receipt must retain the actual atomic Plan write"});
 if(value.retainedTeamPayment!==null&&!teamRenewalStopped(value.retainedTeamPayment))ctx.addIssue({code:"custom",path:["retainedTeamPayment"],message:"future owned Team renewal must stop before Enterprise activation"});
});
const UpgradeOperationBase=z.object({orgId:Identifier,generation:Identifier,operationRef:Identifier,expectedPlanVersion:ExpectedPlanVersion,createdAt:Timestamp,asOf:Timestamp}).strict();
export const EnterpriseUpgradeOperation=z.discriminatedUnion("status",[
 UpgradeOperationBase.extend({status:z.literal("processing"),receipt:z.null(),code:z.literal("dependency_unavailable").nullable(),nextAction:z.literal("retry_original")}),
 UpgradeOperationBase.extend({status:z.literal("needs_review"),receipt:z.null(),code:z.enum(["dependency_unavailable","payment_review_required",OrganizationPlanErrorCode.enum.PLAN_VERSION_CONFLICT]),nextAction:z.literal("contact_platform")}),
 UpgradeOperationBase.extend({status:z.literal("succeeded"),receipt:EnterpriseUpgradeReceipt,code:z.null(),nextAction:z.null()}),
]).superRefine((value,ctx)=>{
 const created=Date.parse(value.createdAt),now=Date.parse(value.asOf);
 if(created>now)ctx.addIssue({code:"custom",path:["createdAt"],message:"operation cannot follow its read time"});
 if(value.status==="succeeded"){
  const receipt=value.receipt,applied=Date.parse(receipt.appliedAt);
  if(receipt.plan.billingGeneration!==value.generation||receipt.plan.version!==value.expectedPlanVersion+1||applied<created||applied>now)ctx.addIssue({code:"custom",path:["receipt"],message:"activation must match the original version, generation and observed operation"});
 }
});
export type EnterpriseUpgradeOperation=z.infer<typeof EnterpriseUpgradeOperation>;

/** Registered only with the implemented authenticated Team and Enterprise routes. */
const OrgPath=EnterpriseCreditGrantResult.pick({orgId:true});
const SaleErrors=TeamBillingErrorCode.options;
export const operations={
 getTeamCatalog:{method:"GET",path:"/billing/organizations/:orgId/catalog",in:z.object({orgId:Identifier}).strict(),out:TeamCatalog,err:["forbidden","owner_not_found","dependency_unavailable"] as const},
 getTeamEntitlement:{method:"GET",path:"/billing/organizations/:orgId/entitlement",in:z.object({orgId:Identifier}).strict(),out:TeamEntitlement,err:["forbidden","owner_not_found","dependency_unavailable"] as const},
 createTeamQuote:{method:"POST",path:"/billing/organizations/:orgId/quotes",in:TeamQuoteRequest,out:TeamQuote,err:TeamBillingErrorCode.options},
 createTeamCheckout:{method:"POST",path:"/billing/organizations/:orgId/checkout",in:TeamCheckoutRequest,out:TeamPurchaseOutcome,err:TeamBillingErrorCode.options},
 getTeamPurchase:{method:"GET",path:"/billing/organizations/:orgId/purchases/:purchaseRef",in:z.object({orgId:Identifier,purchaseRef:Identifier}).strict(),out:TeamPurchaseOutcome,err:["forbidden","owner_not_found","dependency_unavailable","order_not_found"] as const},
 createEnterpriseUpgrade:{method:"POST",path:"/platform/organizations/:orgId/billing/enterprise-upgrades",in:EnterpriseUpgradeRequest,out:EnterpriseUpgradeOperation,err:SaleErrors},
 getEnterpriseUpgradeOperation:{method:"GET",path:"/platform/organizations/:orgId/billing/operations/:operationRef",in:OrgPath.extend({operationRef:Identifier}),out:EnterpriseUpgradeOperation,err:[...OrganizationPlanErrorCode.options,"dependency_unavailable",BillingErrorCode.enum.order_not_found] as const},
 grantEnterpriseCredits:{method:"POST",path:"/platform/organizations/:orgId/billing/credit-grants",in:EnterpriseCreditGrantRequest,out:EnterpriseCreditGrantResult,err:SaleErrors},
} as const;
