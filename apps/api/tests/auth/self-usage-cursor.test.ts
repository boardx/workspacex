import {expect,it,vi} from "vitest";
import {aiUsage as C} from "@repo/contracts";
import {SelfAiUsageService} from "../../src/application/auth/self-ai-usage-service";
import {toOrgId} from "../../src/domain/org-id";
import type {AiUsageRepository} from "../../src/application/auth/ai-usage-ports";

function fixture(){
 const principal={userId:"cursor-user",orgId:toOrgId("cursor-org")};
 const memberships=vi.fn(async()=>[{orgId:"cursor-org",orgRole:"admin" as const}]);
 const row=C.Call.parse({id:"call-1",userId:principal.userId,runId:null,projectId:null,
  threadId:null,agentId:null,modelProvider:"provider",modelId:"model",
  occurredAt:"2026-01-02T00:00:00.000Z",startedAt:null,endedAt:null,executionAttemptId:null,
  totalTokens:"1000",inputTokens:"500",outputTokens:"500",totalSource:"reported",
  outcome:"succeeded",callPurpose:null,costMicros:null,currency:null,priceVersion:null});
 const calls=vi.fn<AiUsageRepository["calls"]>(async(_org,query)=>({
  asOf:query.asOf!,coverage:"partial",calls:query.cursorId?[]:[row],
  nextCursor:query.cursorId?null:{occurredAt:row.occurredAt,id:row.id},
 }));
 const service=new SelfAiUsageService({listMemberships:memberships},{calls,summary:vi.fn()});
 const query=C.Query.parse({start:"2026-01-01T00:00:00.000Z",end:"2026-01-03T00:00:00.000Z",
  timezone:"Etc/UTC",modelId:"model",limit:1});
 return {principal,memberships,calls,service,query};
}

it("continues a calls snapshot started without asOf using its returned cursor",async()=>{
 const {service,principal,query,calls}=fixture();
 const first=await service.calls(principal,query);
 expect(first.nextCursor).not.toBeNull();
 const second=await service.calls(principal,{...query,asOf:first.asOf,
  cursorId:first.nextCursor!.id,cursorTime:first.nextCursor!.occurredAt});
 expect(second.calls).toEqual([]);
 expect(calls.mock.calls[1]![1]).toMatchObject({asOf:first.asOf,cursorId:"call-1"});
});

it("still rejects cursor reuse across filters, snapshots, users and membership scopes",async()=>{
 const {service,principal,query,memberships}=fixture();
 const first=await service.calls(principal,query);
 const next={...query,asOf:first.asOf,cursorId:first.nextCursor!.id,cursorTime:first.nextCursor!.occurredAt};
 for(const change of [{modelId:"other"},{asOf:"2026-01-03T00:00:00.000Z"}]){
  await expect(service.calls(principal,{...next,...change})).rejects.toMatchObject({reasonCode:"FORBIDDEN"});
 }
 await expect(service.calls({...principal,userId:"another-user"},next)).rejects.toMatchObject({reasonCode:"FORBIDDEN"});
 memberships.mockResolvedValue([]);
 await expect(service.calls(principal,next)).rejects.toMatchObject({reasonCode:"FORBIDDEN"});
});
