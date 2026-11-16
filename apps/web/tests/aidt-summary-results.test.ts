import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { AidtContextReceipt } from "@repo/contracts/aidt-run-context";
import { loadAidtSummaryChoices, readAidtSummaryChoice, aidtSummaryImportMarkdown } from "@/features/aidt/lib/aidt-summary-results";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), messages: vi.fn(), artifacts: vi.fn(), source: vi.fn(), receipt: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-step-chat", () => ({ resolveAidtStepChat: mocks.resolve }));
vi.mock("@/lib/live-chat", () => ({ listMessages: mocks.messages, listThreadArtifacts: mocks.artifacts, getThreadArtifactSource: mocks.source }));
vi.mock("@/features/aidt/lib/live-aidt-run-context", () => ({ readAidtRunContext: mocks.receipt }));
const scope = { projectId:"p",orgId:"o",userId:"u",sessionToken:"token",lifecycleKey:"life" };
const message = { id:"ai",authorKind:"agent",authorId:"agent",agentId:"a",text:"# AI总结草稿\n材料仍有缺口。",clientMessageId:null,agentRunId:"run-1",replyToMessageId:"human",createdAt:"2026-11-16T00:00:00Z" };
const receipt = AidtContextReceipt.parse({runId:"run-1",projectId:"p",purpose:"summary",skillVersionId:"summary-version",snapshotHash:"a".repeat(64),preparedAt:"2026-11-16T00:00:00Z",stageRevisions:[{stageId:5,revision:4},{stageId:6,revision:7}],historyRevisions:[{stageId:6,revision:4}],truncated:true,omissions:[{kind:"truncated",stageId:6,revision:4},{kind:"original-file-bytes-not-read"}],application:{state:"message-dispatch-observed",attemptId:"attempt",assembledContextHash:"b".repeat(64),assembledAt:"2026-11-16T00:00:00Z",messageDispatchedAt:"2026-11-16T00:00:00Z",checkpointResumedAt:null,inheritedMessageDispatchAttemptId:null}});
beforeEach(() => {
  vi.resetAllMocks(); mocks.resolve.mockResolvedValue({threadId:"sum"});
  mocks.messages.mockResolvedValue({messages:[message,{...message,id:"human",authorKind:"human",agentRunId:null}],nextCursor:null});
  mocks.artifacts.mockResolvedValue({items:[{artifactId:"artifact",title:"原生报告产物",mode:"draft",version:null,pinnedBy:null,pinnedAt:null,hasSource:true,messageId:"ai"}]});
  mocks.source.mockResolvedValue({markdown:"实际产物正文",version:null,immutableRevision:"artifact-v1:1",savedAt:"2026-11-16T00:00:00Z",savedBy:"u"});
  mocks.receipt.mockRejectedValue(new ApiError(404,"AIDT_CONTEXT_NOT_AVAILABLE",{}));
});
it("only lists real agent/run linked results from a reauthorized SUM thread, including native artifacts", async () => {
  const signal = new AbortController().signal, result = await loadAidtSummaryChoices(scope,"sum",signal);
  expect(result.choices.map(row=>row.id)).toEqual(["ai","artifact"]);
  expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({purpose:"report",thread:"sum",sessionToken:"token",signal}));
  expect(mocks.source).not.toHaveBeenCalled();
  expect(mocks.receipt).not.toHaveBeenCalled();
});
it("rechecks the selected message and preserves thread, message and actual run provenance on import", async () => {
  const signal = new AbortController().signal, list = await loadAidtSummaryChoices(scope,"sum",signal);
  const result = await readAidtSummaryChoice(scope,"sum",list.choices[0]!,signal);
  const markdown = aidtSummaryImportMarkdown("sum",result);
  for(const text of ["sum","ai","run-1","材料仍有缺口","不是原始证据"]) expect(markdown).toContain(text);
  expect(mocks.source).not.toHaveBeenCalled();
  expect(markdown).toContain("运行材料回执未能读取");
  expect(mocks.receipt).toHaveBeenCalledWith({projectId:"p",runId:"run-1"},"token",signal);
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
it("discloses exact old/current versions and omitted ranges without repairing the selected AI body", async () => {
  mocks.receipt.mockResolvedValue(receipt);
  const signal = new AbortController().signal, list = await loadAidtSummaryChoices(scope,"sum",signal);
  const result = await readAidtSummaryChoice(scope,"sum",list.choices[0]!,signal);
  const imported = aidtSummaryImportMarkdown("sum",result);
  expect(result.markdown).toBe(message.text);
  for(const text of ["第5步 V4","第6步 V7","历史版本：第6步 V4","来源已截断","第6步 V4：仅传入部分摘录","未读取原始文件字节","不是AI报告正文","未经软件改写"]) expect(imported).toContain(text);
  expect(imported).not.toContain("V2已生成");
});
it.each([401,403])("does not expose a selection after run receipt access is revoked (%i)", async status => {
  mocks.receipt.mockRejectedValue(new ApiError(status,"FORBIDDEN",{}));
  const signal = new AbortController().signal, list = await loadAidtSummaryChoices(scope,"sum",signal);
  await expect(readAidtSummaryChoice(scope,"sum",list.choices[0]!,signal)).rejects.toBeInstanceOf(ApiError);
});
it("rejects run/task mismatches rather than presenting a mismatched source as unavailable", async () => {
  const signal = new AbortController().signal, list = await loadAidtSummaryChoices(scope,"sum",signal);
  mocks.receipt.mockResolvedValueOnce({purpose:"stage"});
  await expect(readAidtSummaryChoice(scope,"sum",list.choices[0]!,signal)).rejects.toThrow("TASK_MISMATCH");
  mocks.receipt.mockRejectedValueOnce(new Error("AIDT_CONTEXT_RECEIPT_SCOPE_MISMATCH"));
  await expect(readAidtSummaryChoice(scope,"sum",list.choices[0]!,signal)).rejects.toThrow("SCOPE_MISMATCH");
});
it("keeps an unknown range explicit after receipt service failure and rejects a late cancelled result", async () => {
  const controller = new AbortController(), list = await loadAidtSummaryChoices(scope,"sum",controller.signal);
  mocks.receipt.mockRejectedValueOnce(new ApiError(503,"UNAVAILABLE",{}));
  const result = await readAidtSummaryChoice(scope,"sum",list.choices[0]!,controller.signal);
  expect(result.sourceReview.status).toBe("unavailable");
  mocks.receipt.mockImplementationOnce(async()=>{controller.abort(); throw new Error("cancelled");});
  await expect(readAidtSummaryChoice(scope,"sum",list.choices[0]!,controller.signal)).rejects.toThrow("CONTEXT_CHANGED");
});
