import {expect,it} from "vitest";
import {resolveTeamAiLicense} from "../../src/domain/billing/team-ai-license";
const term={purchaseAnchor:"2026-01-31T10:00:00Z",paidPeriodStart:"2026-01-31T10:00:00Z",paidPeriodEnd:"2027-01-31T10:00:00Z",billingCycle:"year",purchasedSeats:5,monthlyCredits:100000};
const plan={plan:"ordinary",billingGeneration:"current"};
it("admits a current paid Team term only within its actual paid interval",()=>{
 expect(resolveTeamAiLicense("current",plan,[term],new Date(term.paidPeriodStart))).toBe("allowed");
 expect(resolveTeamAiLicense("current",plan,[term],new Date(term.paidPeriodEnd))).toBe("subscription_required");
 expect(resolveTeamAiLicense("current",null,[],new Date())).toBe("subscription_required");
});
it("current Enterprise licensing is independent of an old paid Team cutoff",()=>{
 expect(resolveTeamAiLicense("current",{plan:"enterprise",billingGeneration:"current"},[term],new Date("2028-01-01"))).toBe("allowed");
});
it.each([{plan:"enterprise",billingGeneration:"old"},{plan:"enterprise",billingGeneration:null}])("never revives Enterprise from old metadata %j",p=>{
 expect(resolveTeamAiLicense("current",p,[],new Date())).toBe("unavailable");
});
it("treats malformed or overlapping paid facts as unavailable rather than inventing a license",()=>{
 expect(resolveTeamAiLicense("current",plan,[{}],new Date())).toBe("unavailable");
 expect(resolveTeamAiLicense("current",plan,[term,term],new Date("2026-05-01"))).toBe("unavailable");
});
