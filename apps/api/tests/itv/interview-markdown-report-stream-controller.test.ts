import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { interviewMarkdown } from "@repo/contracts";
import { DigitalInterviewController } from "../../src/interface/controllers/digital-interview.controller";
import { toOrgId } from "../../src/domain/org-id";
import { NoInterviewAccessError } from "../../src/application/interview/errors";
import { DigitalInterviewWorkflowError } from "../../src/application/interview/workflow/digital-interview-runtime.port";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../src/application/interview/read-interview-markdown", async importOriginal => ({
 ...await importOriginal<object>(), readInterviewMarkdown: read,
}));
const source = { interviewId: "itv", revisionId: "rev", version: 2, documents: [], states: [], execution: null, review: null };
const principal = { userId: "actor", orgId: toOrgId("org") };
const body = { expectedVersion: 1, expectedDocumentVersion: 0 };
function setup(generate = vi.fn()) {
 const args = Array(12).fill(undefined); args[9] = {}; args[10] = { generate };
 const controller = new DigitalInterviewController(...args as ConstructorParameters<typeof DigitalInterviewController>);
 const response = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), writableEnded: false, destroyed: false };
 const invoke = (requestBody: unknown = body) => controller.generateMarkdownReportStream({ traceId: "controlled" }, principal, "itv", requestBody, response as unknown as Response);
 return { generate, response, invoke, events: () => response.write.mock.calls.map(([line]) => JSON.parse(line)) };
}
beforeEach(() => { vi.clearAllMocks(); read.mockResolvedValue(source); });
describe("canonical report NDJSON controller", () => {
 it("writes checked progress then the persisted envelope as the only completion", async () => {
  const test = setup(vi.fn(async input => { await input.onProgress({ type: "attempt", attempt: 1 }); await input.onProgress({ type: "delta", delta: "中文\n" }); return source; }));
  await test.invoke();
  expect(read.mock.invocationCallOrder[0]).toBeLessThan(test.generate.mock.invocationCallOrder[0]!);
  expect(test.generate.mock.calls[0]?.[0]).toMatchObject({ step: "report", viewerUserId: "actor", traceId: "controlled", ...body });
  expect(test.events()).toEqual([{ type: "attempt", attempt: 1 }, { type: "delta", delta: "中文\n" }, { type: "completed", source }]);
  test.events().forEach(event => expect(interviewMarkdown.InterviewMarkdownReportStreamEvent.safeParse(event).success).toBe(true));
  expect(test.response.end).toHaveBeenCalledTimes(1);
 });
 it("rejects denied access before opening stream or calling generator", async () => {
  read.mockRejectedValue(new NoInterviewAccessError("itv")); const test = setup();
  await expect(test.invoke()).rejects.toMatchObject({ status: 404 });
  expect(test.response.writeHead).not.toHaveBeenCalled(); expect(test.generate).not.toHaveBeenCalled();
 });
 it("emits a safe terminal failure after partial bytes without completion", async () => {
  const test = setup(vi.fn(async input => { input.onProgress({ type: "delta", delta: "partial" }); throw new Error("secret provider detail"); }));
  await test.invoke();
  expect(test.events()).toEqual([{ type: "delta", delta: "partial" }, { type: "failed", reasonCode: "AI_GENERATION_UNAVAILABLE" }]);
  expect(JSON.stringify(test.events())).not.toContain("secret");
 });
 it("preserves a known concurrency rejection without false completion", async () => {
  const test = setup(vi.fn().mockRejectedValue(new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION")));
  await test.invoke(); expect(test.events()).toEqual([{ type: "failed", reasonCode: "CONCURRENT_MODIFICATION" }]);
 });
 it("rejects malformed request before opening transport", async () => {
  const test = setup(); await expect(test.invoke({ ...body, step: "runs" })).rejects.toMatchObject({ status: 400 });
  expect(test.response.writeHead).not.toHaveBeenCalled();
 });
});
