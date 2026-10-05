import {describe,expect,it,vi} from "vitest";
import {aiUsage as C} from "@repo/contracts";
import {scopeAiUsage} from "../../src/application/auth/ai-usage-ports";
import {AiUsageController} from "../../src/interface/controllers/ai-usage.controller";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("org-usage-scope"),principal={orgId:org,userId:"member-a"};
const query=C.Query.parse({start:"2026-10-01T00:00:00Z",end:"2026-10-02T00:00:00Z",timezone:"Etc/UTC"});
describe("same-ledger usage authorization",()=>{
 it("ordinary members are forcibly self-scoped and cannot choose another member",async()=>{
  const identity={findOrgMembership:async()=>({orgRole:"consultant" as const,teamId:null})};
  expect((await scopeAiUsage(identity,principal,org,query)).userId).toBe("member-a");
  await expect(scopeAiUsage(identity,principal,org,{...query,userId:"member-b"})).rejects.toMatchObject({reasonCode:"FORBIDDEN"});
 });
 it("an org admin can filter own-org members; membership is checked in target tenant",async()=>{
  const identity={findOrgMembership:vi.fn(async()=>({orgRole:"admin" as const,teamId:null}))};
  expect((await scopeAiUsage(identity,principal,org,{...query,userId:"member-b"})).userId).toBe("member-b");
  expect(identity.findOrgMembership).toHaveBeenCalledWith(principal.userId,org);
 });
 it("no membership rejects before summary or calls repository access",async()=>{
  const usage={summary:vi.fn(),calls:vi.fn()};
  const controller=new AiUsageController(usage,{findOrgMembership:async()=>null} as never);
  await expect(controller.summary("other-org",query,principal)).rejects.toMatchObject({status:403});
  await expect(controller.calls("other-org",query,principal)).rejects.toMatchObject({status:403});
  expect(usage.summary).not.toHaveBeenCalled();expect(usage.calls).not.toHaveBeenCalled();
 });
 it("invalid timezone/window, conflicting project filters and incomplete cursors are rejected",()=>{
  expect(()=>C.Query.parse({...query,timezone:"guess/a-zone"})).toThrow();
  expect(()=>C.Query.parse({...query,end:query.start})).toThrow();
  expect(()=>C.Query.parse({...query,projectId:"p",unassignedProject:"true"})).toThrow();
  expect(()=>C.Query.parse({...query,cursorId:"receipt-a"})).toThrow();
  expect(()=>C.Query.parse({...query,limit:101})).toThrow();
 });
});
