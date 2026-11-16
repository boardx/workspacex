import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { loadAidtSummaryChoices, readAidtSummaryChoice, aidtSummaryImportMarkdown } from "@/features/aidt/lib/aidt-summary-results";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), messages: vi.fn(), artifacts: vi.fn(), source: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-step-chat", () => ({ resolveAidtStepChat: mocks.resolve }));
vi.mock("@/lib/live-chat", () => ({ listMessages: mocks.messages, listThreadArtifacts: mocks.artifacts, getThreadArtifactSource: mocks.source }));
const scope = { projectId:"p",orgId:"o",userId:"u",sessionToken:"token",lifecycleKey:"life" };
const message = { id:"ai",authorKind:"agent",authorId:"agent",agentId:"a",text:"# AI总结草稿\n材料仍有缺口。",clientMessageId:null,agentRunId:"run-1",replyToMessageId:"human",createdAt:"2026-11-16T00:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.resolve.mockResolvedValue({threadId:"sum"});
  mocks.messages.mockResolvedValue({messages:[message,{...message,id:"human",authorKind:"human",agentRunId:null}],nextCursor:null});
  mocks.artifacts.mockResolvedValue({items:[{artifactId:"artifact",title:"原生报告产物",mode:"draft",version:null,pinnedBy:null,pinnedAt:null,hasSource:true,messageId:"ai"}]});
  mocks.source.mockResolvedValue({markdown:"实际产物正文",version:null,immutableRevision:"artifact-v1:1",savedAt:"2026-11-16T00:00:00Z",savedBy:"u"});
});
it("only lists real agent/run linked results from a reauthorized SUM thread, including native artifacts", async () => {
  const signal = new AbortController().signal, result = await loadAidtSummaryChoices(scope,"sum",signal);
  expect(result.choices.map(row=>row.id)).toEqual(["ai","artifact"]);
  expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({purpose:"report",thread:"sum",sessionToken:"token",signal}));
  expect(mocks.source).not.toHaveBeenCalled();
});
it("rechecks the selected message and preserves thread, message and actual run provenance on import", async () => {
  const signal = new AbortController().signal, list = await loadAidtSummaryChoices(scope,"sum",signal);
  const result = await readAidtSummaryChoice(scope,"sum",list.choices[0]!,signal);
  const markdown = aidtSummaryImportMarkdown("sum",result);
  for(const text of ["sum","ai","run-1","材料仍有缺口","不是原始证据"]) expect(markdown).toContain(text);
  expect(mocks.source).not.toHaveBeenCalled();
});
it("reads actual artifact source only after a selection and preserves its immutable revision", async () => {
  const signal = new AbortController().signal, list = await loadAidtSummaryChoices(scope,"sum",signal);
  const result = await readAidtSummaryChoice(scope,"sum",list.choices[1]!,signal);
  expect(result.markdown).toBe("实际产物正文"); expect(result.immutableRevision).toBe("artifact-v1:1");
  expect(mocks.source).toHaveBeenCalledWith("sum","artifact","p","token");
});
it("rejects changed messages and authorization loss without exposing a candidate", async () => {
  const signal = new AbortController().signal, list = await loadAidtSummaryChoices(scope,"sum",signal);
  mocks.messages.mockResolvedValueOnce({messages:[{...message,text:"changed"}],nextCursor:null});
  await expect(readAidtSummaryChoice(scope,"sum",list.choices[0]!,signal)).rejects.toThrow("CHANGED");
  mocks.artifacts.mockRejectedValueOnce(new ApiError(403,"FORBIDDEN",{}));
  await expect(loadAidtSummaryChoices(scope,"sum",signal)).rejects.toBeInstanceOf(ApiError);
});
