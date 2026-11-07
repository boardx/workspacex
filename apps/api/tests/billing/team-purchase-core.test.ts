import {expect,it} from "vitest";
import {buildTeamQuote,firstTeamGrant} from "../../src/domain/billing/team-purchase";
const now=new Date("2026-01-31T10:00:00Z");
const product={kind:"subscription",sku:"configured-team",currency:"CNY",amountMinor:33300,cycle:"year",includedSeats:5,monthlyCredits:100000,additionalSeatAmountMinor:1700,additionalSeatMonthlyCredits:15000} as const;
const request={purpose:"initial",catalogVersion:"configured-v1",sku:product.sku,provider:"wechat",expectedPlanVersion:2,seats:7} as const;
const context={orgId:"org-a",generation:"epoch-a",quoteRef:"quote-a",catalogVersion:"configured-v1",now,memberCount:7,planVersion:2,plan:"ordinary",existingSeats:null,existingPaidUntil:null};
it("quotes configured base and increments without annual upfront credits",()=>{
 expect(buildTeamQuote(request,product,context)).toMatchObject({amountMinor:36700,seats:7,monthlyCredits:130000,billingCycle:"year",planVersion:2,expiresAt:"2026-01-31T10:05:00.000Z"});
});
it.each([{memberCount:8},{planVersion:3},{plan:"enterprise"},{existingSeats:9,existingPaidUntil:new Date("2027-01-01")}])("rejects invalid commercial state %j",patch=>{
 expect(()=>buildTeamQuote(request,product,{...context,...patch})).toThrow();
});
it("renewal preserves purchased capacity even when membership decreases",()=>{
 expect(()=>buildTeamQuote({...request,purpose:"renewal"},product,{...context,memberCount:3,existingSeats:9,existingPaidUntil:new Date("2026-01-01")})).toThrow();
});
it("permanent quote cannot create capacity or term facts",()=>{
 expect(buildTeamQuote({purpose:"credit_topup",catalogVersion:"configured-v1",sku:"pack",provider:"wechat"},{kind:"credit_topup",sku:"pack",currency:"CNY",amountMinor:12900,credits:10000},context)).toMatchObject({purpose:"credit_topup",credits:10000});
});
it("first annual grant expires at original month end and late processing cannot revive it",()=>{
 const quote=buildTeamQuote(request,product,context);
 expect(firstTeamGrant(quote,now,new Date("2026-02-01"))).toMatchObject({credits:130000,period:{periodStart:"2026-01-31T10:00:00.000Z",periodEnd:"2026-02-28T10:00:00.000Z"},term:{paidPeriodEnd:"2027-01-31T10:00:00.000Z"}});
 expect(firstTeamGrant(quote,now,new Date("2026-03-01"))).toMatchObject({credits:0,period:{periodEnd:"2026-02-28T10:00:00.000Z"}});
});
it("does not interpret a missing previous paid term as an expired renewal",()=>{
 expect(()=>buildTeamQuote({...request,purpose:"renewal"},product,{...context,existingSeats:5,existingPaidUntil:null})).toThrow("dependency_unavailable");
});
