import {expect,it} from "vitest";
import {assessTeamPayment} from "../../src/domain/billing/team-payment-decision";
const paidAt=new Date("2026-01-31T10:00:00Z");
const purchase={purchaseRef:"bt-original",createdAt:new Date("2026-01-31T09:59:00Z"),checkoutExpiresAt:new Date("2026-01-31T10:14:00Z"),quote:{orgId:"org-a",generation:"epoch",purpose:"initial",provider:"wechat",amountMinor:19900,currency:"CNY",planVersion:0,seats:5,monthlyCredits:100000,billingCycle:"year"}} as never;
const proof={provider:"wechat",purchaseRef:"bt-original",paymentRef:"wx_123",amountMinor:19900,currency:"CNY",paidAt} as const;
const facts={plan:"ordinary",planVersion:0,pendingPurchaseRef:"bt-original",memberCount:5};
it.each([{plan:"enterprise"},{planVersion:1},{pendingPurchaseRef:"another"},{memberCount:6}])("retains real cash but does not grant under changed commercial facts %j",patch=>{
 expect(assessTeamPayment(purchase,proof,{...facts,...patch},paidAt)).toMatchObject({kind:"review",payment:proof});
});
it("preserves late real cash as review rather than silently dropping expired payment",()=>{
 const late={...proof,paidAt:new Date("2026-01-31T10:15:00Z")};
 expect(assessTeamPayment(purchase,late,facts,late.paidAt)).toMatchObject({kind:"review",payment:late});
});
it("delayed processing keeps the actual paid term and zero expired first credits",()=>{
 expect(assessTeamPayment(purchase,proof,facts,new Date("2026-03-01"))).toMatchObject({kind:"apply",grant:{credits:0,term:{paidPeriodStart:paidAt.toISOString(),paidPeriodEnd:"2027-01-31T10:00:00.000Z"}}});
});
it.each([{amountMinor:1},{currency:"USD"},{purchaseRef:"other"},{provider:"stripe"}])("cannot apply a proof mismatching the frozen purchase %j",patch=>{
 expect(assessTeamPayment(purchase,{...proof,...patch} as never,facts,paidAt)).toMatchObject({kind:"review"});
});
