import {expect,it} from "vitest";
import {TeamSubscriptionHistory,TeamHistoryQuery} from "../src/billing-team";
const term={purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",paidPeriodEnd:"2027-11-01T10:00:00Z",billingCycle:"year",purchasedSeats:5,monthlyCredits:100000};
const item={purchaseRef:"purchase-a",receiptRef:"receipt-a",purpose:"initial",sku:"team-cn-year-v1",provider:"wechat",currency:"CNY",amountMinor:999000,paidAt:term.paidPeriodStart,paidTerm:term,additionalSeats:null};
const history={orgId:"org-a",generation:"pricing-v1",asOf:"2026-11-16T10:00:00Z",items:[item],nextCursor:null};
it("records one paid annual purchase with its monthly quota rather than twelve payments",()=>{
 expect(TeamSubscriptionHistory.parse(history)).toEqual(history);
 expect(TeamSubscriptionHistory.safeParse({...history,items:[{...item,paidTerm:{...term,monthlyCredits:1200000}}]}).success).toBe(false);
});
it("keeps the recorded add-on quantity distinct from total paid capacity",()=>{
 const addon={...item,purpose:"add_seats",additionalSeats:2,paidTerm:{...term,purchasedSeats:7,monthlyCredits:130000}};
 expect(TeamSubscriptionHistory.safeParse({...history,items:[addon]}).success).toBe(true);
 for(const patch of [{additionalSeats:0},{additionalSeats:null},{additionalSeats:0.5},{additionalSeats:3}])expect(TeamSubscriptionHistory.safeParse({...history,items:[{...addon,...patch}]}).success).toBe(false);
});
it.each([{purpose:"credit_topup"},{additionalSeats:1},{currency:"USD"},{amountMinor:null},{amountMinor:0},{paidAt:null},{receiptRef:""},{ownerId:"org-b"}])("rejects an incomplete or contradictory paid history record %j",patch=>{
 expect(TeamSubscriptionHistory.safeParse({...history,items:[{...item,...patch}]}).success).toBe(false);
});
it("rejects duplicate purchase or receipt rows without inventing monthly payment entries",()=>{
 expect(TeamSubscriptionHistory.safeParse({...history,items:[item,item]}).success).toBe(false);
 expect(TeamSubscriptionHistory.safeParse({...history,items:[item,{...item,purchaseRef:"purchase-b"}]}).success).toBe(false);
 expect(TeamSubscriptionHistory.safeParse({...history,items:[],nextCursor:null}).success).toBe(true);
});
it("bounds cursor paging without permitting query-selected organization or generation",()=>{
 expect(TeamHistoryQuery.parse({})).toEqual({limit:10});
 expect(TeamHistoryQuery.parse({limit:"50",cursor:"opaque-scope-bound-cursor"})).toEqual({limit:50,cursor:"opaque-scope-bound-cursor"});
 for(const query of [{limit:51},{limit:0},{cursor:""},{cursor:"x".repeat(2049)},{orgId:"org-b"},{generation:"old"}])expect(TeamHistoryQuery.safeParse(query).success).toBe(false);
});
