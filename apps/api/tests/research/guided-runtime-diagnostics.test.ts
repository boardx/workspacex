import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import type { DebugTracePort } from "../../src/application/ports/debug-trace.port";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { ResearchRuntimeError, type GuidedRuntimeStore, type RuntimeCommand } from "../../src/application/research/guided-runtime-ports";
import { toOrgId } from "../../src/domain/org-id";
import { ModelCallError } from "../../src/application/agent-run/ports";

function fixture() {
  const session = C.GuidedResearchSession.parse({ sessionId: "diagnostic-session", title: "Synthetic", brief: { topic: "Grid", goal: "Entry", region: "EU", focus: "Policy", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
  const state = initialRuntime(session);
  state.reportCheckpoint = { basis: "saved", chapters: [{ sectionId: "saved", body: "Saved chapter", sourceIds: [] }] };
  const saved = structuredClone(state.reportCheckpoint);
  const write = vi.fn(async (_actor, _id, value, _done) => { C.GuidedResearchRuntime.parse(value); });
  const store: GuidedRuntimeStore = { read: vi.fn(async () => structuredClone(state)), claim: vi.fn(async () => ({ state: structuredClone(state), replay: false })), write };
  const record = vi.fn();
  const debug = { record } as unknown as DebugTracePort;
  const model = { complete: vi.fn(async () => { throw Object.assign(new TypeError("PRIVATE BODY api-key SECRET"), { code: "ECONNRESET", status: 503 }); }) };
  const access = { authorizedSourceIds: vi.fn(async () => ["artifact"]), loadAuthorizedSources: vi.fn(async () => []) };
  const service = new GuidedRuntimeService(store, model, { search: vi.fn(async () => []) }, { provider: "test", id: "test" }, model, access, debug);
  const actor = { orgId: toOrgId("diagnostic-org"), userId: "owner", sessionId: session.sessionId };
  const command: RuntimeCommand = { sessionId: session.sessionId, node: "brief", action: "resume", requestId: randomUUID(), expectedVersion: 0, expectedRevision: state.planRevision ?? 0, idempotencyKey: randomUUID() };
  const traceId = randomUUID();
  return { session, state, saved, store, write, record, model, service, actor, command, traceId, access };
}

describe("traceable research execution failures", () => {
  it.each(["state_read", "source_authorization", "claim", "steer", "final_persistence"] as const)("records %s rejection without replacing the original error or saved chapter", async (phase) => {
    const f = fixture();
    const error = Object.assign(new Error("PRIVATE BODY postgres://SECRET"), { code: "23505" });
    if (phase === "state_read") vi.mocked(f.store.read).mockRejectedValue(error);
    if (phase === "claim") vi.mocked(f.store.claim).mockRejectedValue(error);
    if (phase === "steer") f.store.steer = vi.fn(async () => { throw error; });
    if (phase === "source_authorization") {
      f.state.sourcePolicy = { mode: "open", domains: [], internalSourceIds: ["artifact"], revision: 1 };
      f.access.authorizedSourceIds.mockRejectedValue(error);
    }
    if (phase === "final_persistence") f.write.mockImplementation(async (_actor, _id, _state, done) => { if (done) throw error; });
    await expect(f.service.execute(f.actor, f.session, f.command, undefined, f.traceId)).rejects.toBe(error);
    expect(f.record).toHaveBeenCalledWith(expect.objectContaining({ traceId: f.traceId, kind: "research.runtime.failed", data: expect.objectContaining({ phase, requestId: f.command.requestId, errors: [expect.objectContaining({ type: "Error", code: "23505" })] }) }));
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE BODY|SECRET|postgres:/);
    expect(f.state.reportCheckpoint).toEqual(f.saved);
    expect(f.model.complete).not.toHaveBeenCalled();
    expect(f.record).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a persisted model failure result from a rejected execution", async () => {
    const f = fixture();
    const result = await f.service.execute(f.actor, f.session, { ...f.command, action: "message", message: "Synthetic revision" }, undefined, f.traceId);
    expect(result.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE");
    expect(result.busy).toBe(false);
    expect(result.reportCheckpoint).toEqual(f.saved);
    expect(f.record).toHaveBeenCalledWith(expect.objectContaining({ traceId: f.traceId, data: expect.objectContaining({ phase: "perform", errors: expect.arrayContaining([expect.objectContaining({ type: "TypeError", code: "ECONNRESET", status: 503 })]) }) }));
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE BODY|SECRET/);
  });

  it("does not let diagnostic recorder failure change domain failure semantics", async () => {
    const f = fixture();
    f.record.mockImplementation(() => { throw new Error("diagnostic sink failed"); });
    vi.mocked(f.store.claim).mockRejectedValue(new ResearchRuntimeError("RESEARCH_WORKFLOW_BUSY"));
    await expect(f.service.execute(f.actor, f.session, f.command, undefined, f.traceId)).rejects.toMatchObject({ reasonCode: "RESEARCH_WORKFLOW_BUSY" });
    expect(f.write).not.toHaveBeenCalled();
  });

  it("retains contract model error codes while excluding private provider detail", async () => {
    const f = fixture();
    f.model.complete.mockRejectedValue(new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "PRIVATE PROVIDER SECRET"));
    const result = await f.service.execute(f.actor, f.session, { ...f.command, action: "message", message: "Synthetic revision" }, undefined, f.traceId);
    expect(result.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE");
    expect(f.record.mock.calls[0]![0].data.errors).toContainEqual({ type: "ModelCallError", code: "MODEL_PROVIDER_NOT_CONFIGURED" });
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE PROVIDER|SECRET/);
  });

  it.each(["RESEARCH_WORKFLOW_PAUSED", "RESEARCH_NODE_STATE_INVALID", "RESEARCH_SEARCH_UNAVAILABLE"])("records the public research reason %s without a nested cause", async (reasonCode) => {
    const f = fixture();
    const error = new ResearchRuntimeError(reasonCode);
    vi.mocked(f.store.claim).mockRejectedValue(error);
    await expect(f.service.execute(f.actor, f.session, f.command, undefined, f.traceId)).rejects.toBe(error);
    expect(f.record.mock.calls[0]![0].data.errors).toEqual([{ type: "ResearchRuntimeError", reasonCode }]);
    expect(f.state.reportCheckpoint).toEqual(f.saved);
    expect(f.write).not.toHaveBeenCalled();
  });

  it("omits private research reason strings outside the public contract", async () => {
    const f = fixture();
    const error = new ResearchRuntimeError("PRIVATE RESEARCH MATERIAL SECRET");
    vi.mocked(f.store.claim).mockRejectedValue(error);
    await expect(f.service.execute(f.actor, f.session, f.command, undefined, f.traceId)).rejects.toBe(error);
    expect(f.record.mock.calls[0]![0].data.errors).toEqual([{ type: "ResearchRuntimeError" }]);
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE|SECRET/);
  });

  it("bounds cyclic causes and omits unallowlisted names and codes", async () => {
    const f = fixture();
    const error = { name: "PRIVATE CLASS", code: "SECRET", status: 999, cause: undefined as unknown };
    error.cause = error;
    vi.mocked(f.store.claim).mockRejectedValue(error);
    await expect(f.service.execute(f.actor, f.session, f.command, undefined, f.traceId)).rejects.toBe(error);
    expect(f.record.mock.calls[0]![0].data.errors).toEqual([{ type: "UnknownError" }]);
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE CLASS|SECRET|999/);
  });
});
