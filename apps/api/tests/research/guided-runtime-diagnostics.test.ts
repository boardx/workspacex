import { PersistedResearchRuntimeSchema } from "../../src/application/research/guided-runtime-persistence";
import { z } from "zod";
import { sourceRelevanceOutputSchema, sourceRelevanceSemanticCodes } from "../../src/application/research/guided-source-relevance-protocol";
import { quoteReferenceMatchSchema } from "../../src/application/research/guided-report-quote-references";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import type { DebugTracePort } from "../../src/application/ports/debug-trace.port";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { ResearchRuntimeError, type GuidedRuntimeStore, type RuntimeCommand } from "../../src/application/research/guided-runtime-ports";
import { toOrgId } from "../../src/domain/org-id";
import { recordResearchFailure, recordSourceRelevanceFailure } from "../../src/application/research/guided-runtime-diagnostics";
import { parseSourceRelevanceJson, screenResearchSources, sourceRelevanceResponseSchema } from "../../src/application/research/guided-source-relevance";
import { ModelCallError } from "../../src/application/agent-run/ports";

function fixture() {
  const session = C.GuidedResearchSession.parse({ sessionId: "diagnostic-session", title: "Synthetic", brief: { topic: "Grid", goal: "Entry", region: "EU", focus: "Policy", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
  const state = initialRuntime(session);
  state.reportCheckpoint = { basis: "saved", chapters: [{ sectionId: "saved", body: "Saved chapter", sourceIds: [] }] };
  const saved = structuredClone(state.reportCheckpoint);
  const write = vi.fn(async (_actor, _id, value, _done) => { PersistedResearchRuntimeSchema.parse(value); });
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
  it("records only the owned supplier rejection category", () => {
    const f=fixture();
    recordResearchFailure({record:f.record} as unknown as DebugTracePort, {phase:"perform",traceId:f.traceId}, f.actor, f.command,new ModelCallError("MODEL_CALL_FAILED","PRIVATE PROVIDER SECRET",undefined,undefined,"content-policy"));
    expect(f.record.mock.calls[0]![0].data.errors).toContainEqual({type:"ModelCallError",code:"MODEL_CALL_FAILED",contentRejection:"content-policy"});
    expect(JSON.stringify(f.record.mock.calls)).not.toContain("SECRET");
  });
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
    expect((f.model.complete.mock.calls as unknown as unknown[][])[0]![0]).not.toHaveProperty("responseSchema");
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
    f.traceId = "00000999-0000-4000-8000-000000000001";
    const error = { name: "PRIVATE CLASS", code: "SECRET", status: 999, cause: undefined as unknown };
    error.cause = error;
    vi.mocked(f.store.claim).mockRejectedValue(error);
    await expect(f.service.execute(f.actor, f.session, f.command, undefined, f.traceId)).rejects.toBe(error);
    expect(f.record.mock.calls[0]![0].data.errors).toEqual([{ type: "UnknownError" }]);
    expect(f.record.mock.calls[0]![0].traceId).toBe(f.traceId);
    // Numeric payload rejection is covered by exact errors above; trace IDs are legitimate metadata.
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE CLASS|SECRET/);
  });
});


describe("safe source relevance validation diagnostics", () => {
  function record(error: unknown) {
    const f = fixture();
    recordResearchFailure({ record: f.record } as unknown as DebugTracePort, { phase: "perform", traceId: f.traceId }, f.actor, f.command, error);
    return f.record.mock.calls[0]![0].data.errors[0];
  }
  it("records all protocol codes and all schema-derived fields without messages or values", () => {
    const evaluation = sourceRelevanceOutputSchema.shape.evaluations.element;
    const paths = [
      ...Object.keys(evaluation.shape).map((key) => ["evaluations", 0, key]),
      ...new Set([...Object.keys(evaluation.shape.matches.element.shape), ...Object.keys(quoteReferenceMatchSchema.shape)]).values(),
    ];
    const fieldPaths = paths.map((path) => typeof path === "string" ? ["evaluations", 0, "matches", 0, path] : path);
    fieldPaths.push(...Object.keys(C.GuidedResearchSourcePresentation.shape).map((key) => ["evaluations", 0, "presentation", key]));
    for (const path of fieldPaths) {
      expect(record(Object.assign(new ResearchRuntimeError("RESEARCH_SOURCE_RELEVANCE_INVALID"), {
        issues: [{ code: "invalid_type", path, message: "PRIVATE_SECRET", value: "PRIVATE_SECRET" }],
      })).issues).toEqual([{ code: "invalid_type", path }]);
    }
    for (const code of [...Object.values(z.ZodIssueCode), ...sourceRelevanceSemanticCodes]) {
      expect(record(Object.assign(new ResearchRuntimeError("RESEARCH_SOURCE_RELEVANCE_INVALID"), {
        issues: [{ code, path: [], message: "PRIVATE_SECRET" }],
      })).issues).toEqual([{ code, path: [] }]);
    }
  });
  it("records real screening repair exhaustion from service.perform while preserving sources and terminal semantics", async () => {
    const f = fixture();
    f.state.currentNode = "research";
    f.state.reportTimeline = [];
    f.state.availableNodes = ["brief", "directions", "outline", "research"];
    f.state.outline = [{ id: "section", title: "Grid", questions: ["Policy?"], order: 0, enabled: true }];
    f.state.tasks = [{ id: "task", sectionId: "section", query: "Grid policy", status: "succeeded", attempts: 1, errorCode: null }];
    f.state.sources = [{ id: "source", taskId: "task", title: "Grid", url: "https://example.org", content: "Synthetic grid policy.", retrievedAt: "now", decision: "accepted" }];
    const sources = structuredClone(f.state.sources);
    const model = { complete: vi.fn(async () => ({ text: '{"PRIVATE_PROVIDER_BODY_SECRET":' })) };
    const service = new GuidedRuntimeService(f.store, model, { search: vi.fn(async () => []) }, { provider: "test", id: "test" }, model, f.access, { record: f.record } as unknown as DebugTracePort);
    const result = await service.execute(f.actor, f.session, { sessionId: f.session.sessionId, node: "research", action: "complete", requestId: randomUUID(), expectedVersion: 0 }, undefined, f.traceId);
    expect(result).toMatchObject({ currentNode: "research", busy: false, completed: false, errorCode: "RESEARCH_SOURCE_RELEVANCE_INVALID" });
    expect(result.sources).toEqual(sources);
    expect(result.reportTimeline).toEqual([]);
    expect(model.complete).toHaveBeenCalledTimes(2);
    const inputs = model.complete.mock.calls as unknown as [{ responseSchema?: { name: string; policy: string; schema: { required: string[]; properties: { evaluations: { items: { properties: { matches: { items: { required: string[]; properties: Record<string, unknown> } } } } } } } } }][];
    for (const [input] of inputs) {
      expect(input.responseSchema).toBe(sourceRelevanceResponseSchema);
      expect(input.responseSchema).toMatchObject({ name: "source_relevance", policy: "strict-if-supported" });
      expect(input.responseSchema!.schema.required).toContain("evaluations");
      const match = input.responseSchema!.schema.properties.evaluations.items.properties.matches.items;
      expect(match.required).toContain("quoteRef"); expect(match.properties).not.toHaveProperty("quote");
    }


    expect(f.record).toHaveBeenCalledTimes(3);
    const terminal = f.record.mock.calls.map(([event]) => event).filter(event => event.kind === "research.runtime.failed");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.data).toMatchObject({ phase: "perform", node: "research", action: "complete", errors: [
      { type: "ResearchRuntimeError", reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID", issues: [{ code: "invalid_json", path: [] }] },
    ] });
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE_|rawOutput|message/);
  });

  it("retains the real invalid JSON category without the captured provider body", () => {
    let error: unknown;
    try { parseSourceRelevanceJson('{"PRIVATE_BODY_SECRET":'); } catch (cause) { error = cause; }
    expect(record(error)).toMatchObject({ reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID", issues: [{ code: "invalid_json", path: [] }] });
    expect(JSON.stringify(record(error))).not.toMatch(/PRIVATE_BODY_SECRET|Return one|rawOutput|message/);
  });

  async function screeningFailure(kind: "schema" | "semantic") {
    const f = fixture();
    f.state.outline = [{ id: "section", title: "Grid", questions: ["Policy?"], order: 0, enabled: true }];
    f.state.tasks = [{ id: "task", sectionId: "section", query: "Grid policy", status: "succeeded", attempts: 1, errorCode: null }];
    const source = { id: "PRIVATE_SOURCE_SECRET", taskId: "task", title: "Grid", url: "https://example.org", content: "PRIVATE_EXCERPT_SECRET grid policy.", retrievedAt: "now", decision: "accepted" as const };
    const complete = vi.fn(async (_system: string, context: any, validate: (value: unknown) => void) => {
      const chunk = context.chunks[0];
      const output = { evaluations: [{ sourceId: source.id, chunkId: chunk.chunkId, irrelevant: false,
        matches: kind === "schema" ? [{ questionId: "PRIVATE_QUESTION_SECRET", quote: source.content, insight: "PRIVATE_INSIGHT_SECRET", relevance: "PRIVATE_ENUM_SECRET" }]
          : [{ questionId: "PRIVATE_QUESTION_SECRET", quote: "PRIVATE_WRONG_QUOTE_SECRET", insight: "PRIVATE_INSIGHT_SECRET", relevance: "direct" }] }] };
      validate(output); return output;
    });
    let error: unknown;
    try { await screenResearchSources(f.state, [source], complete); } catch (cause) { error = cause; }
    expect(complete).toHaveBeenCalledTimes(2);
    expect(source).not.toHaveProperty("relevanceBasis");
    return error;
  }
  it("retains a real strict-schema code and structural path, excluding enum values", async () => {
    const result = record(await screeningFailure("schema"));
    expect(result.issues).toContainEqual({ code: "invalid_enum_value", path: ["evaluations", 0, "matches", 0, "relevance"] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|message|rawOutput/);
  });
  it("retains real semantic categories but not question IDs, excerpts, or repair instructions", async () => {
    const result = record(await screeningFailure("semantic"));
    expect(result.issues).toEqual([{ code: "task_question", path: ["evaluations", 0, "matches", 0, "questionId"] },
      { code: "verbatim_quote", path: ["evaluations", 0, "matches", 0, "quote"] }]);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|message|rawOutput/);
  });
  it("drops unallowlisted codes and unsafe paths rather than logging bounded private strings", () => {
    const error = Object.assign(new ResearchRuntimeError("RESEARCH_SOURCE_RELEVANCE_INVALID"), { rawOutput: "PRIVATE_RAW_SECRET", issues: [
      { code: "PRIVATE_CODE_SECRET", path: [], message: "PRIVATE_MESSAGE_SECRET" },
      { code: "unrecognized_keys", path: ["PRIVATE_PATH_SECRET"], keys: ["PRIVATE_KEY_SECRET"], message: "PRIVATE_MESSAGE_SECRET" },
      { code: "task_question", path: ["evaluations", -1, "matches"], message: "PRIVATE_MESSAGE_SECRET" },
      { code: "count", path: ["evaluations", 256], message: "PRIVATE_MESSAGE_SECRET" },
      { code: "missing_chunk", path: ["evaluations", 1.5], message: "PRIVATE_MESSAGE_SECRET" },
      { code: "unknown_chunk", path: ["evaluations", Number.POSITIVE_INFINITY], message: "PRIVATE_MESSAGE_SECRET" },
      { code: "verbatim_quote", path: ["evaluations", 0, "matches", 255, "quote"] },
    ] });
    expect(record(error).issues).toEqual([{ code: "unrecognized_keys" }, { code: "task_question" }, { code: "count" },
      { code: "missing_chunk" }, { code: "unknown_chunk" }, { code: "verbatim_quote", path: ["evaluations", 0, "matches", 255, "quote"] }]);
    expect(JSON.stringify(record(error))).not.toMatch(/PRIVATE_|message|rawOutput|"keys"/);
  });
  it("bounds issue count and path depth, ignoring malformed entries and unrelated errors", () => {
    const issues = Array.from({ length: 100 }, () => ({ code: "count", path: ["evaluations"], message: "PRIVATE_SECRET" }));
    const error = Object.assign(new ResearchRuntimeError("RESEARCH_SOURCE_RELEVANCE_INVALID"), { issues });
    expect(record(error).issues.length).toBe(16);
    expect(record(Object.assign(new Error("PRIVATE_SECRET"), { issues }))).not.toHaveProperty("issues");
    expect(record(Object.assign(new ResearchRuntimeError("RESEARCH_SOURCE_RELEVANCE_INVALID"), { issues: [null, "PRIVATE_SECRET", { code: "count", path: Array(7).fill("evaluations") }] })).issues).toEqual([{ code: "count" }]);
  });
});


describe("per-call source screening diagnostics", () => {
  function screeningFixture(mode: "invalid" | "repair" | "provider" | "schema" | "semantic", pipeline = false, sinkFails = false) {
    const f = fixture();
    f.state.currentNode = "research";
    f.state.reportTimeline = [];
    f.state.availableNodes = ["brief", "directions", "outline", "research"];
    f.state.outline = [{ id: "section", title: "Grid", questions: ["Policy?"], order: 0, enabled: true }];
    f.state.tasks = [{ id: "task", sectionId: "section", query: "Grid policy", status: pipeline ? "pending" : "succeeded", attempts: pipeline ? 0 : 1, errorCode: null }];
    const source = { id: "source", taskId: "task", title: "Grid", url: "https://example.org", content: "Synthetic grid policy.", retrievedAt: "now", decision: "accepted" as const };
    f.state.sources = pipeline ? [] : [source];
    if (sinkFails) f.record.mockImplementation(() => { throw new Error("PRIVATE_SINK_SECRET"); });
    let relevanceCalls = 0;
    const model = { complete: vi.fn(async (input: { user: string }) => {
      const context = JSON.parse(input.user);
      if (context.researchStage !== "source_relevance" || mode === "provider") throw new ModelCallError("MODEL_CALL_FAILED", "PRIVATE_PROVIDER_SECRET");
      relevanceCalls++;
      if (mode === "invalid" || (mode === "repair" && relevanceCalls === 1)) return { text: '{"PRIVATE_BODY_SECRET":' };
      return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; questionIds: string[]; quoteOptions: { quoteRef: string }[] }) => ({
        sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: mode !== "semantic",
        matches: mode === "schema" ? null : mode === "semantic" ? [{ questionId: "PRIVATE_QUESTION_SECRET", quoteRef: chunk.quoteOptions[0]!.quoteRef, insight: "Policy evidence", relevance: "direct" }] : [],
      })) }) };
    }) };
    const service = new GuidedRuntimeService(f.store, model, { search: vi.fn(async () => [source]) }, { provider: "test", id: "test" }, model, f.access, { record: f.record } as unknown as DebugTracePort);
    const command: RuntimeCommand = { ...f.command, node: "research", action: pipeline ? "start" : "complete" };
    return { ...f, command, model, service, events: () => f.record.mock.calls.map(([event]) => event).filter(event => event.kind === "research.source_relevance.failed") };
  }
  it("records both strict failures from the real task pipeline without changing partial failure", async () => {
    const f = screeningFixture("invalid", true);
    const result = await f.service.execute(f.actor, f.session, f.command, undefined, f.traceId);
    expect(result.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE");
    expect(result.tasks[0]?.status).toBe("failed");
    expect(result.sources).toEqual([]);
    expect(f.events()).toHaveLength(2);
    expect(f.traceId).not.toBe(f.command.requestId);
    expect(f.events().map(event => event.traceId)).toEqual([f.traceId, f.traceId]);
    for (const event of f.events()) expect(event.data).toMatchObject({ sessionId: f.session.sessionId, requestId: f.command.requestId, callId: expect.any(String), errors: [{ type: "ResearchRuntimeError", reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID", issues: [{ code: "invalid_json", path: [] }] }] });
    expect(new Set(f.events().map(event => event.data.callId)).size).toBe(2);
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE_|rawOutput|quote|context/);
  });
  it("retains the initial failed call when the finite repair succeeds", async () => {
    const f = screeningFixture("repair");
    const result = await f.service.execute(f.actor, f.session, f.command, undefined, f.traceId);
    expect(result.errorCode).toBe("RESEARCH_TASKS_INCOMPLETE");
    expect(result.currentNode).toBe("research");
    expect(result.sources).toEqual([]);
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    expect(f.events()).toHaveLength(1);
    expect(result.modelCalls.map(call => call.status)).toEqual(["failed", "succeeded"]);
    expect(f.events()[0]!.data.callId).toBe(result.modelCalls[0]!.id);
  });
  it.each(["schema", "semantic"] as const)("records strict %s failures with only safe code/path", async mode => {
    const f = screeningFixture(mode);
    const result = await f.service.execute(f.actor, f.session, f.command, undefined, f.traceId);
    expect(result.errorCode).toBe("RESEARCH_SOURCE_RELEVANCE_INVALID");
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    expect(f.events()).toHaveLength(2);
    expect(f.events()[0]!.data.errors[0].issues).toContainEqual(mode === "schema" ? { code: "invalid_type", path: ["evaluations", 0, "matches"] } : { code: "task_question", path: ["evaluations", 0, "matches", 0, "questionId"] });
    expect(JSON.stringify(f.record.mock.calls)).not.toMatch(/PRIVATE_|rawOutput|message/);
  });
  it("does not label provider failures as source validation failures", async () => {
    const f = screeningFixture("provider");
    const result = await f.service.execute(f.actor, f.session, f.command, undefined, f.traceId);
    expect(result.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE");
    expect(f.events()).toEqual([]);
    expect(f.model.complete).toHaveBeenCalledTimes(1);
  });
  it("a throwing sink preserves repair exhaustion, calls and saved source bytes", async () => {
    const f = screeningFixture("invalid", false, true);
    const result = await f.service.execute(f.actor, f.session, f.command, undefined, f.traceId);
    expect(result.errorCode).toBe("RESEARCH_SOURCE_RELEVANCE_INVALID");
    expect(result.sources).toEqual(f.state.sources);
    expect(f.model.complete).toHaveBeenCalledTimes(2);
    expect(f.events()).toHaveLength(2);
  });
});


describe("per-call relevance diagnostic privacy boundary", () => {
  it("selects only safe structural categories from attacker-controlled errors", () => {
    const record = vi.fn();
    const error = Object.assign(new ResearchRuntimeError("RESEARCH_SOURCE_RELEVANCE_INVALID"), { rawOutput: "PRIVATE_RAW_SECRET", issues: [
      { code: "task_question", path: ["evaluations", 0, "matches", 0, "questionId"], message: "PRIVATE_MESSAGE_SECRET" },
      { code: "invalid_type", path: ["evaluations", 0, "PRIVATE_PATH_SECRET"], message: "PRIVATE_MESSAGE_SECRET" },
      { code: "PRIVATE_CODE_SECRET", path: [] },
      { code: "count", path: ["evaluations", 256] },
    ] });
    recordSourceRelevanceFailure({ record } as unknown as DebugTracePort, { sessionId: "session", callId: "call", requestId: "request" }, error);
    expect(record.mock.calls[0]![0].data).toEqual({ sessionId: "session", callId: "call", requestId: "request", errors: [{ type: "ResearchRuntimeError", reasonCode: "RESEARCH_SOURCE_RELEVANCE_INVALID", issues: [
      { code: "task_question", path: ["evaluations", 0, "matches", 0, "questionId"] }, { code: "invalid_type" }, { code: "count" },
    ] }] });
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/PRIVATE_|rawOutput|message/);
    recordSourceRelevanceFailure({ record } as unknown as DebugTracePort, { sessionId: "session", callId: "call" }, new Error("PRIVATE_SECRET"));
    expect(record).toHaveBeenCalledTimes(1);
    const unreadable = Object.defineProperty(new ResearchRuntimeError("RESEARCH_SOURCE_RELEVANCE_INVALID"), "issues", { get() { throw new Error("PRIVATE_GETTER_SECRET"); } });
    expect(() => recordSourceRelevanceFailure({ record } as unknown as DebugTracePort, { sessionId: "session", callId: "call" }, unreadable)).not.toThrow();
    expect(record).toHaveBeenCalledTimes(1);
  });
});


describe("structured source schema preserves local evidence authority", () => {
  it.each(["negative", "wrong-question", "wrong-reference"] as const)("keeps %s output under the original strict gate and finite attempts", async kind => {
    const f = fixture();
    f.state.currentNode = "research"; f.state.availableNodes = ["brief", "directions", "outline", "research"];
    f.state.outline = [{ id: "section", title: "Grid", questions: ["Policy?"], order: 0, enabled: true }];
    f.state.tasks = [{ id: "task", sectionId: "section", query: "Grid policy", status: "succeeded", attempts: 1, errorCode: null }];
    f.state.sources = [{ id: "source", taskId: "task", title: "Grid", url: "https://example.org", content: "Synthetic grid policy.", retrievedAt: "now", decision: "accepted" }];
    const model = { complete: vi.fn(async (input: { user: string; responseSchema?: unknown }) => {
      expect(input.responseSchema).toBe(sourceRelevanceResponseSchema);
      const context = JSON.parse(input.user);
      return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; questionIds: string[]; quoteOptions: { quoteRef: string }[] }) => ({
        sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: kind === "negative", matches: kind === "negative" ? [] : [{
          questionId: kind === "wrong-question" ? "not-an-allowed-question" : chunk.questionIds[0],
          quoteRef: kind === "wrong-reference" ? "foreign-chunk#quote:0" : chunk.quoteOptions[0]!.quoteRef,
          insight: "Controlled evidence", relevance: "direct",
        }],
      })) }) };
    }) };
    const service = new GuidedRuntimeService(f.store, model, { search: vi.fn(async () => []) }, { provider: "test", id: "test" }, model, f.access);
    const result = await service.execute(f.actor, f.session, { ...f.command, node: "research", action: "complete" });
    expect(result).toMatchObject({ currentNode: "research", completed: false, busy: false });
    expect(result.errorCode).toBe(kind === "negative" ? "RESEARCH_TASKS_INCOMPLETE" : "RESEARCH_SOURCE_RELEVANCE_INVALID");
    expect(model.complete).toHaveBeenCalledTimes(kind === "negative" ? 1 : 2);
    expect(result.modelCalls.every(call => call.status === (kind === "negative" ? "succeeded" : "failed"))).toBe(true);
    expect(result.sources).toEqual(kind === "negative" ? [] : f.state.sources);
  });
});
