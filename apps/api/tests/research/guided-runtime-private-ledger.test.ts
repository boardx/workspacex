import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import type { GuidedRuntimeStore, RuntimeCommand } from "../../src/application/research/guided-runtime-ports";
import { PersistedResearchRuntimeSchema, toPublicResearchRuntime } from "../../src/application/research/guided-runtime-persistence";
import { runtimeDelta, runtimePollingDelta, fieldFingerprint } from "../../src/interface/controllers/guided-research-delta";
import { runtimeProgress } from "../../src/interface/controllers/guided-research-progress";
import { toOrgId } from "../../src/domain/org-id";
function fixture() {
  const session = C.GuidedResearchSession.parse({ sessionId: "ledger-session", title: "Research", brief: { topic: "Grid", goal: "Entry", region: "EU", focus: "Policy", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
  const state = Object.assign(initialRuntime(session), { privateLedger: { validatorVersion: 1, records: [] }, privateSourceScreenRejectedRequests: ["f".repeat(64)], futurePrivateData: "PRIVATE_LEDGER_SENTINEL" });
  const store: GuidedRuntimeStore = { read: vi.fn(async () => structuredClone(state)), claim: vi.fn(async () => ({ state: structuredClone(state), replay: true })), steer: vi.fn(async () => structuredClone(state)), write: vi.fn(async () => undefined) };
  const model = { complete: vi.fn(async () => { throw new Error("must not call model"); }) };
  const service = new GuidedRuntimeService(store, model, { search: vi.fn(async () => []) }, { provider: "test", id: "test" });
  const actor = { orgId: toOrgId("ledger-org"), userId: "owner", sessionId: session.sessionId };
  const command: RuntimeCommand = { sessionId: session.sessionId, node: "brief", action: "resume", requestId: randomUUID(), expectedVersion: 0, idempotencyKey: randomUUID() };
  return { state, store, service, actor, session, command, model };
}
function assertPublic(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/privateLedger|privateSourceScreenRejectedRequests|futurePrivateData|PRIVATE_LEDGER_SENTINEL|f{64}/);
  expect(() => C.GuidedResearchRuntime.parse(value)).not.toThrow();
}
describe("private evidence never crosses the public runtime boundary", () => {
  it("projects GET from public contract fields", async () => {
    const f = fixture(); assertPublic(await f.service.get(f.actor, f.session));
    expect(f.state.privateLedger).toEqual({ validatorVersion: 1, records: [] });
  });
  it.each(["pause", "resume", "resolve_conflict"] as const)("projects %s early returns and stream results", async action => {
    const f = fixture(), events: unknown[] = [];
    assertPublic(await f.service.execute(f.actor, f.session, { ...f.command, action }, event => events.push(event)));
    expect(events).toHaveLength(1);
    for (const event of events) { expect(() => C.GuidedResearchRuntimeStreamEvent.parse(event)).not.toThrow(); assertPublic((event as { state: unknown }).state); }
    expect(f.model.complete).not.toHaveBeenCalled();
  });
  it("projects replay snapshots without mutating durable state", async () => {
    const f = fixture(), events: unknown[] = []; delete f.store.steer;
    assertPublic(await f.service.execute(f.actor, f.session, f.command, event => events.push(event)));
    expect(events).toHaveLength(2);
    for (const event of events) assertPublic((event as { state: unknown }).state);
    expect(f.state.futurePrivateData).toBe("PRIVATE_LEDGER_SENTINEL");
    expect(f.store.write).not.toHaveBeenCalled();
  });
  it("projects ordinary execution even when model generation fails", async () => {
    const f = fixture(), events: unknown[] = [];
    delete f.store.steer;
    vi.mocked(f.store.claim).mockResolvedValue({ state: f.state, replay: false });
    assertPublic(await f.service.execute(f.actor, f.session, { ...f.command, action: "message", message: "Revise scope" }, event => events.push(event)));
    for (const event of events) if ((event as { state?: unknown }).state) assertPublic((event as { state: unknown }).state);
    expect(f.store.write).toHaveBeenCalled();
    expect(f.state.privateLedger).toEqual({ validatorVersion: 1, records: [] });
  });
  it("accepts legacy persisted JSON and keeps ledger across JSON round trips", () => {
    const f = fixture();
    const publicState = toPublicResearchRuntime(f.state);
    expect(PersistedResearchRuntimeSchema.parse(publicState).privateLedger).toBeUndefined();
    const internal = PersistedResearchRuntimeSchema.parse({ ...publicState, privateLedger: f.state.privateLedger, privateSourceScreenRejectedRequests: f.state.privateSourceScreenRejectedRequests });
    expect(PersistedResearchRuntimeSchema.parse(JSON.parse(JSON.stringify(internal))).privateLedger).toEqual(f.state.privateLedger);
    expect(PersistedResearchRuntimeSchema.parse(JSON.parse(JSON.stringify(internal))).privateSourceScreenRejectedRequests).toEqual(["f".repeat(64)]);
    expect(C.GuidedResearchRuntime.safeParse(internal).success).toBe(false);
    expect(PersistedResearchRuntimeSchema.safeParse({ ...internal, privateLedger: { validatorVersion: 999, records: [] } }).success).toBe(false);
  });
  it("private changes do not affect public fingerprints, patches or polling progress", () => {
    const f = fixture();
    const known = Object.fromEntries(C.GuidedResearchRuntimeKnownFields.keySchema.options.map(key => [key, fieldFingerprint(f.state[key])]));
    for (const value of [runtimeDelta(f.state, known), runtimePollingDelta(f.state, known), runtimeProgress(f.state)]) {
      expect(JSON.stringify(value)).not.toMatch(/privateLedger|privateSourceScreenRejectedRequests|futurePrivateData|PRIVATE_LEDGER_SENTINEL|f{64}/);
    }
    expect(runtimeDelta(f.state, known).changes).toEqual({});
  });
  it.each([false, true])("controller GET, commands, SSE and polling exclude ledger with knownFields=%s", async withKnown => {
    const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
    const f = fixture(); delete f.store.steer;
    const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, f.service);
    vi.spyOn(controller as never, "current" as never).mockResolvedValue(f.session as never);
    const principal = { orgId: f.actor.orgId, userId: f.actor.userId };
    const knownFields = withKnown ? Object.fromEntries(C.GuidedResearchRuntimeKnownFields.keySchema.options.map(key => [key, fieldFingerprint(f.state[key])])) : undefined;
    const command = { ...f.command, action: "generate", ...(knownFields ? { knownFields } : {}) };
    const frames: string[] = [];
    const response = { setHeader: vi.fn(), flushHeaders: vi.fn(), on: vi.fn(), off: vi.fn(), end: vi.fn(), write: (frame: string) => frames.push(frame), writableLength: 0, destroyed: false };
    const get = await controller.getRuntime(principal, f.session.sessionId);
    const result = await controller.executeRuntime(principal, f.session.sessionId, command, {} as never);
    const progress = await controller.getRuntimeProgress(principal, f.session.sessionId, knownFields ? { knownFields: JSON.stringify(knownFields) } : {});
    await controller.streamRuntime(principal, f.session.sessionId, command, response as never, {} as never);
    expect(frames).toHaveLength(2);
    expect(JSON.stringify([get, result, progress, frames])).not.toMatch(/privateLedger|privateSourceScreenRejectedRequests|futurePrivateData|PRIVATE_LEDGER_SENTINEL|f{64}/);
    const events = frames.map(frame => JSON.parse(frame.slice(6)));
    expect(events.map(event => event.type)).toEqual(withKnown ? ["patch", "result_patch"] : ["snapshot", "result"]);
  });

});
