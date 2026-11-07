import {expect,it,vi} from "vitest";
import {TeamBillingAccess} from "../../src/application/billing/team-billing-access";
import {teamConfiguredProducts} from "../../src/infrastructure/billing/team-product-configuration";
it.each([null,{orgRole:"consultant"}])("rejects non-admin actual target membership %j",async membership=>{
 const findOrgMembership=vi.fn(async()=>membership);
 await expect(new TeamBillingAccess({findOrgMembership,findOrganization:async()=>({kind:"organization"})} as never).authorize({userId:"user",orgId:"other"} as never,"target-org")).rejects.toThrow("forbidden");
 expect(findOrgMembership).toHaveBeenCalledWith("user","target-org");
});
it("uses actual target admin membership rather than principal active org",async()=>{
 const findOrgMembership=vi.fn(async()=>({orgRole:"admin"}));
 expect(await new TeamBillingAccess({findOrgMembership,findOrganization:async()=>({kind:"organization"})} as never).authorize({userId:"user",orgId:"other"} as never,"target-org")).toBe("target-org");
});
it("takes Team base/extra pricing from existing configured row and excludes personal",()=>{
 const row={package_id:"configured-team",region:"cn",currency:"CNY",amount_fen:43210,total_credits:100000,owner_type:"team",product_kind:"subscription",billing_cycle:"year",included_seats:5,extra_seat_amount_fen:7890,extra_seat_monthly_credits:15000,sort_order:0} as const;
 expect(teamConfiguredProducts([row,{...row,owner_type:"user",package_id:"personal"}])).toEqual([{sku:"configured-team",kind:"subscription",currency:"CNY",amountMinor:43210,cycle:"year",includedSeats:5,monthlyCredits:100000,additionalSeatAmountMinor:7890,additionalSeatMonthlyCredits:15000}]);
 expect(()=>teamConfiguredProducts([{...row,included_seats:null}])).toThrow();
});

it.each(["personal-local","platform"])("does not expose organization commerce to %s containers",async kind=>{
 const identity={findOrgMembership:async()=>({orgRole:"admin"}),findOrganization:async()=>({kind})};
 await expect(new TeamBillingAccess(identity as never).authorize({userId:"admin",orgId:"target"} as never,"target")).rejects.toThrow("forbidden");
});
