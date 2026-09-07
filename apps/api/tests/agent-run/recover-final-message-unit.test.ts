import {describe,it,expect,vi} from "vitest";
import {recoverFinalMessageIdentity} from "../../src/application/agent-run/recover-final-message";
import type {AgentRunStore} from "../../src/application/agent-run/ports";
import {ExecutionEvent} from "@repo/contracts/execution-journal";
import {toOrgId} from "../../src/domain/org-id";
const org=toOrgId("o");
describe("recovered stream final identity",()=>{
 it("links a half-streamed reply to its original attempt exactly once",async()=>{
  const events=[ExecutionEvent.parse({runId:"r",seq:0,emittedAt:new Date().toISOString(),kind:"text_delta",attemptId:"r:3",messageId:"r:3:actual-ai-id",delta:"Partial an"})];
  const appendExecutionEvent=vi.fn(async(_org:unknown,_id:string,event:unknown)=>{events.push(ExecutionEvent.parse({...event as object,runId:"r",seq:events.length,emittedAt:new Date().toISOString()}));});
  const runs={readExecutionEvents:vi.fn(async()=>events),appendExecutionEvent} satisfies Pick<AgentRunStore,"readExecutionEvents"|"appendExecutionEvent">;
  await recoverFinalMessageIdentity(runs,org,"r","actual-ai-id");
  expect(appendExecutionEvent).toHaveBeenCalledWith(org,"r",{kind:"final_message",attemptId:"r:3",messageId:"r:3:actual-ai-id"});
  await recoverFinalMessageIdentity(runs,org,"r","actual-ai-id");
  expect(appendExecutionEvent).toHaveBeenCalledTimes(1);
 });
 it("does not invent final associations when the remote id is absent or unmatched",async()=>{
  const appendExecutionEvent=vi.fn();const runs={readExecutionEvents:vi.fn().mockResolvedValue([]),appendExecutionEvent};
  await recoverFinalMessageIdentity(runs,org,"r",undefined);
  await recoverFinalMessageIdentity(runs,org,"r","unmatched");
  expect(appendExecutionEvent).not.toHaveBeenCalled();
 });
});
