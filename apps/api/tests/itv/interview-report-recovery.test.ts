import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { toOrgId } from "../../src/domain/org-id";
import { generateInterviewMarkdown } from "../../src/application/interview/generate-interview-markdown";
import { DigitalInterviewWorkflowError } from "../../src/application/interview/workflow/digital-interview-runtime.port";
import { ModelCallError } from "../../src/application/agent-run/ports";
import { interviewMarkdown } from "@repo/contracts";
import type { z } from "zod";
type InterviewMarkdownEnvelope = z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>;
const read = vi.hoisted(() => vi.fn());
vi.mock("../../src/application/interview/read-interview-markdown", () => ({ readInterviewMarkdown: read }));
const BAD = "# 未完成报告\n\n专家甲说要电话，专家乙说不要电话。保留相反意见原文。";
const GOOD = "# 探索性结论\n\n跨回答综合：两位专家意见相反，应分层验证而非多数表决。\n决策影响：应优先验证客户偏好，暂缓统一渠道。\n边界与反例：仅模拟角色，不代表真人证据。\n建议行动：P0：用独立真人任务验证渠道假设，以完成时长和再次进线率为指标。";
const input = { orgId: toOrgId("org-recovery"), interviewId: "itv-recovery", viewerUserId: "actor", expectedVersion: 7, expectedDocumentVersion: 0, step: "report" as const };
let snapshot: InterviewMarkdownEnvelope;
const complete = vi.fn(); const save = vi.fn();
function deps() { return { reader: { saveDraft: save }, model: { complete }, modelProvider: "fixture", modelId: "fixture" } as unknown as Parameters<typeof generateInterviewMarkdown>[0]; }
beforeEach(() => {
 vi.clearAllMocks();
 snapshot = { interviewId: input.interviewId, revisionId: "rev-recovery", version: 7, documents: [{ documentId: "md-runs", step: "runs", version: 1, markdown: "## [甲](#expert-a)\n反对电话。\n## [乙](#expert-b)\n支持电话。", contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] }], states: [{ documentId: "md-runs", status: "completed", failure: null }], execution: null, review: null };
 read.mockImplementation(async () => structuredClone(snapshot));
 save.mockImplementation(async (value: { markdown: string; failure?: {code: string;retryable: boolean};expectedVersion: number;expectedDocumentVersion: number;references: InterviewMarkdownEnvelope["documents"][number]["references"] }) => {
  expect(value.expectedVersion).toBe(snapshot.version);
  expect(value.expectedDocumentVersion).toBe(snapshot.documents.find(d => d.step === "report")?.version ?? 0);
  snapshot.version++;
  const doc = { documentId: "md-report", step: "report" as const, version: value.expectedDocumentVersion + 1, markdown: value.markdown, contentHash: createHash("sha256").update(value.markdown).digest("hex"), evidenceMode: "simulated" as const, references: value.references };
  snapshot.documents = [...snapshot.documents.filter(d => d.step !== "report"),doc];
  snapshot.states = [...snapshot.states.filter(d => d.documentId !== "md-report"), { documentId: "md-report", status: value.failure ? "failed" : "draft", failure: value.failure ?? null }];
 });
});
describe("bounded report quality recovery", () => {
 it("retains rejected bytes/hash as failed and repairs only once without concatenating reports", async () => {
  complete.mockResolvedValueOnce({ text: BAD }).mockResolvedValueOnce({ text: GOOD });
  const result = await generateInterviewMarkdown(deps(),input);
  expect(complete).toHaveBeenCalledTimes(2); expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]?.[0]).toMatchObject({ markdown: BAD, failure: { code: "AI_GENERATION_UNAVAILABLE", retryable: true } });
  const report = result.documents.find(d => d.step === "report")!;
  expect(report).toMatchObject({ markdown: GOOD, version: 2, contentHash: createHash("sha256").update(GOOD).digest("hex"), evidenceMode: "simulated" });
  expect(result.states.find(s => s.documentId === report.documentId)?.status).toBe("draft");
  const request = complete.mock.calls[1]?.[0]; expect(request.user).toContain(BAD); expect(request.user).toContain("cross_answer_synthesis"); expect(request.system).toContain("完整");
 });
 it("two quality failures remain failed, never call a third time or report success", async () => {
  complete.mockResolvedValue({ text: BAD });
  await expect(generateInterviewMarkdown(deps(),input)).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
  expect(complete).toHaveBeenCalledTimes(2); expect(save).toHaveBeenCalledTimes(2);
  expect(snapshot.states.find(s => s.documentId === "md-report")?.status).toBe("failed");
 });
 it("a successful first attempt spends one call and one write", async () => {
  complete.mockResolvedValue({ text: GOOD }); await generateInterviewMarkdown(deps(),input);
  expect(complete).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
 });
 it("a failed current draft is rewritten completely and is never a confirmed source", async () => {
  await save({ expectedVersion: 7, expectedDocumentVersion: 0, markdown: BAD, failure: {code:"AI_GENERATION_UNAVAILABLE",retryable:true},references:[] });
  save.mockClear();complete.mockResolvedValue({ text: GOOD });
  const result = await generateInterviewMarkdown(deps(),{...input,expectedVersion:8,expectedDocumentVersion:1});
  expect(result.documents.find(d => d.step === "report")?.markdown).toBe(GOOD);
  expect(complete.mock.calls[0]?.[0].user).toContain("未确认");
  expect(complete.mock.calls[0]?.[0].system).not.toContain("原样拼接");
 });
 it("source changes after retaining the failure block further model work", async () => {
  const normalRead = read.getMockImplementation()!; let count = 0;
  read.mockImplementation(async () => { if (++count === 2) snapshot.version++; return normalRead(); });
  complete.mockResolvedValue({ text: BAD });
  await expect(generateInterviewMarkdown(deps(),input)).rejects.toThrow("CONCURRENT_MODIFICATION");
  expect(complete).toHaveBeenCalledTimes(1);
 });
 it("permission loss before repair remains the original error", async () => {
  const error = new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
  read.mockImplementationOnce(async () => structuredClone(snapshot)).mockRejectedValue(error);
  complete.mockResolvedValue({ text: BAD }); await expect(generateInterviewMarkdown(deps(),input)).rejects.toBe(error); expect(complete).toHaveBeenCalledTimes(1);
 });
 it("provider failure during repair retains the failed first version", async () => {
  complete.mockResolvedValueOnce({ text: BAD }).mockRejectedValueOnce(new ModelCallError("MODEL_CALL_FAILED","synthetic transport failure"));
  await expect(generateInterviewMarkdown(deps(),input)).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
  expect(complete).toHaveBeenCalledTimes(2);expect(save).toHaveBeenCalledTimes(1);
  expect(snapshot.documents.find(d => d.step === "report")?.markdown).toBe(BAD);
 });
});
