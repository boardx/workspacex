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
