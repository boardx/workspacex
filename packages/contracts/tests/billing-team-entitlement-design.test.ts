import {expect,it} from "vitest";
import {TeamEntitlement} from "../src/billing-team";
const term={purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",paidPeriodEnd:"2027-11-01T10:00:00Z",billingCycle:"year",purchasedSeats:5,monthlyCredits:100000};
const grant={status:"granted",grant:{credits:100000,remainingCredits:64000,periodStart:"2026-11-01T10:00:00Z",periodEnd:"2026-12-01T10:00:00Z"}};
const wallet={ownerType:"team",ownerId:"org-a",balance:72600,permanentBalance:8600,subscriptionCredits:64000,subscriptionExpiresAt:"2026-12-01T10:00:00Z",totalPurchased:8600,totalGranted:100000,updatedAt:"2026-11-16T10:00:00Z"};
const active={orgId:"org-a",generation:"pricing-v1",planVersion:1,asOf:"2026-11-16T10:00:00Z",licenseStatus:"active",memberCount:4,teamPayment:{term,provider:"wechat",renewalMode:"manual",cancelAtPeriodEnd:false},creditGrant:grant,wallet,checkoutPending:false,paymentReviewRequired:false};
it("keeps actual members, purchased capacity, paid year and current monthly grant separate",()=>{
 expect(TeamEntitlement.parse(active)).toEqual(active);
 expect(TeamEntitlement.safeParse({...active,memberCount:7}).success).toBe(true); // Existing over-capacity members are not deleted.
});
it.each([
 {licenseStatus:"none"},{teamPayment:null},{asOf:term.paidPeriodEnd},
 {teamPayment:{...active.teamPayment,provider:"stripe"}},
 {teamPayment:{...active.teamPayment,cancelAtPeriodEnd:true}},
 {creditGrant:{...grant,grant:{...grant.grant,periodEnd:term.paidPeriodEnd}}},
 {creditGrant:{...grant,grant:{...grant.grant,remainingCredits:100001}}},
 {creditGrant:{...grant,grant:{...grant.grant,credits:1200000}}},
])("rejects a contradictory entitlement %j",patch=>{
 expect(TeamEntitlement.safeParse({...active,...patch}).success).toBe(false);
});
it("represents delayed monthly granting without inventing issued credits",()=>{
 const wallet={...active.wallet,balance:8600,subscriptionCredits:0,subscriptionExpiresAt:null};
 expect(TeamEntitlement.safeParse({...active,creditGrant:{status:"pending",grant:null},wallet}).success).toBe(true);
 expect(TeamEntitlement.safeParse({...active,creditGrant:{status:"pending",grant:grant.grant}}).success).toBe(false);
});
it("requires a closed old grant at paid expiry while retaining permanent funds",()=>{
 const expired={...active,asOf:term.paidPeriodEnd,licenseStatus:"expired",creditGrant:{status:"expired",grant:{...grant.grant,remainingCredits:0}},wallet:{...wallet,balance:8600,subscriptionCredits:0,subscriptionExpiresAt:null}};
 expect(TeamEntitlement.parse(expired)).toEqual(expired);
 expect(TeamEntitlement.safeParse({...expired,creditGrant:grant}).success).toBe(false);
});
it("keeps an unconfigured organization distinct from a purchased five-seat team",()=>{
 const none={...active,licenseStatus:"none",teamPayment:null,creditGrant:{status:"none",grant:null},wallet:{...wallet,balance:8600,subscriptionCredits:0,subscriptionExpiresAt:null}};
 expect(TeamEntitlement.parse(none)).toEqual(none);
 expect(TeamEntitlement.safeParse({...none,teamPayment:active.teamPayment}).success).toBe(false);
});
it("shows Enterprise without inventing Team limits or destroying known prepaid facts",()=>{
 expect(TeamEntitlement.safeParse({...active,licenseStatus:"enterprise"}).success).toBe(true);
 const stripe={...active.teamPayment,provider:"stripe",renewalMode:"automatic",cancelAtPeriodEnd:true};
 expect(TeamEntitlement.safeParse({...active,licenseStatus:"enterprise",teamPayment:stripe}).success).toBe(true);
 expect(TeamEntitlement.safeParse({...active,licenseStatus:"enterprise",teamPayment:{...stripe,cancelAtPeriodEnd:false}}).success).toBe(false);
});
it.each(["ownerType","ownerId"])("rejects a wallet from another scope via %s",field=>{
 expect(TeamEntitlement.safeParse({...active,wallet:{...wallet,[field]:field==="ownerType"?"user":"org-b"}}).success).toBe(false);
});
it.each(["permanentBalance","subscriptionCredits","subscriptionExpiresAt"])("does not fabricate a missing wallet fact %s",field=>{
 const incomplete:Record<string,unknown>={...wallet};delete incomplete[field];
 expect(TeamEntitlement.safeParse({...active,wallet:incomplete}).success).toBe(false);
});
it("rejects a mismatched monthly balance and unknown financial facts",()=>{
 for(const patch of [{wallet:{...wallet,subscriptionCredits:63000}},{wallet:{...wallet,balance:null}},{licenseStatus:"unknown"},{isEnterprise:true},{newAiAllowed:true}])
  expect(TeamEntitlement.safeParse({...active,...patch}).success).toBe(false);
});
it("compares expiry instants rather than ISO formatting",()=>{
 expect(TeamEntitlement.safeParse({...active,wallet:{...wallet,subscriptionExpiresAt:"2026-12-01T18:00:00+08:00"}}).success).toBe(true);
});
it("represents a manually managed Enterprise without a fabricated paid Team term",()=>{
 const enterprise={...active,licenseStatus:"enterprise",teamPayment:null,creditGrant:{status:"none",grant:null},wallet:{...wallet,balance:8600,subscriptionCredits:0,subscriptionExpiresAt:null}};
 expect(TeamEntitlement.parse(enterprise)).toEqual(enterprise);
 expect(TeamEntitlement.safeParse({...enterprise,creditGrant:grant,wallet}).success).toBe(false);
});
it("preserves fractional first-seat grants in the shared wallet total",()=>{
 const fractional={...active,teamPayment:{...active.teamPayment,term:{...term,purchasedSeats:6,monthlyCredits:115000}},creditGrant:{...grant,grant:{...grant.grant,credits:100000.25,remainingCredits:64000.25}},wallet:{...wallet,balance:72600.25,subscriptionCredits:64000.25,totalGranted:100000.25}};
 expect(TeamEntitlement.parse(fractional)).toEqual(fractional);
 for(const totalGranted of [-1,100000.251,Infinity])expect(TeamEntitlement.safeParse({...fractional,wallet:{...fractional.wallet,totalGranted}}).success).toBe(false);
});
it("does not erase confirmed credit debt or accept mismatched wallet components",()=>{
 expect(TeamEntitlement.safeParse({...active,wallet:{...wallet,balance:-100.25,permanentBalance:-64100.25}}).success).toBe(true);
 expect(TeamEntitlement.safeParse({...active,wallet:{...wallet,balance:72601}}).success).toBe(false);
});
