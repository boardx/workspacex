import {expect,it} from "vitest";
import {EnterpriseUpgradeOperation,TeamBillingRejection,operations as implementedOperations} from "../src/billing-team";
import {operations} from "../../../phases/phase-21-billing-payment/design-deltas/team-enterprise-v1/operations.proposal";
const time="2026-11-16T10:00:00Z",generation="pricing-v1";
const term={purchaseAnchor:"2026-11-01T10:00:00Z",paidPeriodStart:"2026-11-01T10:00:00Z",paidPeriodEnd:"2027-11-01T10:00:00Z",billingCycle:"year",purchasedSeats:7,monthlyCredits:130000};
const pending={orgId:"org-a",generation,operationRef:"operation-a",expectedPlanVersion:1,createdAt:time,asOf:"2026-11-16T10:02:00Z",status:"processing",receipt:null,code:null,nextAction:"retry_original"};
const receipt={auditRef:"audit-a",actorId:"platform-operator",appliedAt:"2026-11-16T10:01:00Z",plan:{plan:"enterprise",version:2,updatedAt:"2026-11-16T10:01:00Z",updatedBy:"platform-operator",enforcement:"active",billingGeneration:generation},prepaidTeamPolicy:"continue_until_paid_end",retainedTeamPayment:{term,provider:"stripe",renewalMode:"automatic",cancelAtPeriodEnd:true,subscriptionStatus:"active"}};
const success={...pending,status:"succeeded",receipt,code:null,nextAction:null};
it("distinguishes a recoverable in-progress operation from actual Enterprise activation",()=>{
 expect(EnterpriseUpgradeOperation.parse(pending)).toEqual(pending);expect(EnterpriseUpgradeOperation.parse(success)).toEqual(success);
 expect(EnterpriseUpgradeOperation.safeParse({...pending,receipt}).success).toBe(false);
 expect(EnterpriseUpgradeOperation.safeParse({...success,receipt:null}).success).toBe(false);
});
it.each([
 {prepaidTeamPolicy:"stop"},{actorId:"another-operator"},{appliedAt:"2026-11-17T10:00:00Z"},
 {plan:{...receipt.plan,version:3}},{plan:{...receipt.plan,billingGeneration:"old"}},{plan:{...receipt.plan,plan:"ordinary"}},
 {retainedTeamPayment:{...receipt.retainedTeamPayment,cancelAtPeriodEnd:false}},
])("rejects fabricated or incoherent activation facts %j",patch=>{
 expect(EnterpriseUpgradeOperation.safeParse({...success,receipt:{...receipt,...patch}}).success).toBe(false);
});
it("retains a canceled paid Stripe term and allows Enterprise without prior Team",()=>{
 expect(EnterpriseUpgradeOperation.safeParse({...success,receipt:{...receipt,retainedTeamPayment:{...receipt.retainedTeamPayment,cancelAtPeriodEnd:false,subscriptionStatus:"canceled"}}}).success).toBe(true);
 expect(EnterpriseUpgradeOperation.safeParse({...success,receipt:{...receipt,retainedTeamPayment:null}}).success).toBe(true);
});
it("uses the production code envelope, keeping unknown failures distinct",()=>{
 const error={error:"conflict",traceId:"trace-a",code:"capacity_insufficient"};
 expect(TeamBillingRejection.parse(error)).toEqual(error);
 expect(TeamBillingRejection.safeParse({...error,code:"unknown"}).success).toBe(false);
 expect(TeamBillingRejection.safeParse({error:"conflict",traceId:"trace-a",reasonCode:error.code}).success).toBe(false);
});
it("exports each organization/platform operation once without caller-owned route scope in mutations",()=>{
 const entries=Object.values(operations);expect(new Set(entries.map(o=>`${o.method} ${o.path}`)).size).toBe(entries.length);
 expect(operations.getTeamCatalog.path).toBe("/billing/organizations/:orgId/catalog");
 expect(operations.getTeamPurchase.out).toBe(operations.createTeamCheckout.out);
 expect(operations.createEnterpriseUpgrade.out).toBe(operations.getEnterpriseUpgradeOperation.out);
 for(const operation of [operations.createTeamQuote,operations.createTeamCheckout,operations.createEnterpriseUpgrade,operations.grantEnterpriseCredits]){
  expect(operation.in.safeParse({orgId:"org-b",actorId:"forged",generation:"old"}).success).toBe(false);
 }
});
it("retains all eight implemented Team and Enterprise operations in the proposal by reference",()=>{
 expect(Object.keys(implementedOperations).sort()).toEqual(["getTeamCatalog","getTeamEntitlement","createTeamQuote","createTeamCheckout","getTeamPurchase","createEnterpriseUpgrade","getEnterpriseUpgradeOperation","grantEnterpriseCredits"].sort());
 for(const [name,operation] of Object.entries(implementedOperations))expect(operations[name as keyof typeof implementedOperations]).toBe(operation);
 expect(Object.keys(operations)).toHaveLength(Object.keys(implementedOperations).length+2);
});
