import { expect, it } from "vitest";
import { research as C } from "@repo/contracts";
import { researchGenerationEvents } from "../../src/interface/controllers/guided-research-generation-stream";
const state = C.GuidedResearchRuntime.parse({ sessionId: "s", version: 2, revision: 1, currentNode: "report", availableNodes: ["report"], brief: { topic: "topic", goal: "goal", timeRange: "", region: "", focus: "" }, directions: [], outline: [], tasks: [], sources: [], report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [], reportStream: { requestId: "r", sequence: 0, text: "", status: "streaming" } });
it("uses interview event names without leaking runtime state or resending streamed prose", () => {
  const events: any[] = []; const send = researchGenerationEvents("r", event => events.push(event));
  send({ type: "snapshot", state });
  send({ type: "report_delta", sessionId: "s", requestId: "r", version: 2, sequence: 1, delta: "正文😀" });
  send({ type: "snapshot", state: { ...state, reportStream: { ...state.reportStream!, text: "正文😀", sequence: 1 } } });
  send({ type: "result", state: { ...state, busy: false } });
  expect(events.map(event => event.type)).toEqual(["stage", "delta", "stage", "completed"]);
  expect(events[0].stream).toEqual({ sequence: 0, offset: 0, status: "streaming" });
  expect(events.at(-1)).toEqual({ type: "completed", source: { sessionId: "s", requestId: "r", version: 2, revision: 1 } });
  expect(JSON.stringify(events).match(/正文/g)).toHaveLength(1);
  expect(events.every(event => !event.state && !event.modelCalls && !event.leaseUntil)).toBe(true);
});
it("deduplicates lease-only snapshots and emits resets with explicit ordering metadata", () => {
  const events: any[] = [], send = researchGenerationEvents("r", event => events.push(event));
  send({ type: "snapshot", state: { ...state, reportStream: null } });
  send({ type: "snapshot", state: { ...state, reportStream: null, leaseUntil: "changed" } });
  expect(events).toHaveLength(1);
  send({ type: "snapshot", state });
  send({ type: "report_delta", sessionId: "s", requestId: "r", version: 2, sequence: 1, delta: "obsolete" });
  send({ type: "snapshot", state: { ...state, reportStream: { ...state.reportStream!, sequence: 2 } } });
  expect(events.at(-1).stream).toEqual({ sequence: 2, offset: 0, status: "streaming" });
});
it("terminal runtime failures produce failed, never completed", () => {
  const events: any[] = [], send = researchGenerationEvents("r", event => events.push(event));
  send({ type: "result", state: { ...state, errorCode: "RESEARCH_REPORT_QUALITY_INSUFFICIENT" } });
  expect(events).toEqual([{ type: "failed", reasonCode: "RESEARCH_REPORT_QUALITY_INSUFFICIENT" }]);
});
it("negotiates NDJSON at the HTTP boundary and keeps runtime data off the public wire", async () => {
  const { vi } = await import("vitest");
  const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
  const execute = vi.fn(async (_actor, _session, _command, send) => {
    send({ type: "snapshot", state });
    send({ type: "report_delta", sessionId: "s", requestId: "r", version: 2, sequence: 1, delta: "报告正文" });
    send({ type: "result", state: { ...state, busy: false } });
  });
  const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, { execute } as never);
  vi.spyOn(controller as never, "current" as never).mockResolvedValue({} as never);
  const lines: string[] = [];
  const response = { setHeader: vi.fn(), flushHeaders: vi.fn(), on: vi.fn(), off: vi.fn(), end: vi.fn(), write: (frame: string) => { lines.push(frame); return true; }, writableLength: 0, destroyed: false };
  await controller.streamRuntime({ userId: "u", orgId: "org" as never }, "s", { requestId: "r", expectedVersion: 1, node: "report", action: "generate" }, response as never, { headers: { accept: "application/x-ndjson" } } as never);
  expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/x-ndjson; charset=utf-8");
  expect(lines.map(line => JSON.parse(line).type)).toEqual(["stage", "delta", "completed"]);
  expect(lines.join("")).not.toContain('"state"');
  expect(lines.join("")).not.toContain('"modelCalls"');
});
