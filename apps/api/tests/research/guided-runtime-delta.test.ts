import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
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
  const result = await controller.executeRuntime({ userId: "u", orgId: "org" as never }, "s", input, { traceId: "delta-command-trace" } as never);
  expect(result).toMatchObject({ type: "patch", changes: { busy: true } });
  expect(execute.mock.calls[0]?.[2]).not.toHaveProperty("knownFields");
  expect(execute.mock.calls[0]?.[4]).toBe("delta-command-trace");
  expect(result).not.toHaveProperty("messages");
});

it("streams changed snapshots and does not resend report text after token deltas", async () => {
  const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
  const { vi } = await import("vitest");
  const stream = { requestId: "r", sequence: 0, text: "", status: "streaming" as const };
  const busy = { ...state, version: 3, revision: 2, busy: true, reportStream: stream };
  const execute = vi.fn(async (_scope, _session, _command, send, _traceId?: string) => {
    send({ type: "snapshot", state: busy });
    send({ type: "report_delta", sessionId: "s", requestId: "r", version: 3, sequence: 1, delta: "正文" });
    send({ type: "result", state: { ...busy, busy: false, reportStream: { ...stream, sequence: 1, text: "正文" } } });
  });
  const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, { execute } as never);
  vi.spyOn(controller as never, "current" as never).mockResolvedValue({} as never);
  const frames: string[] = [];
  const response = { setHeader: vi.fn(), flushHeaders: vi.fn(), on: vi.fn(), off: vi.fn(), end: vi.fn(), write: (frame: string) => frames.push(frame), writableLength: 0, destroyed: false };
  await controller.streamRuntime({ userId: "u", orgId: "org" as never }, "s", { requestId: "r", expectedVersion: 2, node: "report", action: "generate", knownFields: fingerprints() }, response as never, { traceId: "delta-stream-trace" } as never);
  const events = frames.map((frame) => JSON.parse(frame.slice(6)));
  expect(events.map((event) => event.type)).toEqual(["patch", "report_delta", "result_patch"]);
  expect(events[2].state.changes).toEqual({ busy: false });
  expect(execute.mock.calls[0]?.[2]).not.toHaveProperty("knownFields");
  expect(execute.mock.calls[0]?.[4]).toBe("delta-stream-trace");
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
  expect(unchanged).not.toHaveProperty("research");
  expect("research" in unchanged && unchanged.research).not.toHaveProperty("sources");
});

it("keeps active research polling compact as large source bodies accumulate", async () => {
  const { runtimePollingDelta } = await import("../../src/interface/controllers/guided-research-delta");
  const source = { id: "source", taskId: "task", title: "Official source", url: "https://example.org/source", content: "BODY".repeat(7500), retrievedAt: "now", decision: "accepted" as const };
  const growing = { ...state, currentNode: "research" as const, busy: true, sources: [source, { ...source, id: "new", url: "https://example.org/new" }] };
  const patch = runtimePollingDelta(growing, fingerprints());
  expect(patch.changes).not.toHaveProperty("sources");
  expect(JSON.stringify(patch)).not.toContain("BODY");
  expect(JSON.stringify(patch).length).toBeLessThan(2000);
  expect(patch.research?.sources?.map((item) => item.id)).toEqual(["source", "new"]);
  const unchanged = runtimePollingDelta(growing, fingerprints(), undefined, 0, undefined, patch.research?.cursor);
  expect(unchanged).not.toHaveProperty("research");
  const terminal = runtimePollingDelta({ ...growing, busy: false }, fingerprints());
  expect(terminal.changes).not.toHaveProperty("sources");
  expect(JSON.stringify(terminal)).not.toContain("BODY");
});

async function outlineResponse(next: ResearchRuntime, action: "save" | "save_chapters" | "generate" | "confirm" | "apply" | "message" = "save", knownFields?: ReturnType<typeof fingerprints>) {
  const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
  const { vi } = await import("vitest");
  const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, { execute: vi.fn(async () => next) } as never);
  vi.spyOn(controller as never, "current" as never).mockResolvedValue({} as never);
  return controller.executeRuntime({ userId: "u", orgId: "org" as never }, "s", { requestId: "stage", expectedVersion: 2, node: "outline", action,
    ...(action === "message" ? { message: "Edit the plan" } : { draft: { node: "outline", value: [{ id: "o", title: "chapter", questions: ["q"], enabled: true, order: 0 }] } }),
    ...(knownFields ? { knownFields } : {}) }, {} as never);
}

it.each(["save", "generate", "confirm", "apply", "message"] as const)("returns a real plan-stage patch without cache hints for %s, including a legal null researchPlan", async action => {
  const next = { ...state, researchPlan: null, version: 3, revision: 2 };
  const response = await outlineResponse(next, action);
  const patch = C.GuidedResearchRuntimePatch.parse(response);
  expect(patch).toMatchObject({ sessionId: "s", version: 3, revision: 2, changes: { currentNode: "outline", directions: [], outline: [], researchPlan: null, busy: false } });
  for (const key of ["brief", "messages", "modelCalls"]) { expect(patch.changes).not.toHaveProperty(key); expect(patch.removed).not.toContain(key); }
});

it("omits large saved source/report/history bodies while preserving authoritative plan failure and recovery controls", async () => {
  const report = { title: "Saved report", summary: "SAVED_REPORT_BODY".repeat(500), sections: [{ sectionId: "o", body: "SAVED_REPORT_BODY".repeat(1000), sourceIds: ["source"] }] };
  const source = { id: "source", taskId: "task", title: "Evidence", url: "https://example.org/evidence", content: "SAVED_SOURCE_BODY".repeat(1000), retrievedAt: "now", decision: "accepted" as const };
  const next = C.GuidedResearchRuntime.parse({ ...state, sources: [source], report, reportDraft: report,
    reportCheckpoint: { basis: "basis", chapters: report.sections }, reportPrevious: { title: "Previous", createdAt: "now", report, text: "PREVIOUS_BODY".repeat(10000), chapters: report.sections, sources: [source], outline: [], aliases: [] },
    busy: true, leaseUntil: "future", errorCode: "RESEARCH_NODE_STATE_INVALID", controlStatus: "paused", planRevision: 3,
    reportTimeline: [{ id: "old-step", stage: "evidence", status: "failed", attempts: 1 }], reportPartial: true,
    reportSourceAliases: [{ alias: "s1", sourceId: "source" }], reportQualityWarnings: [{ sectionId: "o", issues: ["OLD_METADATA"] }],
    reportEvidenceWarnings: [{ batchIndex: 0, sourceIds: ["source"], questionIds: ["q"], reason: "invalid_model_evidence" }],
    qualityScore: { citationCoverage: null, authority: null, recency: null, crossValidation: null, openGapCount: 1, overall: null, explanations: ["OLD_METADATA"] },
    publicationReadiness: { status: "limited", blockers: ["OLD_METADATA"], warnings: [] } });
  const patch = C.GuidedResearchRuntimePatch.parse(await outlineResponse(next));
  for (const key of ["coverage", "claimEvidence", "conflicts", "qualityScore", "publicationReadiness"] as const) expect(patch.changes[key]).toEqual(next[key]);
  expect(JSON.stringify(patch)).not.toMatch(/SAVED_REPORT_BODY|SAVED_SOURCE_BODY|PREVIOUS_BODY|历史内容/);
  expect(patch.changes).toMatchObject({ busy: true, leaseUntil: "future", errorCode: "RESEARCH_NODE_STATE_INVALID", controlStatus: "paused", planRevision: 3 });
  for (const key of ["sources", "report", "reportDraft", "reportCheckpoint", "reportPrevious", "reportTimeline", "reportPartial", "reportSourceAliases", "reportQualityWarnings", "reportEvidenceWarnings"]) { expect(patch.changes).not.toHaveProperty(key); expect(patch.removed).not.toContain(key); }
});

it("explicitly clears actual downstream resets, including absent previous reports, even with matching cache hints", async () => {
  const next = { ...state, sources: [], tasks: [], report: null, reportDraft: null, reportCheckpoint: null, reportStream: null, questionEvidence: [], reportTimeline: [], reportPartial: false };
  const patch = C.GuidedResearchRuntimePatch.parse(await outlineResponse(next, "save", fingerprints()));
  expect(patch.changes).toMatchObject({ sources: [], tasks: [], report: null, reportDraft: null, reportCheckpoint: null, reportStream: null, questionEvidence: [], reportTimeline: [], reportPartial: false });
  expect(patch.removed).toContain("reportPrevious");
});

it("keeps saved chapter sources in the client baseline rather than falsely clearing them", async () => {
  const source = { id: "source", taskId: "task", title: "Evidence", url: "https://example.org/evidence", content: "retained-source-body", retrievedAt: "now", decision: "accepted" as const };
  const next = { ...state, sources: [source], currentNode: "research" as const, availableNodes: ["brief", "directions", "outline", "research"] as ResearchRuntime["availableNodes"], report: null };
  const patch = C.GuidedResearchRuntimePatch.parse(await outlineResponse(next, "save_chapters"));
  expect(patch.changes).not.toHaveProperty("sources"); expect(patch.removed).not.toContain("sources");
  expect(patch.changes).toMatchObject({ currentNode: "research", report: null });
  const merged = C.GuidedResearchRuntime.parse({ ...next, ...patch.changes });
  expect(merged.sources).toEqual([source]);
});

it.each(["save", "save_chapters"] as const)("projects the real service's %s invalidation without inventing source resets", async action => {
  const { GuidedRuntimeService } = await import("../../src/application/research/guided-runtime-service");
  const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
  const { vi } = await import("vitest");
  const session = C.GuidedResearchSession.parse({ sessionId: "s", title: "Study", brief: state.brief, stage: "report", resumeStage: "report", status: "active", progress: 100, sourceCount: 1, reportId: null, createdAt: "now", updatedAt: "now" });
  const source = { id: "source", taskId: "task", title: "Evidence", url: "https://example.org/evidence", content: "retained real evidence", retrievedAt: "now", decision: "accepted" as const };
  let saved = C.GuidedResearchRuntime.parse({ ...state, currentNode: "report", availableNodes: ["brief", "directions", "outline", "research", "report"], generatedNodes: ["brief", "directions", "outline", "research", "report"], sources: [source],
    tasks: [{ id: "task", sectionId: "o", query: "q", status: "succeeded", attempts: 1, errorCode: null }], outline: [{ id: "o", title: "Old", questions: ["q"], enabled: true, order: 0 }],
    report: { title: "Old", summary: "Saved summary", sections: [{ sectionId: "o", body: "Saved report body", sourceIds: ["source"] }] } });
  const model = { complete: vi.fn(async () => { throw new Error("save must not invoke models"); }) };
  const service = new GuidedRuntimeService({ read: async () => structuredClone(saved), claim: async () => { saved.version++; saved.busy = true; return { state: structuredClone(saved), replay: false }; },
    write: async (_actor, _request, next) => { saved = structuredClone(next); } }, model, { search: async () => [] }, { provider: "controlled", id: "test" });
  const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, service);
  vi.spyOn(controller as never, "current" as never).mockResolvedValue(session as never);
  const patch = C.GuidedResearchRuntimePatch.parse(await controller.executeRuntime({ userId: "u", orgId: "org" as never }, "s", { requestId: "real-save", expectedVersion: 2, node: "outline", action,
    draft: { node: "outline", value: [{ id: "o", title: "Edited", questions: ["q"], enabled: true, order: 0 }] } }, {} as never));
  expect(saved.errorCode).toBeNull(); expect(saved.report).toBeNull(); expect(saved.reportPrevious).toBeTruthy();
  expect(patch.changes).toHaveProperty("report", null); expect(patch.changes).not.toHaveProperty("reportPrevious"); expect(patch.removed).not.toContain("reportPrevious");
  if (action === "save") { expect(saved.sources).toEqual([]); expect(patch.changes).toHaveProperty("sources", []); }
  else { expect(saved.sources).toEqual([source]); expect(patch.changes).not.toHaveProperty("sources"); expect(patch.removed).not.toContain("sources"); }
  expect(model.complete).not.toHaveBeenCalled();
});


it("keeps non-outline ordinary commands on their existing full-or-fingerprint response paths", async () => {
  const { GuidedResearchController } = await import("../../src/interface/controllers/guided-research.controller");
  const { vi } = await import("vitest");
  const next = { ...state, busy: true };
  const controller = new GuidedResearchController({} as never, {} as never, {} as never, {} as never, {} as never, { execute: vi.fn(async () => next) } as never);
  vi.spyOn(controller as never, "current" as never).mockResolvedValue({} as never);
  const command = { requestId: "other-node", expectedVersion: 2, node: "brief", action: "generate" };
  expect(await controller.executeRuntime({ userId: "u", orgId: "org" as never }, "s", command, {} as never)).toEqual(next);
  const patch = C.GuidedResearchRuntimePatch.parse(await controller.executeRuntime({ userId: "u", orgId: "org" as never }, "s", { ...command, knownFields: fingerprints() }, {} as never));
  expect(patch.changes).toEqual({ busy: true }); expect(patch.removed).toEqual([]);
});
