import {expect,it} from "vitest";
import {TeamQuote} from "@repo/contracts/billing-team";
import {previewSeatQuote} from "@/components/billing/pricing-preview-data";
it.each(["cn","us","devapp"] as const)("consumes the strict server quote shape in the %s preview",region=>{
 for(const cycle of ["month","year"] as const){
  const quote=previewSeatQuote(region,cycle,2,region==="us"?"stripe":"wechat");
  expect(TeamQuote.parse(quote)).toEqual(quote);expect(quote.purpose).toBe("add_seats");
  expect(quote.term.purchasedSeats).toBe(5);expect(quote.monthlyCreditsAfter).toBe(130000);
  expect(quote.amountMinor).toBe(region==="us"?(cycle==="year"?25000:2500):(cycle==="year"?149000:14900));
  expect(quote.term.billingCycle).toBe(cycle);expect(Date.parse(quote.expiresAt)).toBeLessThan(Date.parse(quote.term.paidPeriodEnd));
 }
});
