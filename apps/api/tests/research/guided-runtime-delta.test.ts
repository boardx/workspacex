import { expect, it } from "vitest";
import { research as C } from "@repo/contracts";
import { fieldFingerprint, runtimeDelta, rememberRuntimeDelta } from "../../src/interface/controllers/guided-research-delta";
const state = C.GuidedResearchRuntime.parse({ sessionId: "s", version: 2, revision: 1, currentNode: "outline", availableNodes: ["brief", "directions", "outline"], brief: { topic: "topic", goal: "goal", timeRange: "", region: "", focus: "" }, directions: [], outline: [], tasks: [], sources: [], report: null, completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [{ id: "old", node: "brief", role: "assistant", text: "历史内容".repeat(10000), createdAt: "now" }], proposal: null, modelCalls: [] });
const fingerprints = () => Object.fromEntries(C.GuidedResearchRuntimeKnownFields.keySchema.options.map((key) => [key, fieldFingerprint(state[key])]));
it("only sends changed fields, leaving large unrelated history in client memory", () => {
  const patch = runtimeDelta({ ...state, busy: true, revision: 2 }, fingerprints());
  expect(patch.changes).toEqual({ busy: true });
  expect(JSON.stringify(patch).length).toBeLessThan(200);
  expect(JSON.stringify(patch)).not.toContain("历史内容");
});
it("remembers sent values and explicitly removes optional fields", () => {
  const known = fingerprints();
  const initial = runtimeDelta({ ...state, reportPartial: true }, known);
  rememberRuntimeDelta(known, initial);
  expect(runtimeDelta({ ...state, reportPartial: true }, known).changes).toEqual({});
  expect(runtimeDelta(state, known).removed).toEqual(["reportPartial"]);
});
it("does not accept foreign fields or clear required snapshot metadata", () => {
  expect(C.GuidedResearchRuntimeKnownFields.safeParse({ __unexpected: "a".repeat(64) }).success).toBe(false);
  expect(C.GuidedResearchRuntimePatch.safeParse({ type: "patch", sessionId: "s", version: 2, revision: 1, changes: {}, removed: ["sessionId"] }).success).toBe(false);
});

it("strips cache hints from command execution and returns only changed fields", async () => {
  const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
  const { vi } = await import("vitest");
  const execute = vi.fn(async (..._args: unknown[]) => ({ ...state, version: 3, revision: 2, busy: true }));
  const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, { execute } as never);
  vi.spyOn(controller as never, "current" as never).mockResolvedValue({} as never);
  const input = { requestId: "r", expectedVersion: 2, node: "outline", action: "save", draft: { node: "outline", value: [{ id: "o", title: "chapter", questions: ["q"], enabled: true, order: 0 }] }, knownFields: fingerprints() };
  const result = await controller.executeRuntime({ userId: "u", orgId: "org" as never }, "s", input);
  expect(result).toMatchObject({ type: "patch", changes: { busy: true } });
  expect(execute.mock.calls[0]?.[2]).not.toHaveProperty("knownFields");
  expect(result).not.toHaveProperty("messages");
});

it("streams changed snapshots and does not resend report text after token deltas", async () => {
  const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
  const { vi } = await import("vitest");
  const stream = { requestId: "r", sequence: 0, text: "", status: "streaming" as const };
  const busy = { ...state, version: 3, revision: 2, busy: true, reportStream: stream };
  const execute = vi.fn(async (_scope, _session, _command, send) => {
    send({ type: "snapshot", state: busy });
    send({ type: "report_delta", sessionId: "s", requestId: "r", version: 3, sequence: 1, delta: "正文" });
    send({ type: "result", state: { ...busy, busy: false, reportStream: { ...stream, sequence: 1, text: "正文" } } });
  });
  const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, { execute } as never);
  vi.spyOn(controller as never, "current" as never).mockResolvedValue({} as never);
  const frames: string[] = [];
  const response = { setHeader: vi.fn(), flushHeaders: vi.fn(), on: vi.fn(), off: vi.fn(), end: vi.fn(), write: (frame: string) => frames.push(frame), writableLength: 0, destroyed: false };
  await controller.streamRuntime({ userId: "u", orgId: "org" as never }, "s", { requestId: "r", expectedVersion: 2, node: "report", action: "generate", knownFields: fingerprints() }, response as never);
  const events = frames.map((frame) => JSON.parse(frame.slice(6)));
  expect(events.map((event) => event.type)).toEqual(["patch", "report_delta", "result_patch"]);
  expect(events[2].state.changes).toEqual({ busy: false });
  expect(execute.mock.calls[0]?.[2]).not.toHaveProperty("knownFields");
});


it("keeps polling compact even when field fingerprints are supplied", async () => {
  const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
  const { vi } = await import("vitest");
  const current = { ...state, currentNode: "research" as const, sources: [{ id: "source", taskId: "task", title: "Evidence", url: "https://example.org/evidence", content: "large-source-body".repeat(1000), retrievedAt: "now", decision: "accepted" as const }] };
  const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  vi.spyOn(controller, "getRuntime").mockResolvedValue(current);
  const first = await controller.getRuntimeProgress({ userId: "u", orgId: "org" as never }, "s", { knownFields: JSON.stringify(fingerprints()) });
  expect(first).toMatchObject({ research: { sources: [{ id: "source", title: "Evidence" }] } });
  expect(JSON.stringify(first)).not.toContain("large-source-body");
  const cursor = "research" in first ? first.research?.cursor : undefined;
  expect(cursor).toBeTruthy();
  const unchanged = await controller.getRuntimeProgress({ userId: "u", orgId: "org" as never }, "s", { knownFields: JSON.stringify(fingerprints()), sourceCursor: cursor });
  expect(unchanged).toMatchObject({ research: { cursor } });
  expect("research" in unchanged && unchanged.research).not.toHaveProperty("sources");
});
