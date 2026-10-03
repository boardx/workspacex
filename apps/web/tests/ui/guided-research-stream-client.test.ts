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
