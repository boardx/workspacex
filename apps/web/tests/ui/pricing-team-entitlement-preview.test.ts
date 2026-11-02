import {expect,it} from "vitest";
import {TeamEntitlement} from "@repo/contracts/billing-team";
import {previewTeamEntitlement} from "@/components/billing/pricing-preview-data";
it.each(["cn","us","devapp"] as const)("consumes an actual entitlement shape for %s without reducing purchased seats to four",region=>{
 for(const cycle of ["month","year"] as const)for(const expired of [false,true]){
  const value=previewTeamEntitlement(region,cycle,expired);
  expect(TeamEntitlement.parse(value)).toEqual(value);
  expect(value.licenseStatus).toBe(expired?"expired":"active");expect(value.memberCount).toBe(4);
  expect(value.teamPayment.term.purchasedSeats).toBe(5);expect(value.teamPayment.term.monthlyCredits).toBe(100000);
  expect(value.creditGrant.grant.remainingCredits).toBe(expired?0:64000);
  expect(value.wallet.permanentBalance).toBe(8600);expect(value.wallet.subscriptionCredits).toBe(expired?0:64000);
 }
});
