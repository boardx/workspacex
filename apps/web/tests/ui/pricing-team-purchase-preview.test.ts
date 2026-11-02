import {expect,it} from "vitest";
import {TeamPurchaseOutcome} from "@repo/contracts/billing-team";
import {previewSeatQuote,previewTeamSeatPurchase} from "@/components/billing/pricing-preview-data";
it.each(["cn","us","devapp"] as const)("consumes a recoverable applied seat receipt in %s without inventing a payment page",region=>{
 for(const cycle of ["month","year"] as const){
  const quote=previewSeatQuote(region,cycle,2,region==="us"?"stripe":"wechat");
  const result=previewTeamSeatPurchase(quote);
  expect(TeamPurchaseOutcome.parse(result)).toEqual(result);expect(result.quote).toEqual(quote);
  expect(result.status).toBe("SUCCESS");expect(result.paymentPage).toBeNull();
  expect(result.fulfillment?.paidTerm?.purchasedSeats).toBe(7);expect(result.fulfillment?.paidTerm?.monthlyCredits).toBe(130000);
  expect(result.fulfillment?.paidTerm?.paidPeriodEnd).toBe(quote.term.paidPeriodEnd);
  expect(result.fulfillment?.firstCreditsApplied).toBeLessThanOrEqual(30000);
 }
});
