import { describe, expect, it, vi } from "vitest";
import { runAguiBridgeTurn, type AguiBridgeDeps } from "../../src/application/agent-run/agui-bridge";
import { AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { toOrgId } from "../../src/domain/org-id";
const mocks=vi.hoisted(()=>({accept:vi.fn()}));
vi.mock("../../src/application/chat/message-roundtrip",async original=>({...await original<object>(),acceptHumanMessage:mocks.accept}));
const selector=AidtContextSelector.parse({schemaVersion:1,purpose:"stage",projectId:"p",stageId:1,stageRevisions:[]});
const input={userId:"u",orgId:toOrgId("o"),agentId:"a",text:" \n中文原句 \" ? ",clientMessageId:"m",threadId:"real-thread",aidtContext:selector,maxPolls:0};
describe("AGUI application bridge to the one message acceptance boundary",()=>{
 it("passes selector without rewriting human text or substituting stage references",async()=>{mocks.accept.mockResolvedValue({agentRunId:"r",reused:false});const kick=vi.fn();const deps={executor:{kick}} as unknown as AguiBridgeDeps;await expect(runAguiBridgeTurn(deps,input)).resolves.toMatchObject({kind:"timeout"});expect(mocks.accept).toHaveBeenCalledWith(deps,expect.objectContaining({aidtContext:selector,text:input.text,clientMessageId:"m",threadId:"real-thread"}));});
 it("does not invent a private thread for an AIDT selector",async()=>{mocks.accept.mockClear();await expect(runAguiBridgeTurn({} as AguiBridgeDeps,{...input,threadId:null})).rejects.toMatchObject({reasonCode:"AIDT_CONTEXT_INVALID"});expect(mocks.accept).not.toHaveBeenCalled();});
});
