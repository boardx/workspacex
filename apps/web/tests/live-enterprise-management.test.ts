import {getPlatformOrganization} from "@/lib/live-platform-organizations";
import {platformOrganizations as P} from "@repo/contracts";
import {afterEach,expect,it,vi} from "vitest";
import {operations as C} from "@repo/contracts/billing-team";
import {grantEnterpriseCredits,upgradeEnterprise,enterpriseOperation} from "@/lib/live-enterprise-management";
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("@/lib/api-client",()=>({apiRequest:mock.request}));
afterEach(()=>vi.resetAllMocks());
const input={credits:42,reason:"approved",idempotencyKey:"request-identity-0001"};
const grant={orgId:"org-one",grantRef:"grant",ledgerRef:"ledger",auditRef:"audit",credits:42,balance:42,createdAt:"2026-11-01T00:00:00.000Z"};
it.each([{...grant,orgId:"different-org"},{...grant,credits:43}])("rejects a schema-valid grant whose immutable request facts differ",async receipt=>{
 expect(C.grantEnterpriseCredits.out.safeParse(receipt).success).toBe(true);mock.request.mockResolvedValue(receipt);
 await expect(grantEnterpriseCredits("org-one",input,"original-session-token")).rejects.toThrow("enterprise_response_mismatch");
 expect(mock.request.mock.calls[0]?.[1]).toMatchObject({sessionToken:"original-session-token",body:input});
});
const operation={orgId:"org-one",generation:"current",operationRef:"operation",expectedPlanVersion:1,createdAt:"2026-11-01T00:00:00.000Z",asOf:"2026-11-01T00:00:00.000Z",status:"processing",receipt:null,code:null,nextAction:"retry_original"};
it.each([{...operation,orgId:"different-org"},{...operation,expectedPlanVersion:2}])("rejects a schema-valid upgrade for another organization or requested version",async receipt=>{
 expect(C.createEnterpriseUpgrade.out.safeParse(receipt).success).toBe(true);mock.request.mockResolvedValue(receipt);
 await expect(upgradeEnterprise("org-one",{expectedPlanVersion:1,idempotencyKey:input.idempotencyKey})).rejects.toThrow("enterprise_response_mismatch");
});
it("operation reads cannot accept another original operation reference",async()=>{
 mock.request.mockResolvedValue({...operation,operationRef:"different-operation"});await expect(enterpriseOperation("org-one","operation")).rejects.toThrow("enterprise_response_mismatch");
});

it("organization details cannot retarget a financial action to another schema-valid organization",async()=>{
 const receipt={organization:{orgId:"different-org",name:"Other organization",kind:"organization",memberCount:0,plan:{plan:null,version:0,updatedAt:null,updatedBy:null,enforcement:"pending"}},changes:[]};expect(P.operations.getOrganization.out.safeParse(receipt).success).toBe(true);mock.request.mockResolvedValue(receipt);await expect(getPlatformOrganization("org-one")).rejects.toThrow("platform_organization_response_mismatch");
});

it("an upgrade receipt must retain the initiating actor when the authenticated context is known",async()=>{
 const at=operation.asOf;const receipt={...operation,status:"succeeded",nextAction:null,receipt:{auditRef:"audit",actorId:"different-operator",appliedAt:at,plan:{plan:"enterprise",version:2,updatedAt:at,updatedBy:"different-operator",enforcement:"active",billingGeneration:operation.generation},prepaidTeamPolicy:"continue_until_paid_end",retainedTeamPayment:null}};expect(C.createEnterpriseUpgrade.out.safeParse(receipt).success).toBe(true);mock.request.mockResolvedValue(receipt);await expect(upgradeEnterprise("org-one",{expectedPlanVersion:1,idempotencyKey:input.idempotencyKey},"original-session-token","operator")).rejects.toThrow("enterprise_response_mismatch");
});
