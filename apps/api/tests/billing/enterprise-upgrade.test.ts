import {expect,it,vi} from "vitest";
import {EnterpriseUpgrade} from "../../src/application/billing/enterprise-upgrade";
import {EnterpriseError,type EnterprisePaidTeamPort,type EnterpriseUpgradeStore} from "../../src/application/billing/enterprise-ports";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("org-enterprise");
const operation={orgId:org,generation:"billing-credits-2026-11-v1",operationRef:"original-operation",expectedPlanVersion:3,createdAt:"2026-11-01T00:00:00.000Z",asOf:"2026-11-01T00:00:00.000Z",status:"processing",receipt:null,code:null,nextAction:"retry_original"} as const;
function setup(paid:EnterprisePaidTeamPort|null){
 const store={begin:vi.fn().mockResolvedValue(operation),read:vi.fn().mockResolvedValue(operation),pending:vi.fn().mockImplementation(async(_org,_ref,code)=>({...operation,code})),activate:vi.fn().mockResolvedValue({...operation,status:"succeeded"})} satisfies EnterpriseUpgradeStore;
 return {store,service:new EnterpriseUpgrade(store,paid)};
}
it("missing payment source keeps original operation and never activates",async()=>{
 const {store,service}=setup(null);const out=await service.upgrade(org,"operator",{expectedPlanVersion:3,idempotencyKey:"attempt-00000001"});
 expect(out.operationRef).toBe(operation.operationRef);expect(out.code).toBe("dependency_unavailable");expect(store.activate).not.toHaveBeenCalled();
});
it("payment read failure cannot masquerade as no paid term",async()=>{
 const {store,service}=setup({readPaidTeamTerm:async()=>{throw Error("offline");},stopFutureRenewal:vi.fn()});
 await service.upgrade(org,"operator",{expectedPlanVersion:3,idempotencyKey:"attempt-00000001"});expect(store.activate).not.toHaveBeenCalled();
});
it("verified absence is the only no-term path; cancellation is not invented",async()=>{
 const cancel=vi.fn();const {store,service}=setup({readPaidTeamTerm:async()=>null,stopFutureRenewal:cancel});
 await service.upgrade(org,"operator",{expectedPlanVersion:3,idempotencyKey:"attempt-00000001"});expect(cancel).not.toHaveBeenCalled();expect(store.activate).toHaveBeenCalledWith(org,operation.operationRef,null);
});
it("Plan conflict is retained as review of the original operation",async()=>{
 const {store,service}=setup({readPaidTeamTerm:async()=>null,stopFutureRenewal:vi.fn()});store.activate.mockRejectedValue(new EnterpriseError("PLAN_VERSION_CONFLICT"));
 await service.upgrade(org,"operator",{expectedPlanVersion:3,idempotencyKey:"attempt-00000001"});expect(store.pending).toHaveBeenCalledWith(org,operation.operationRef,"PLAN_VERSION_CONFLICT");
});
const paid={provider:"stripe",renewalMode:"automatic",cancelAtPeriodEnd:false,subscriptionStatus:"active",term:{purchaseAnchor:"2026-11-01T00:00:00.000Z",paidPeriodStart:"2026-11-01T00:00:00.000Z",paidPeriodEnd:"2027-11-01T00:00:00.000Z",billingCycle:"year",purchasedSeats:5,monthlyCredits:100000}} as const;
it("unconfirmed cancellation keeps the original paid Plan",async()=>{
 const {store,service}=setup({readPaidTeamTerm:async()=>paid,stopFutureRenewal:async()=>paid});
 await service.upgrade(org,"operator",{expectedPlanVersion:3,idempotencyKey:"attempt-00000001"});expect(store.activate).not.toHaveBeenCalled();
});
it("already canceled Stripe false flag is a real terminal status",async()=>{
 const stopped={...paid,subscriptionStatus:"canceled"} as const;const {store,service}=setup({readPaidTeamTerm:async()=>paid,stopFutureRenewal:async()=>stopped});
 await service.upgrade(org,"operator",{expectedPlanVersion:3,idempotencyKey:"attempt-00000001"});expect(store.activate).toHaveBeenCalledWith(org,operation.operationRef,stopped);
});
it("cancellation must not move the purchase anchor or drop paid quota",async()=>{
 const {store,service}=setup({readPaidTeamTerm:async()=>paid,stopFutureRenewal:async()=>({...paid,cancelAtPeriodEnd:true,term:{...paid.term,monthlyCredits:1}})});
 await service.upgrade(org,"operator",{expectedPlanVersion:3,idempotencyKey:"attempt-00000001"});expect(store.activate).not.toHaveBeenCalled();
});
