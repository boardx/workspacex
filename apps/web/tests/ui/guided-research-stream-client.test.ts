// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamResearchCommand } from "@/lib/guided-research-stream";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
const command = { sessionId: "session", requestId: "request", expectedVersion: 7, node: "research" as const, action: "complete" as const };
const runtime: GuidedResearchRuntime = { sessionId: "session", version: 8, revision: 1, currentNode: "report", availableNodes: ["brief", "research", "report"], brief: { topic: "topic", goal: "goal", timeRange: "", region: "", focus: "" }, directions: [], outline: [], tasks: [], sources: [], report: null, completed: false, busy: false, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [] };
function respond(text: string) {
  const bytes = new TextEncoder().encode(text);
  // Split every byte to exercise UTF-8, SSE frame delimiters and JSON boundaries.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "content-type": "text/event-stream" } })));
}
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe("research authenticated stream client", () => {
  it("decodes fragmented Unicode, ignores other request deltas and requires a final result", async () => {
    const delta = { type: "report_delta", sessionId: "session", requestId: "request", version: 8, sequence: 1, delta: "中国😀" };
    respond(`: heartbeat\r\n\r\ndata: ${JSON.stringify({ ...delta, requestId: "stale" })}\n\ndata: ${JSON.stringify(delta)}\r\n\r\ndata: ${JSON.stringify({ type: "result", state: runtime })}\n\n`);
    localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "test-token");
    const onEvent = vi.fn();
    expect(await streamResearchCommand(command, onEvent)).toEqual(runtime);
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenCalledWith(delta);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/runtime/commands/stream"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
  });
  it("reports a truncated stream as interruption and never retries a POST", async () => {
    respond('data: {"type":"report_delta","sessionId":"session","requestId":"request","version":8,"sequence":1,"delta":"部分"}\n\n');
    await expect(streamResearchCommand(command, vi.fn())).rejects.toMatchObject({ reasonCode: "RESEARCH_STREAM_INTERRUPTED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves server failure reasons", async () => {
    respond('data: {"type":"error","reasonCode":"RESEARCH_TASKS_INCOMPLETE"}\n\n');
    await expect(streamResearchCommand(command, vi.fn())).rejects.toMatchObject({ reasonCode: "RESEARCH_TASKS_INCOMPLETE" });
  });
});

it("reconstructs streamed field patches and report deltas without replacing unchanged steps", async () => {
  const baseline = { ...runtime, version: 7, revision: 1 };
  const patch = { type: "patch", sessionId: "session", version: 8, revision: 2, changes: { busy: true, reportStream: { requestId: "request", sequence: 0, text: "", status: "streaming" } }, removed: [] };
  const result = { ...patch, revision: 3, changes: { busy: false } };
  respond(`data: ${JSON.stringify({ type: "patch", state: patch })}\n\ndata: ${JSON.stringify({ type: "report_delta", sessionId: "session", requestId: "request", version: 8, sequence: 1, delta: "报告正文" })}\n\ndata: ${JSON.stringify({ type: "result_patch", state: result })}\n\n`);
  const state = await streamResearchCommand(command, vi.fn(), undefined, baseline);
  expect(state.brief).toEqual(baseline.brief);
  expect(state.busy).toBe(false);
  expect(state.reportStream?.text).toBe("报告正文");
});

it("merges research metadata, removes deleted sources, and restores authoritative bodies at completion", async () => {
  const source = { id: "source", taskId: "task", title: "Old title", url: "https://example.org/evidence", content: "retained real body", retrievedAt: "now", decision: "accepted" as const };
  const baseline = { ...runtime, version: 7, sources: [source, { ...source, id: "deleted" }] };
  const metadata = { id: source.id, taskId: source.taskId, title: "Updated title", url: source.url, retrievedAt: "later", decision: source.decision };
  const discovered = { ...metadata, id: "new", title: "New source", url: "https://example.org/new" };
  const patch = { type: "patch", sessionId: "session", version: 8, revision: 2, changes: { busy: true, currentNode: "research" }, removed: [], research: { cursor: "a".repeat(64), sources: [metadata, discovered] } };
  const full = [{ ...source, ...metadata, content: "updated authoritative body" }, { ...source, ...discovered, content: "new real body" }];
  const result = { ...patch, research: undefined, changes: { busy: false, sources: full } };
  respond(`data: ${JSON.stringify({ type: "patch", state: patch })}\n\ndata: ${JSON.stringify({ type: "result_patch", state: result })}\n\n`);
  const onEvent = vi.fn();
  const final = await streamResearchCommand(command, onEvent, undefined, baseline);
  const intermediate = onEvent.mock.calls[0]?.[0].state as GuidedResearchRuntime;
  expect(intermediate.sources.map(item => item.id)).toEqual(["source", "new"]);
  expect(intermediate.sources[0]?.content).toBe("retained real body");
  expect(intermediate.sources[1]?.content).toBe("New source");
  expect(final.sources).toEqual(full);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("negotiates and hydrates compact history after sources arrive in the same terminal patch", async () => {
  const source = { id: "source", taskId: "task", title: "Source", url: "https://example.org/evidence", content: "whole real body", retrievedAt: "now", decision: "accepted" as const };
  const baseline = { ...runtime, version: 7 };
  const patch = { type: "patch", sessionId: "session", version: 8, revision: 2, changes: { sources: [source], reportPrevious: { title: "History", createdAt: "now", report: null, text: "", chapters: [], sources: [], outline: [], aliases: [] } }, previousSourceIds: ["source"], removed: [] };
  respond(`data: ${JSON.stringify({ type: "result_patch", state: patch })}\n\n`);
  const result = await streamResearchCommand(command, vi.fn(), undefined, baseline);
  expect(result.reportPrevious?.sources).toEqual([source]);
  expect(result.reportPrevious?.sources[0]).not.toBe(result.sources[0]);
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string);
  expect(body).toMatchObject({ compactSources: true, knownFields: expect.any(Object) });
});

function unifiedResponse(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(event => JSON.stringify(event) + "\n").join(""));
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "content-type": "application/x-ndjson" } });
}
const receipt = { sessionId: "session", requestId: "request", version: 8, revision: 1 };
it("consumes interview-compatible NDJSON and hydrates the completed result once", async () => {
  const baseline = { ...runtime, busy: true };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(unifiedResponse([
    { type: "stage", stage: "report", source: receipt, stream: { sequence: 0, offset: 0, status: "streaming" } },
    { type: "delta", source: receipt, sequence: 1, delta: "中国😀" },
    { type: "completed", source: receipt },
  ])).mockResolvedValueOnce(new Response(JSON.stringify(runtime), { headers: { "content-type": "application/json" } })));
  const events = vi.fn();
  expect(await streamResearchCommand(command, events, undefined, baseline)).toEqual(runtime);
  expect(events.mock.calls.map(([event]) => event.type)).toEqual(["report_reset", "report_delta", "result"]);
  expect(events.mock.calls[1]?.[0].delta).toBe("中国😀");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.stringContaining("application/x-ndjson") }) }));
});
it("rejects common failed events and NDJSON without a terminal event", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unifiedResponse([{ type: "failed", reasonCode: "RESEARCH_TASKS_INCOMPLETE" }])));
  await expect(streamResearchCommand(command, vi.fn())).rejects.toMatchObject({ reasonCode: "RESEARCH_TASKS_INCOMPLETE" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unifiedResponse([{ type: "stage", stage: "planning", source: receipt }])));
  await expect(streamResearchCommand(command, vi.fn())).rejects.toMatchObject({ reasonCode: "RESEARCH_STREAM_INTERRUPTED" });
});
it("clears earlier streamed text when a retry stage resets the sequence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(unifiedResponse([
    { type: "stage", stage: "report", source: receipt, stream: { sequence: 0, offset: 0, status: "streaming" } },
    { type: "delta", source: receipt, sequence: 1, delta: "旧文" },
    { type: "stage", stage: "report", source: receipt, stream: { sequence: 2, offset: 0, status: "streaming" } },
    { type: "delta", source: receipt, sequence: 3, delta: "新文" },
    { type: "completed", source: receipt },
  ])).mockResolvedValueOnce(new Response(JSON.stringify(runtime))));
  const events = vi.fn();
  await streamResearchCommand(command, events, undefined, runtime);
  expect(events.mock.calls[2]?.[0]).toMatchObject({ type: "report_reset", sequence: 2 });
  expect(events.mock.calls[2]?.[0]).not.toHaveProperty("state");
  expect(events.mock.calls[3]?.[0]).toMatchObject({ type: "report_delta", sequence: 3, delta: "新文" });
});
it("rejects a completion for another session without fetching its state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(unifiedResponse([{ type: "completed", source: { ...receipt, sessionId: "foreign" } }])));
  await expect(streamResearchCommand(command, vi.fn())).rejects.toMatchObject({ reasonCode: "RESEARCH_STREAM_INVALID" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("emits only a stream reset when newer polling metadata exists, never a stale runtime snapshot", async () => {
  const baseline = { ...runtime, busy: true, sources: [], reportStream: { requestId: "request", sequence: 1, text: "旧文", status: "streaming" as const } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(unifiedResponse([
    { type: "stage", stage: "report", source: { ...receipt, revision: 5 }, stream: { sequence: 2, offset: 0, status: "streaming" } },
    { type: "completed", source: receipt },
  ])).mockResolvedValueOnce(new Response(JSON.stringify(runtime))));
  const pollingState = { ...runtime, revision: 5, brief: { ...runtime.brief, topic: "New plan from polling" }, busy: true };
  let latest = pollingState;
  await streamResearchCommand(command, event => {
    if (event.type === "report_reset") latest = { ...latest, reportStream: { requestId: event.requestId, sequence: event.sequence, text: "", status: event.status } };
    if (event.type === "snapshot") latest = event.state;
  }, undefined, baseline);
  expect(latest.brief.topic).toBe("New plan from polling");
  expect(latest.revision).toBe(5);
  expect(latest.reportStream).toMatchObject({ sequence: 2, text: "" });
});
it("ignores a reset older than an already synchronized stream sequence", async () => {
  const baseline = { ...runtime, busy: true, reportStream: { requestId: "request", sequence: 4, text: "已同步新正文", status: "streaming" as const } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(unifiedResponse([
    { type: "stage", stage: "report", source: receipt, stream: { sequence: 2, offset: 0, status: "streaming" } },
    { type: "completed", source: receipt },
  ])).mockResolvedValueOnce(new Response(JSON.stringify(runtime))));
  const events = vi.fn(); await streamResearchCommand(command, events, undefined, baseline);
  expect(events.mock.calls.map(([event]) => event.type)).toEqual(["result"]);
});
