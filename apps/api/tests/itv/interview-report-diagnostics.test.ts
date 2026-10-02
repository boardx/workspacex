import { toOrgId } from "../../src/domain/org-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateInterviewMarkdown } from "../../src/application/interview/generate-interview-markdown";
import { ModelCallError } from "../../src/application/agent-run/ports";
import { DigitalInterviewWorkflowError } from "../../src/application/interview/workflow/digital-interview-runtime.port";
import type { DebugEventInput } from "../../src/application/ports/debug-trace.port";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../src/application/interview/read-interview-markdown", () => ({ readInterviewMarkdown: read }));
const VALID = "## 跨回答综合\n\n两条回答共同指向流程割裂。\n\n## 决策影响\n\n应优先验证统一入口。\n\n## 边界与反例：\n\n当前仅覆盖两类角色，仍需真人验证。\n\n## 建议行动\n\nP0：用真实任务验证统一入口，成功信号为完成时长下降。";
const PRIVATE = "PRIVATE_SYNTHETIC_RESEARCH_DO_NOT_LOG";
const input = { orgId: toOrgId("org-report-diag"), viewerUserId: "actor", interviewId: "itv-diag", step: "report" as const, expectedVersion: 7, expectedDocumentVersion: 0, traceId: "http-trace-diag" };
const events: DebugEventInput[] = [];
const save = vi.fn(); const complete = vi.fn();
const recorder = { record: vi.fn((event: DebugEventInput) => { events.push(event); }) };
function deps() { return { reader: { saveDraft: save }, model: { complete }, modelProvider: "fixture", modelId: "fixture-model", debugTrace: recorder } as unknown as Parameters<typeof generateInterviewMarkdown>[0]; }
function terminal() { return events.find(event => event.kind === "interview.report_generation.failed" || event.kind === "interview.report_generation.completed"); }
beforeEach(() => {
 events.length = 0; vi.clearAllMocks(); recorder.record.mockImplementation(event => { events.push(event); });
 read.mockResolvedValue({ version: 7, documents: [{ documentId: "md-runs", step: "runs", version: 3, markdown: PRIVATE, contentHash: "a".repeat(64), evidenceMode: "simulated", references: [] }], states: [{ documentId: "md-runs", status: "completed" }] });
 complete.mockResolvedValue({ text: VALID, tokens: 1 }); save.mockResolvedValue(undefined);
});
describe("report diagnostics without research or credential disclosure", () => {
 it.each([
 ["empty_output", { text: "" }], ["cancelled", { text: PRIVATE, cancelled: true }], ["paused", { text: PRIVATE, paused: true }],
 ["interrupted", { text: PRIVATE, interrupted: true }], ["truncated", { text: PRIVATE, truncated: true }],
 ["invalid_format", { text: JSON.stringify({ body: PRIVATE }) }], ["invalid_format", { text: "```json\n{}\n```" }], ["quality_rejected", { text: PRIVATE }],
 ])("distinguishes %s while preserving the public error", async (reason, response) => {
 complete.mockResolvedValue(response); await expect(generateInterviewMarkdown(deps(), input)).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
 expect(terminal()).toMatchObject({ traceId: input.traceId, data: { reason, modelCalls: 1, outputCharacters: response.text.length } });
 expect(JSON.stringify(events)).not.toContain(PRIVATE);
 if (reason === "invalid_format" || reason === "quality_rejected") expect(terminal()).toMatchObject({ data: { stage: "validation", timings: { validation: expect.any(Number) } } });
 });
 it("reports provider code without detail or message", async () => {
 complete.mockRejectedValue(new ModelCallError("MODEL_CALL_FAILED", PRIVATE));
 await expect(generateInterviewMarkdown(deps(), input)).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
 expect(terminal()).toMatchObject({ data: { reason: "provider_error", providerCode: "MODEL_CALL_FAILED" } }); expect(JSON.stringify(events)).not.toContain(PRIVATE);
 });
 it("records missing quality dimensions", async () => {
 complete.mockResolvedValue({ text: PRIVATE }); await expect(generateInterviewMarkdown(deps(), input)).rejects.toThrow();
 expect(terminal()).toMatchObject({ data: { missing: ["cross_answer_synthesis", "decision_implication", "boundary_or_counterevidence", "verifiable_action"] } });
 });
 it("reports all timings and persists successful output once", async () => {
 await generateInterviewMarkdown(deps(), input); expect(save).toHaveBeenCalledTimes(1);
 expect(terminal()).toMatchObject({ data: { reason: "completed", modelCalls: 1, timings: { context: expect.any(Number), model: expect.any(Number), validation: expect.any(Number), storage: expect.any(Number) } }, durationMs: expect.any(Number) }); expect(JSON.stringify(events)).not.toContain(PRIVATE);
 });
 it("keeps storage CAS errors intact", async () => {
 const error = new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION"); save.mockRejectedValue(error);
 await expect(generateInterviewMarkdown(deps(), input)).rejects.toBe(error); expect(terminal()).toMatchObject({ data: { reason: "storage_error" } });
 });
 it("a broken diagnostic sink cannot fail generation", async () => {
 recorder.record.mockImplementation(() => { throw new Error(PRIVATE); }); await expect(generateInterviewMarkdown(deps(), input)).resolves.toBeDefined(); expect(save).toHaveBeenCalledTimes(1);
 });
});
