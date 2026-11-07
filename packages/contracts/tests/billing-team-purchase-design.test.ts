import {expect,it} from "vitest";
import {TeamPurchaseOutcome} from "../src/billing-team";
const quote={orgId:"org-a",generation:"pricing-v1",quoteRef:"quote-a",catalogVersion:"catalog-v1",sku:"team-year",provider:"wechat",currency:"CNY",amountMinor:999000,createdAt:"2026-11-16T10:00:00Z",expiresAt:"2026-11-16T10:05:00Z",purpose:"initial",seats:5,monthlyCredits:100000,billingCycle:"year",renewalMode:"manual",planVersion:0};
const term={purchaseAnchor:"2026-11-16T10:01:00Z",paidPeriodStart:"2026-11-16T10:01:00Z",paidPeriodEnd:"2027-11-16T10:01:00Z",billingCycle:"year",purchasedSeats:5,monthlyCredits:100000};
const period={periodStart:term.paidPeriodStart,periodEnd:"2026-12-16T10:01:00Z"};
const pending={purchaseRef:"purchase-a",quote,status:"PENDING",createdAt:"2026-11-16T10:00:01Z",asOf:"2026-11-16T10:02:00Z",paymentPage:{url:"weixin://wxpay/bizpayurl?pr=fixture",expiresAt:"2026-11-16T10:15:00Z"},paidAt:null,fulfillment:null};
const receipt={receiptRef:"receipt-a",auditRef:"audit-a",ledgerRef:"ledger-a",appliedAt:"2026-11-16T10:01:30Z",paidTerm:term,firstCreditsApplied:100000,firstCreditPeriod:period};
const paid={...pending,status:"SUCCESS",paymentPage:null,paidAt:term.paidPeriodStart,fulfillment:receipt};
it("keeps real pending payment details and permits paid recovery without the old page",()=>{
 expect(TeamPurchaseOutcome.parse(pending)).toEqual(pending);expect(TeamPurchaseOutcome.safeParse({...pending,status:"PROCESSING"}).success).toBe(true);expect(TeamPurchaseOutcome.parse(paid)).toEqual(paid);
});
it.each(["PENDING","PROCESSING"])("requires both original payment facts for %s",status=>{
 expect(TeamPurchaseOutcome.safeParse({...pending,status,paymentPage:null}).success).toBe(false);
 expect(TeamPurchaseOutcome.safeParse({...pending,status,paymentPage:{url:pending.paymentPage.url}}).success).toBe(false);
});
it.each([{paidAt:null},{fulfillment:null},{status:"PENDING"},{fulfillment:{...receipt,ledgerRef:null}},{fulfillment:{...receipt,paidTerm:null}},{ownerId:"org-b"},{success:true}])("rejects an unproven or contradictory paid result %j",patch=>{
 expect(TeamPurchaseOutcome.safeParse({...paid,...patch}).success).toBe(false);
});
it("keeps confirmed cash under manual review distinct from applied entitlement",()=>{
 expect(TeamPurchaseOutcome.safeParse({...paid,status:"FAILED",fulfillment:null}).success).toBe(true);
 expect(TeamPurchaseOutcome.safeParse({...paid,status:"FAILED"}).success).toBe(false);
 expect(TeamPurchaseOutcome.safeParse({...pending,status:"CLOSED",paymentPage:null}).success).toBe(true);
 expect(TeamPurchaseOutcome.safeParse({...paid,status:"CLOSED",fulfillment:null}).success).toBe(false);
});
it("does not turn an annual receipt into an annual upfront quota or mint an expired first window",()=>{
 expect(TeamPurchaseOutcome.safeParse({...paid,fulfillment:{...receipt,firstCreditsApplied:1200000}}).success).toBe(false);
 const late={...paid,asOf:"2026-12-17T10:00:00Z",fulfillment:{...receipt,appliedAt:"2026-12-17T09:00:00Z"}};
 expect(TeamPurchaseOutcome.safeParse(late).success).toBe(false);
 expect(TeamPurchaseOutcome.safeParse({...late,fulfillment:{...late.fulfillment,firstCreditsApplied:0,ledgerRef:null}}).success).toBe(true);
});
it("does not attach license capacity or a credit window to a permanent purchase",()=>{
 const topup={...paid,quote:{orgId:quote.orgId,generation:quote.generation,quoteRef:quote.quoteRef,catalogVersion:quote.catalogVersion,sku:"credit-cn-10000-v1",provider:"wechat",currency:"CNY",amountMinor:12900,createdAt:quote.createdAt,expiresAt:quote.expiresAt,purpose:"credit_topup",credits:10000,renewalMode:"manual"},fulfillment:{...receipt,paidTerm:null,firstCreditPeriod:null,firstCreditsApplied:10000}};
 expect(TeamPurchaseOutcome.parse(topup)).toEqual(topup);
 for(const patch of [{paidTerm:term},{firstCreditPeriod:period},{firstCreditsApplied:9999}])expect(TeamPurchaseOutcome.safeParse({...topup,fulfillment:{...topup.fulfillment,...patch}}).success).toBe(false);
});
it("applies only the co-term positive increment and allows actual first credits to differ from the estimate",()=>{
 const before={...term,purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",paidPeriodEnd:"2026-12-01T10:00:00Z",billingCycle:"month"};
 const addon={...paid,quote:{orgId:quote.orgId,generation:quote.generation,quoteRef:quote.quoteRef,catalogVersion:quote.catalogVersion,sku:"team-month",provider:"wechat",currency:"CNY",amountMinor:14900,createdAt:quote.createdAt,expiresAt:quote.expiresAt,purpose:"add_seats",term:before,additionalSeats:2,monthlyCreditsAfter:130000,estimatedFirstCredits:15000,creditPeriodStart:before.paidPeriodStart,creditPeriodEnd:before.paidPeriodEnd,planVersion:2},fulfillment:{...receipt,paidTerm:{...before,purchasedSeats:7,monthlyCredits:130000},firstCreditPeriod:{periodStart:before.paidPeriodStart,periodEnd:before.paidPeriodEnd},firstCreditsApplied:14999.3}};
 expect(TeamPurchaseOutcome.parse(addon)).toEqual(addon);
 const late={...addon,asOf:"2026-12-02T10:00:00Z",paidAt:"2026-12-01T10:00:00Z",fulfillment:{...addon.fulfillment,appliedAt:"2026-12-02T09:00:00Z",firstCreditsApplied:0,ledgerRef:null}};
 expect(TeamPurchaseOutcome.safeParse(late).success).toBe(false);
 expect(TeamPurchaseOutcome.safeParse({...late,paidAt:"2026-12-01T09:59:59Z"}).success).toBe(true);
 for(const patch of [{purchasedSeats:8,monthlyCredits:145000},{paidPeriodEnd:"2027-11-01T10:00:00Z",billingCycle:"year"}])expect(TeamPurchaseOutcome.safeParse({...addon,fulfillment:{...addon.fulfillment,paidTerm:{...addon.fulfillment.paidTerm,...patch}}}).success).toBe(false);
});
it("does not report future cash or application as an existing result",()=>{
 expect(TeamPurchaseOutcome.safeParse({...paid,paidAt:"2026-11-17T10:00:00Z"}).success).toBe(false);
 expect(TeamPurchaseOutcome.safeParse({...paid,fulfillment:{...receipt,appliedAt:"2026-11-17T10:00:00Z"}}).success).toBe(false);
});
function annualAddon(){
 const before={...term,purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",paidPeriodEnd:"2027-11-01T10:00:00Z"};
 const createdAt="2027-05-02T22:00:00Z";
 return {...paid,createdAt,paidAt:createdAt,asOf:"2027-05-03T10:00:00Z",quote:{orgId:quote.orgId,generation:quote.generation,quoteRef:quote.quoteRef,catalogVersion:quote.catalogVersion,sku:"team-year",provider:"wechat",currency:"CNY",amountMinor:149000,createdAt,expiresAt:"2027-05-02T22:05:00Z",purpose:"add_seats",term:before,additionalSeats:2,monthlyCreditsAfter:130000,estimatedFirstCredits:28548.38,creditPeriodStart:"2027-05-01T10:00:00Z",creditPeriodEnd:"2027-06-01T10:00:00Z",planVersion:2},fulfillment:{...receipt,appliedAt:"2027-05-03T09:00:00Z",paidTerm:{...before,purchasedSeats:7,monthlyCredits:130000},firstCreditsApplied:28548.38,firstCreditPeriod:{periodStart:"2027-05-01T10:00:00Z",periodEnd:"2027-06-01T10:00:00Z"}}};
}
it("cannot replace an expired actual payment month with the later processing month",()=>{
 const original=annualAddon();expect(TeamPurchaseOutcome.safeParse(original).success).toBe(true);
 const late={...original,asOf:"2027-06-02T10:00:00Z",fulfillment:{...original.fulfillment,appliedAt:"2027-06-02T09:00:00Z",firstCreditPeriod:{periodStart:"2027-06-01T10:00:00Z",periodEnd:"2027-07-01T10:00:00Z"}}};
 expect(TeamPurchaseOutcome.safeParse(late).success).toBe(false);
 expect(TeamPurchaseOutcome.safeParse({...late,fulfillment:{...late.fulfillment,firstCreditPeriod:original.fulfillment.firstCreditPeriod,firstCreditsApplied:0,ledgerRef:null}}).success).toBe(true);
});
it("rejects shifted monthly boundaries even if they contain actual payment and application",()=>{
 const original=annualAddon();
 expect(TeamPurchaseOutcome.safeParse({...original,fulfillment:{...original.fulfillment,firstCreditPeriod:{periodStart:"2027-04-20T10:00:00Z",periodEnd:"2027-05-20T10:00:00Z"}}}).success).toBe(false);
});
it("restores the original day 31 after February instead of retaining the clamped day 28",()=>{
 const original=annualAddon(),anchor="2026-01-31T10:00:00Z",createdAt="2026-02-28T11:00:00Z";
 const before={...original.quote.term,purchaseAnchor:anchor,paidPeriodStart:anchor,paidPeriodEnd:"2027-01-31T10:00:00Z"};
 const feb={...original,createdAt,paidAt:createdAt,asOf:"2026-03-01T11:00:00Z",quote:{...original.quote,createdAt,expiresAt:"2026-02-28T11:05:00Z",term:before,creditPeriodStart:"2026-02-28T10:00:00Z",creditPeriodEnd:"2026-03-31T10:00:00Z"},fulfillment:{...original.fulfillment,paidTerm:{...before,purchasedSeats:7,monthlyCredits:130000},appliedAt:"2026-03-01T10:00:00Z",firstCreditPeriod:{periodStart:"2026-02-28T10:00:00Z",periodEnd:"2026-03-31T10:00:00Z"}}};
 expect(TeamPurchaseOutcome.safeParse(feb).success).toBe(true);
 expect(TeamPurchaseOutcome.safeParse({...feb,fulfillment:{...feb.fulfillment,firstCreditPeriod:{...feb.fulfillment.firstCreditPeriod,periodEnd:"2026-03-28T10:00:00Z"}}}).success).toBe(false);
});
it.each(["initial","renewal"])("binds %s annual first credits to the first anchored month",purpose=>{
 const original={...paid,quote:{...quote,purpose}};
 expect(TeamPurchaseOutcome.safeParse(original).success).toBe(true);
 // Both windows satisfy duration and paid-term containment, but neither is the first anchored month.
 const shifted={...original,fulfillment:{...receipt,firstCreditPeriod:{periodStart:"2026-11-16T10:01:15Z",periodEnd:"2026-12-16T10:01:15Z"}}};
 expect(TeamPurchaseOutcome.safeParse(shifted).success).toBe(false);
 const late={...original,asOf:"2026-12-18T10:00:00Z",fulfillment:{...receipt,appliedAt:"2026-12-18T09:00:00Z",firstCreditPeriod:{periodStart:"2026-12-17T10:01:00Z",periodEnd:"2027-01-17T10:01:00Z"}}};
 expect(TeamPurchaseOutcome.safeParse(late).success).toBe(false);
 // Even an accurately anchored later month cannot replace this purchase's expired first grant.
 expect(TeamPurchaseOutcome.safeParse({...late,fulfillment:{...late.fulfillment,firstCreditPeriod:{periodStart:period.periodEnd,periodEnd:"2027-01-16T10:01:00Z"}}}).success).toBe(false);
 const expired={...late,fulfillment:{...late.fulfillment,firstCreditPeriod:period,firstCreditsApplied:0,ledgerRef:null}};
 expect(TeamPurchaseOutcome.safeParse(expired).success).toBe(true);
 expect(TeamPurchaseOutcome.safeParse({...expired,fulfillment:{...expired.fulfillment,ledgerRef:"invented-ledger"}}).success).toBe(false);
});
it.each(["month","year"])("accepts anchored renewal first month with month-end and equivalent offsets for %s",billingCycle=>{
 const start="2026-02-28T10:00:00Z",end="2026-03-31T10:00:00Z";
 const renewal={...paid,createdAt:"2026-02-28T09:00:01Z",paidAt:start,asOf:"2026-02-28T10:02:00Z",quote:{...quote,purpose:"renewal",billingCycle,createdAt:"2026-02-28T09:00:00Z",expiresAt:"2026-02-28T09:05:00Z"},fulfillment:{...receipt,appliedAt:"2026-02-28T10:01:00Z",paidTerm:{...term,purchaseAnchor:"2026-01-31T10:00:00Z",paidPeriodStart:start,paidPeriodEnd:billingCycle==="month"?end:"2027-02-28T10:00:00Z",billingCycle},firstCreditPeriod:{periodStart:"2026-02-28T18:00:00+08:00",periodEnd:"2026-03-31T18:00:00+08:00"}}};
 expect(TeamPurchaseOutcome.safeParse(renewal).success).toBe(true);
});
