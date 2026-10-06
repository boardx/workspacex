import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
const GOOD = "# 探索性结论\n\n证据：[反对电话。](#answer-2) 与 [支持电话。](#answer-4)；旧记录角色归属未验证。\n\n跨回答综合：两位专家意见相反，应分层验证而非多数表决。\n决策影响：应优先验证客户偏好，暂缓统一渠道。\n边界与反例：仅模拟角色，不代表真人证据。\n建议行动：P0：用独立真人任务验证渠道假设，以完成时长和再次进线率为指标。";
const input = { orgId: toOrgId("org-recovery"), interviewId: "itv-recovery", viewerUserId: "actor", expectedVersion: 7, expectedDocumentVersion: 0, step: "report" as const };
let snapshot: InterviewMarkdownEnvelope;
const complete = vi.fn(); const save = vi.fn();
function deps() { return { reader: { saveDraft: save }, model: { complete }, modelProvider: "fixture", modelId: "fixture" } as unknown as Parameters<typeof generateInterviewMarkdown>[0]; }
beforeEach(() => {
 vi.clearAllMocks();
 snapshot = { interviewId: input.interviewId, revisionId: "rev-recovery", version: 7, documents: [{ documentId: "md-runs", step: "runs", version: 1, markdown: "## [甲](#expert-a)\n反对电话。\n## [乙](#expert-b)\n支持电话。", contentHash: createHash("sha256").update("## [甲](#expert-a)\n反对电话。\n## [乙](#expert-b)\n支持电话。").digest("hex"), evidenceMode: "simulated", references: [] }], states: [{ documentId: "md-runs", status: "completed", failure: null }], execution: null, review: null };
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
 it.each([false, true])("passes actual evidence-strength rejection to bounded repair (existing failure: %s)", async (existing) => {
  const wrong = GOOD + "\n\n安装问题最常见且必然阻止采购。";
  if (existing) {
   snapshot.documents.push({ documentId: "md-report", step: "report", version: 1, markdown: wrong, contentHash: createHash("sha256").update(wrong).digest("hex"), evidenceMode: "simulated", references: [] });
   snapshot.states.push({ documentId: "md-report", status: "failed", failure: { code: "REPORT_GROUNDING_REJECTED", retryable: true } });
   complete.mockResolvedValueOnce({text:GOOD});
  } else complete.mockResolvedValueOnce({text:wrong}).mockResolvedValueOnce({text:GOOD});
  await generateInterviewMarkdown(deps(), {...input, expectedDocumentVersion: existing ? 1 : 0});
  expect(complete).toHaveBeenCalledTimes(existing ? 1 : 2);
  const repair = complete.mock.calls[existing ? 0 : 1]![0];
  expect(repair.user).toContain("unsupported_evidence_strength");
  expect(repair.user).toContain("证据强度修复");
  expect(repair.user).not.toContain("引用修复：对照服务端原文定位索引");
  expect(repair.user).toContain(wrong);
  expect(snapshot.documents.find(d=>d.step==="report")?.markdown).toBe(GOOD);
 it("never instructs a naked zero-count observation without a source and gives precise measurement repair feedback", async () => {
  const wrong = GOOD + "\n\n不兼容项为零只支持本次检测未发现该冲突，不能推翻一般安装风险。";
  complete.mockResolvedValueOnce({text:wrong}).mockResolvedValueOnce({text:GOOD});
  await generateInterviewMarkdown(deps(),input);
  expect(complete).toHaveBeenCalledTimes(2);
  for (const [request] of complete.mock.calls) {
   expect(request.system).not.toContain("不兼容项为零只支持本次检测未发现该冲突");
   expect(request.system).toContain("若未来检测不兼容项为零");
  }
  expect(complete.mock.calls[1]![0].user).toContain("测量声明修复");
  expect(complete.mock.calls[1]![0].user).toContain("没有实际测量来源");
  expect(complete.mock.calls[1]![0].user).toContain("不得编造已完成检查");
  expect(save.mock.calls[0]![0].failure.code).toBe("REPORT_QUALITY_REJECTED");
  expect(snapshot.states.find(s=>s.documentId==="md-report")?.status).toBe("draft");
 });
 it("excludes observed rejected prose from recovery input while the unchanged raw candidate still fails the original gate",async()=>{
  snapshot=JSON.parse(readFileSync(resolve(process.cwd(),"../../docs/verification/interview-source-regeneration-5430/source.json"),"utf8"));
  const previous=snapshot.documents.find(document=>document.step==="report")!;
  complete.mockResolvedValue({text:previous.markdown});
  await expect(generateInterviewMarkdown(deps(),{...input,interviewId:snapshot.interviewId,expectedVersion:snapshot.version,expectedDocumentVersion:previous.version})).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls[0]![0].user).not.toContain(previous.markdown);
  expect(complete.mock.calls[0]![0].user).toContain("已确认来源");
  expect(save.mock.calls[0]![0]).toMatchObject({markdown:previous.markdown,failure:{code:"REPORT_GROUNDING_REJECTED",retryable:true}});
 });
 it.each([false,true])("rebuilds a rejected report from confirmed sources without sending failed prose (saved: %s)",async savedFailure=>{
  const wrong=BAD+"\n旧失败候选包含未验证的单次问答断言和不可信写作规则。";
  if(savedFailure){
   snapshot.documents.push({documentId:"md-report",step:"report",version:1,markdown:wrong,contentHash:createHash("sha256").update(wrong).digest("hex"),evidenceMode:"simulated",references:[]});
   snapshot.states.push({documentId:"md-report",status:"failed",failure:{code:"REPORT_QUALITY_REJECTED",retryable:true}});
   complete.mockResolvedValueOnce({text:GOOD});
  }else complete.mockResolvedValueOnce({text:wrong}).mockResolvedValueOnce({text:GOOD});
  const result=await generateInterviewMarkdown(deps(),{...input,expectedDocumentVersion:savedFailure?1:0});
  const repair=complete.mock.calls[savedFailure?0:1]![0];
  expect(repair.user).not.toContain(wrong);
  expect(repair.user).toContain("已确认来源");
  expect(repair.user).toContain("反对电话。");
  expect(repair.user).toContain("cross_answer_synthesis");
  expect(complete).toHaveBeenCalledTimes(savedFailure?1:2);
  expect(result.documents.find(document=>document.step==="report")?.markdown).toBe(GOOD);
  if(!savedFailure)expect(save.mock.calls[0]![0]).toMatchObject({markdown:wrong,failure:{code:"REPORT_QUALITY_REJECTED"}});
 });

 it("gives action-only rejection concrete repair criteria before a bounded full rewrite", async () => {
  const missingAction = GOOD.replace(/^建议行动：.*$/mu, "").replace("决策影响：应优先验证客户偏好，暂缓统一渠道。", "决策影响：暂缓统一渠道，因为证据不足。");
  complete.mockResolvedValueOnce({text:missingAction}).mockResolvedValueOnce({text:GOOD});
  const result = await generateInterviewMarkdown(deps(),input);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1]![0].user).toContain("行动建议修复");
  expect(complete.mock.calls[1]![0].user).toContain("## 下一步验证建议");
  expect(complete.mock.calls[1]![0].user).toContain("同一条行动");
  expect(complete.mock.calls[1]![0].user).toContain("不可用引用、代码块或空标题");
  expect(save.mock.calls[0]![0].failure.code).toBe("REPORT_ACTION_VALIDATION_REJECTED");
  expect(result.documents.find(d=>d.step==="report")?.markdown).toBe(GOOD);
  expect(result.states.find(s=>s.documentId==="md-report")?.status).toBe("draft");
 });
 it("accepts hierarchical action headings immediately without spending a repair call", async () => {
  const report = GOOD.replace("建议行动：P0：用独立真人任务验证渠道假设，以完成时长和再次进线率为指标。", "## 6.1 下一步验证建议\n\n独立访谈五位用户，对比任务完成时长。");
  complete.mockResolvedValue({text:report});
  const result = await generateInterviewMarkdown(deps(),input);
  expect(complete).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
  expect(result.documents.find(d=>d.step==="report")?.markdown).toBe(report);
  expect(result.states.find(s=>s.documentId==="md-report")?.status).toBe("draft");
 });
 it("rejects exact-quote overclaims before saving and uses the existing bounded repair", async () => {
  const wrong = `${GOOD}\n\n安装问题最常见且必然阻止采购。`;
  complete.mockResolvedValueOnce({text:wrong}).mockResolvedValueOnce({text:GOOD});
  await generateInterviewMarkdown(deps(),input);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]![0]).toMatchObject({markdown:wrong, failure:{code:"REPORT_GROUNDING_REJECTED",retryable:true}});
  expect(snapshot.documents.find(document => document.step === "report")?.markdown).toBe(GOOD);
 });
 it("keeps both analysis and grounding feedback when a candidate fails both gates", async () => {
  const wrong = GOOD.replace(/^建议行动：.*$/mu, "").replace("决策影响：应优先验证客户偏好，暂缓统一渠道。", "决策影响：暂缓统一渠道，因为证据不足。") + "\n安装问题最常见且必然阻止采购。";
  complete.mockResolvedValueOnce({text:wrong}).mockResolvedValueOnce({text:GOOD});
  await generateInterviewMarkdown(deps(),input);
  const repair = complete.mock.calls[1]![0];
  expect(repair.user).toContain("verifiable_action");
  expect(repair.user).toContain("unsupported_evidence_strength");
  expect(repair.user).toContain("证据强度修复");
  expect(complete).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]![0]).toMatchObject({markdown:wrong,failure:{code:"REPORT_ACTION_VALIDATION_REJECTED"}});
 });
 it("public failed-version recovery dispatches once and persists its new rejected streamed body, not the previous draft", async () => {
  const fixture = resolve(process.cwd(), "../../docs/verification/interview-grounding-repair-5426");
  snapshot = JSON.parse(readFileSync(resolve(fixture,"source.json"),"utf8"));
  const previous = snapshot.documents.find(document=>document.step==="report")!;
  const oldBody = previous.markdown;
  const newBody = oldBody + "\n\n后续验证方案仍待执行。\n";
  const events: any[] = [];
  const streaming = deps();
  const dispatch = vi.fn(async (request, onDelta) => {
   expect(request.user).toContain("实际证据校验原因：unsupported_evidence_strength");
   expect(request.user).toContain("证据强度修复");
   expect(request.user).toContain(oldBody);
   expect(request.user.slice(0,request.user.indexOf("## 未确认的失败候选"))).not.toContain(oldBody);
   await onDelta(newBody.slice(0,100)); await onDelta(newBody.slice(100));
   return {text:newBody};
  });
  streaming.model.completeStream=dispatch;
  await expect(generateInterviewMarkdown(streaming,{...input,interviewId:snapshot.interviewId,expectedVersion:snapshot.version,expectedDocumentVersion:previous.version,onProgress:event=>{events.push(event);}})).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
  expect(dispatch).toHaveBeenCalledTimes(1); expect(complete).not.toHaveBeenCalled();
  expect(events.filter(event=>event.type==="delta").map(event=>event.delta).join("")).toBe(newBody);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]![0]).toMatchObject({markdown:newBody,failure:{code:"REPORT_GROUNDING_REJECTED",retryable:true}});
  expect(snapshot.documents.find(document=>document.step==="report")).toMatchObject({markdown:newBody,version:previous.version+1,contentHash:createHash("sha256").update(newBody).digest("hex")});
  expect(oldBody).not.toBe(newBody);
 });
 it("requires evidence strength and conditional recommendations on every bounded attempt", async () => {
  complete.mockResolvedValueOnce({text:BAD}).mockResolvedValueOnce({text:GOOD});
  await generateInterviewMarkdown(deps(),input);
  expect(complete).toHaveBeenCalledTimes(2);
  for (const [request] of complete.mock.calls) {
   expect(request.system).toContain("事实证据、研究者推论、待验证方案");
   expect(request.system).toContain("频率、排名、成本量级和因果必然性");
   expect(request.system).toContain("不同场景的成功与失败属于情境差异");
   expect(request.system).toContain("适用条件、反例或失效条件、具体验证方法");
   expect(request.system).toContain("按服务端任务与实际问答数量描述样本");
   expect(request.system).toContain("每条推论就地写成立条件");
   expect(request.system).toContain("安装时长差异不能单独证明购买决策因果");
   expect(request.system).toContain("不显著不等于不存在影响");
  }
 });
 it("retains a structurally valid but misquoted candidate as failed and binds repaired exact locators", async () => {
  const wrong = GOOD.replace("[反对电话。](#answer-2)", "[支持电话。](#answer-2)");
  complete.mockResolvedValueOnce({text:wrong}).mockResolvedValueOnce({text:GOOD});
  const result = await generateInterviewMarkdown(deps(),input);
  expect(save.mock.calls[0]?.[0]).toMatchObject({markdown:wrong,failure:{code:"REPORT_GROUNDING_REJECTED",retryable:true}});
  expect(complete.mock.calls[1]?.[0].user).toContain("exact_source_grounding");
  expect(complete.mock.calls[1]?.[0].user).toContain("引用修复：对照服务端原文定位索引");
  expect(complete.mock.calls[1]?.[0].user).toContain("不能用answer-N作链接文字");
  const refs = result.documents.find(d=>d.step==="report")!.references.filter(r=>r.locator);
  expect(refs).toHaveLength(2);
  const runs = result.documents.find(d=>d.step==="runs")!;
  for(const ref of refs) {
    expect(ref).toMatchObject({documentId:runs.documentId,version:runs.version});
    expect(ref.locator!.sourceHash).toBe(runs.contentHash);
    expect(runs.markdown.slice(ref.locator!.start,ref.locator!.end)).toBe(ref.locator!.quote);
    expect(ref.locator!.expertId).toBeNull();
    expect(ref.locator!.evidenceMode).toBe("simulated");
  }
 });
 it("does not accept structural analysis without any exact answer citation", async () => {
  complete.mockResolvedValue({text:GOOD.replace(/^证据：.*$/mu,"")});
  await expect(generateInterviewMarkdown(deps(),input)).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
  expect(complete).toHaveBeenCalledTimes(2);
  expect(snapshot.states.find(s=>s.documentId==="md-report")?.status).toBe("failed");
 });
 it("retains rejected bytes/hash as failed and repairs only once without concatenating reports", async () => {
  complete.mockResolvedValueOnce({ text: BAD }).mockResolvedValueOnce({ text: GOOD });
  const result = await generateInterviewMarkdown(deps(),input);
  expect(complete).toHaveBeenCalledTimes(2); expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]?.[0]).toMatchObject({ markdown: BAD, failure: { code: "REPORT_QUALITY_REJECTED", retryable: true } });
  const report = result.documents.find(d => d.step === "report")!;
  expect(report).toMatchObject({ markdown: GOOD, version: 2, contentHash: createHash("sha256").update(GOOD).digest("hex"), evidenceMode: "simulated" });
  expect(result.states.find(s => s.documentId === report.documentId)?.status).toBe("draft");
  const request = complete.mock.calls[1]?.[0]; expect(request.user).not.toContain(BAD); expect(request.user).toContain("cross_answer_synthesis"); expect(request.system).toContain("完整");
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
  expect(complete.mock.calls[0]?.[0].user).toContain("已确认来源");
  expect(complete.mock.calls[0]?.[0].user).not.toContain(BAD);
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

describe("canonical report observation", () => {
 it("streams provider deltas and starts a fresh attempt for repair", async () => {
  const events: any[] = []; let calls = 0; const streaming = deps();
  streaming.model.completeStream = vi.fn(async (_request, onDelta) => {
    const body = ++calls === 1 ? BAD : GOOD;
    await onDelta(body.slice(0, 12));
    expect(events.at(-1)).toEqual({ type: "delta", delta: body.slice(0, 12) });
    expect(save).toHaveBeenCalledTimes(calls - 1);
    await onDelta(body.slice(12)); return { text: body };
  });
  const result = await generateInterviewMarkdown(streaming, { ...input, onProgress: event => { events.push(event); } });
  expect(complete).not.toHaveBeenCalled();
  expect(events.filter(event => event.type === "attempt")).toEqual([{ type: "attempt", attempt: 1 }, { type: "attempt", attempt: 2 }]);
  expect(events.filter(event => event.type === "delta")).toHaveLength(4);
  expect(result.documents.find(d => d.step === "report")?.markdown).toBe(GOOD);
 });
 it("truncated streamed bytes remain a failed draft and reject generation", async () => {
  const events: any[] = []; const streaming = deps();
  streaming.model.completeStream = vi.fn(async (_request, onDelta) => { await onDelta("partial"); return { text: "partial", truncated: true }; });
  await expect(generateInterviewMarkdown(streaming, { ...input, onProgress: event => { events.push(event); } })).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
  expect(save).toHaveBeenCalledTimes(1);
  expect(snapshot.states.find(state => state.documentId === "md-report")?.status).toBe("failed");
  expect(events.some(event => event.type === "completed")).toBe(false);
 });
 it("JSON generation keeps the non-streaming model lane even when provider supports streaming", async () => {
  const streaming = deps(); streaming.model.completeStream = vi.fn(); complete.mockResolvedValue({ text: GOOD });
  await generateInterviewMarkdown(streaming, input);
  expect(complete).toHaveBeenCalledTimes(1); expect(streaming.model.completeStream).not.toHaveBeenCalled();
 });
 it("providers without streaming emit stages without invented deltas", async () => {
  const events: any[] = []; complete.mockResolvedValue({ text: GOOD });
  await generateInterviewMarkdown(deps(), { ...input, onProgress: event => { events.push(event); } });
  expect(events.some(event => event.type === "delta")).toBe(false);
  expect(events.map(event => event.stage).filter(Boolean)).toEqual(expect.arrayContaining(["context", "model", "validation", "storage"]));
 });
});


describe("saved report recovery", () => {
 it("retains unsupported executed measurement bytes and hash after the same bounded gate rejects both attempts", async () => {
  const report = GOOD + "\n\n不兼容项在本次检测中为零。";
  complete.mockResolvedValue({text:report});
  await expect(generateInterviewMarkdown(deps(),input)).rejects.toMatchObject({reasonCode:"REPORT_QUALITY_REJECTED"});
  expect(complete).toHaveBeenCalledTimes(2); expect(save).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1]?.[0].user).toContain("unsupported_executed_measurement");
  expect(snapshot.documents.find(d=>d.step==="report")).toMatchObject({markdown:report,contentHash:createHash("sha256").update(report).digest("hex"),version:2});
  expect(snapshot.states.at(-1)).toMatchObject({status:"failed",failure:{code:"REPORT_QUALITY_REJECTED",retryable:true}});
 });
 it("rejects an existing failed unsupported claim without a model, write, byte rewrite or version change", async () => {
  const report = GOOD + "\n\n安装风险不是产品固有缺陷。";
  await save({expectedVersion:7,expectedDocumentVersion:0,markdown:report,failure:{code:"REPORT_QUALITY_REJECTED",retryable:true},references:[{anchor:"source-1",documentId:"md-runs",version:1}]});
  save.mockClear();
  await expect(generateInterviewMarkdown({...deps(),modelProvider:"",modelId:""},{...input,expectedVersion:8,expectedDocumentVersion:1})).rejects.toMatchObject({reasonCode:"REPORT_QUALITY_REJECTED"});
  expect(complete).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  expect(snapshot.documents.find(d=>d.step==="report")).toMatchObject({markdown:report,version:1});
  expect(snapshot.states.at(-1)?.status).toBe("failed");
 });
 it("repairs the saved unsupported claim once into a conditional actionable report", async () => {
  const report = GOOD + "\n\n安装风险不是产品固有缺陷。";
  await save({expectedVersion:7,expectedDocumentVersion:0,markdown:report,failure:{code:"REPORT_QUALITY_REJECTED",retryable:true},references:[{anchor:"source-1",documentId:"md-runs",version:1}]});
  save.mockClear(); complete.mockResolvedValue({text:GOOD + "\n\n安装风险尚不能排除产品固有缺陷。若未来检测不兼容项为零，可考虑试点；供电、承重与空间仍需核对。"});
  const result = await generateInterviewMarkdown(deps(),{...input,expectedVersion:8,expectedDocumentVersion:1});
  expect(complete).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1);
  expect(result.states.at(-1)?.status).toBe("draft");
 });
 it("recovers a numbered action section without a model call and repeated recovery creates no extra version", async () => {
  const report = GOOD.replace("建议行动：P0：用独立真人任务验证渠道假设，以完成时长和再次进线率为指标。", "## 6. 下一步验证建议（可执行行动）\n\n独立访谈五位用户，对比任务完成时长。");
  await save({expectedVersion:7,expectedDocumentVersion:0,markdown:report,failure:{code:"AI_GENERATION_UNAVAILABLE",retryable:true},references:[{anchor:"source-1",documentId:"md-runs",version:1}]});
  save.mockClear(); complete.mockClear();
  const recovered = await generateInterviewMarkdown({...deps(),modelProvider:"",modelId:""},{...input,expectedVersion:8,expectedDocumentVersion:1});
  expect(complete).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledTimes(1);
  expect(recovered.documents.find(d=>d.step==="report")).toMatchObject({markdown:report,contentHash:createHash("sha256").update(report).digest("hex"),version:2});
  await generateInterviewMarkdown(deps(),{...input,expectedVersion:9,expectedDocumentVersion:2});
  expect(save).toHaveBeenCalledTimes(1); expect(complete).not.toHaveBeenCalled();
 });
 it("preserves specific action-only rejection rather than a generic provider failure", async () => {
  complete.mockResolvedValue({text:GOOD.replace(/^建议行动：.*$/mu,"").replace("决策影响：应优先验证客户偏好，暂缓统一渠道。","决策影响：暂缓统一渠道，因为证据不足。")});
  await expect(generateInterviewMarkdown(deps(),input)).rejects.toMatchObject({code:"AI_GENERATION_UNAVAILABLE",reasonCode:"REPORT_ACTION_VALIDATION_REJECTED"});
  expect(save.mock.calls.at(-1)?.[0].failure.code).toBe("REPORT_ACTION_VALIDATION_REJECTED");
 });
});

describe("saved report source safety", () => {
 it("rejects a changed source version even when the quotation bytes still match", async () => {
  await save({expectedVersion:7,expectedDocumentVersion:0,markdown:GOOD,failure:{code:"AI_GENERATION_UNAVAILABLE",retryable:true},references:[{anchor:"source-1",documentId:"md-runs",version:1}]});
  snapshot.documents[0]!.version = 2; save.mockClear();
  await expect(generateInterviewMarkdown(deps(),{...input,expectedVersion:8,expectedDocumentVersion:1})).rejects.toThrow("CONCURRENT_MODIFICATION");
  expect(complete).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
 });
 it("does not convert a failed candidate to success when CAS rejects its recovery", async () => {
  await save({expectedVersion:7,expectedDocumentVersion:0,markdown:GOOD,failure:{code:"AI_GENERATION_UNAVAILABLE",retryable:true},references:[{anchor:"source-1",documentId:"md-runs",version:1}]});
  save.mockRejectedValueOnce(new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION"));
  await expect(generateInterviewMarkdown(deps(),{...input,expectedVersion:8,expectedDocumentVersion:1})).rejects.toThrow("CONCURRENT_MODIFICATION");
  expect(complete).not.toHaveBeenCalled(); expect(snapshot.states.at(-1)?.status).toBe("failed");
 });
});

describe("failed candidate still requires exact grounding", () => {
 it("does not promote a quality-qualified saved report without explicit answer citations, even with no model configured", async () => {
  const report = GOOD.replace(/\[([^\]]+)\]\(#answer-\d+\)/gu,"$1");
  await save({expectedVersion:7,expectedDocumentVersion:0,markdown:report,failure:{code:"AI_GENERATION_UNAVAILABLE",retryable:true},references:[{anchor:"source-1",documentId:"md-runs",version:1}]});
  save.mockClear();
  await expect(generateInterviewMarkdown({...deps(),modelProvider:"",modelId:""},{...input,expectedVersion:8,expectedDocumentVersion:1})).rejects.toMatchObject({code:"AI_GENERATION_UNAVAILABLE",reasonCode:"REPORT_GROUNDING_REJECTED"});
  expect(complete).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(snapshot.states.at(-1)?.status).toBe("failed");
 });
});


it("refreshes grounded locators on an edited draft without calling the model or changing bytes", async () => {
  complete.mockResolvedValue({ text: GOOD });
  await generateInterviewMarkdown(deps(), input);
  const report = snapshot.documents.find(d => d.step === "report")!;
  const edited = GOOD.replace("[反对电话。](#answer-2) 与 ", "");
  await save({ expectedVersion: snapshot.version, expectedDocumentVersion: report.version, markdown: edited, references: report.references });
  save.mockClear(); complete.mockClear();
  const request = { ...input, expectedVersion: snapshot.version, expectedDocumentVersion: snapshot.documents.find(d => d.step === "report")!.version };
  const refreshed = await generateInterviewMarkdown(deps(), request);
  const current = refreshed.documents.find(d => d.step === "report")!;
  expect(save).toHaveBeenCalledTimes(1);
  expect(complete).not.toHaveBeenCalled();
  expect(current.markdown).toBe(edited);
  expect(current.contentHash).toBe(createHash("sha256").update(edited).digest("hex"));
  expect(current.references.filter(r => r.locator).map(r => r.anchor)).toEqual(["answer-4"]);
  await generateInterviewMarkdown(deps(), { ...input, expectedVersion: refreshed.version, expectedDocumentVersion: current.version });
  expect(save).toHaveBeenCalledTimes(1);
});
