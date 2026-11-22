import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEvent } from "@repo/contracts/execution-journal";
import { IMAGE_GENERATE_TOOL, readImageGeneratedReceiptSummary } from "@repo/contracts/standard-image-tools";
import { DeepAgentModelProvider } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { publicExecutionPayload, publicExecutionSummary } from "../../src/application/agent-run/public-execution-payload";
import type { ModelCallProgressEvent } from "../../src/application/agent-run/ports";

const input = { modelProvider: "deep-agent", modelId: "test", system: "", user: "task", orgId: "org", runId: "logical" };
const provider = () => new DeepAgentModelProvider({ baseUrl: "http://kernel.invalid", pollIntervalMs: 1, timeoutMs: 1000,
  subtaskCallbackBaseUrl: "http://api.invalid", subtaskCallbackKey: "test-key" });
function fakeKernel(messages: unknown[], interrupts?: unknown) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/runs")) {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ run_id: "remote" });
    }
    if (url.endsWith("/state")) return Response.json({ values: { messages } });
    if (url.endsWith("/runs/remote")) return Response.json({ status: "success" });
    if (init?.method === "POST" && url.endsWith("/threads")) return Response.json({ thread_id: "thread" });
    return Response.json(interrupts ? { status: "interrupted", interrupts } : { status: "idle" });
  }));
  return bodies;
}
afterEach(() => vi.unstubAllGlobals());
describe("workbench public execution", () => {
  it("preserves structured tool failure and stable final identity", async () => {
    fakeKernel([
      { type: "ai", content: "I will inspect the file", tool_calls: [{ id: "call", name: "read_file", args: { path: "x" } }] },
      { type: "tool", tool_call_id: "call", content: "permission denied", status: "error" },
      { type: "ai", id: "final-id", content: "Unable to read that file" },
    ]);
    const events: ModelCallProgressEvent[] = [];
    const result = await provider().completeWithProgress(input, async (event) => { events.push(event); });
    expect(events.map((event) => [event.phase, event.ok])).toEqual([["in_progress", undefined], ["complete", false]]);
    expect(result.finalMessageId).toBe("final-id");
  });
  const generatedImage = {
    status: "generated", workspacePath: `/workspace/generated-${"f".repeat(64)}.png`,
    mime: "image/png", width: 1024, height: 1024, sha256: "a".repeat(64), sizeBytes: 200_000,
    modelRef: "m".repeat(256), taskId: "t".repeat(256),
  } as const;

  async function nativeImageToolEnd(content: string, status = "success", name: string = IMAGE_GENERATE_TOOL) {
    fakeKernel([
      { type: "ai", content: "", tool_calls: [{ id: "image-call", name, args: { prompt: "Draw a prototype" } }] },
      { type: "tool", tool_call_id: "image-call", content, status },
      { type: "ai", id: "answer", content: "Complete" },
    ]);
    const events: ModelCallProgressEvent[] = [];
    await provider().completeWithProgress(input, async (event) => { events.push(event); });
    return events.find((event) => event.phase === "complete");
  }

  it("keeps exact bounded generated-image evidence in the public tool summary", async () => {
    const { modelRef, taskId, ...expected } = generatedImage;
    const end = await nativeImageToolEnd(JSON.stringify(generatedImage));
    expect(end).toMatchObject({ toolName: IMAGE_GENERATE_TOOL, toolCallId: "image-call", ok: true });
    const summary = publicExecutionSummary(end?.toolResultSummary ?? null);
    expect(summary).toBe(end?.toolResultSummary);
    expect(summary?.length).toBeLessThan(500);
    expect(summary).not.toContain(modelRef);
    expect(summary).not.toContain(taskId);
    expect(readImageGeneratedReceiptSummary(summary)).toEqual(expected);
  });

  it("could only issue an image receipt from valid native image tool output", async () => {
    const successful = await nativeImageToolEnd(JSON.stringify(generatedImage));
    const serialized = successful?.toolResultSummary ?? "";
    const invalid = [
      await nativeImageToolEnd(JSON.stringify({ ...generatedImage, sha256: "bad" })),
      await nativeImageToolEnd(JSON.stringify({ ...generatedImage, mime: "image/jpeg" })),
      await nativeImageToolEnd(JSON.stringify({ ...generatedImage, height: 2048 })),
      await nativeImageToolEnd(serialized),
      await nativeImageToolEnd(JSON.stringify(generatedImage), "error"),
      await nativeImageToolEnd(JSON.stringify(generatedImage), "success", "read_file"),
    ];
    expect(invalid.every((item) => item?.phase === "complete")).toBe(true);
    expect(invalid.map((item) => readImageGeneratedReceiptSummary(item?.toolResultSummary))).toEqual(Array(6).fill(null));
  });
  it("resumes the checkpoint without resubmitting the human message and forwards callback", async () => {
    const bodies = fakeKernel([{ type: "ai", id: "answer", content: "done" }]);
    await provider().completeWithProgress({ ...input, checkpointResume: true, liveInterjections: true }, async () => {});
    expect(bodies[0]).toMatchObject({ command: { resume: true }, config: { configurable: {
      run_control_callback: { base_url: "http://api.invalid", key: "test-key", org_id: "org", run_id: "logical" },
    } } });
    expect(bodies[0]).not.toHaveProperty("input");
  });
  it("distinguishes user pause from tool approval", async () => {
    fakeKernel([], { task: [{ value: { kind: "user_pause", runId: "logical" } }] });
    const result = await provider().completeWithProgress(input, async () => {});
    expect(result).toEqual({ text: "", paused: true });
  });
  it("confirms a real cancellation interrupt separately from pause", async () => {
    fakeKernel([], { task: [{ value: { kind: "user_cancel" } }] });
    expect(await provider().completeWithProgress(input, async () => {})).toEqual({ text: "", cancelled: true });
  });
  it("persists only validated public question fields for a real interrupt", async () => {
    fakeKernel([{ type: "ai", content: "", tool_calls: [{ id: "ask", name: "confirm_task_intent", args: {
      requestId: "question", understanding: "Make a plan", assumptions: ["a", "b"], api_key: "hidden" } }] }], { task: [{ value: {} }] });
    const result = await provider().completeWithProgress(input, async () => {});
    expect(result.interrupted?.argsSummary).not.toContain("hidden");
    expect(result.interrupted?.interrupt).toEqual({ toolName: "confirm_task_intent", args: {
      requestId: "question", understanding: "Make a plan", assumptions: ["a", "b"] } });
  });
  it("streams public text with message identities while rejecting human and reasoning chunks", async () => {
    fakeKernel([{ type: "ai", id: "final-id", content: "answer" }]);
    const original = globalThis.fetch;
    const frames = [
      [{ type: "human", id: "human", content: "secret user interjection" }, {}],
      [{ type: "AIMessageChunk", id: "thinking", content: [{ type: "reasoning", reasoning: "private" }] }, {}],
      [{ type: "AIMessageChunk", id: "progress-id", content: "checking" }, { langgraph_checkpoint_ns: "model:top" }],
      [{ type: "AIMessageChunk", id: "child-id", content: "child answer" }, { langgraph_checkpoint_ns: "tools:parent|model:child" }],
      [{ type: "AIMessageChunk", id: "final-id", content: "answer" }, {}],
    ].map((chunk) => `event: messages\ndata: ${JSON.stringify(chunk)}\n\n`).join("");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url.endsWith("/stream")
      ? new Response(frames, { headers: { "content-type": "text/event-stream" } }) : original(url, init)));
    const streaming = new DeepAgentModelProvider({ baseUrl: "http://kernel.invalid", pollIntervalMs: 1, timeoutMs: 1000, streamEnabled: true });
    const deltas: unknown[] = [];
    const completion = await streaming.completeWithProgress(input, async () => {}, async (delta, metadata) => { deltas.push([delta, metadata?.messageId]); });
    expect(completion.finalMessageId).toBe("final-id");
    expect(deltas).toEqual([["checking", "progress-id"], ["answer", "final-id"]]);
  });
  it("propagates journal callback failure instead of treating it as a recoverable stream disconnect", async () => {
    fakeKernel([{ type: "ai", id: "answer", content: "done" }]);
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url.endsWith("/stream")
      ? new Response('event: messages\ndata: [{"type":"AIMessageChunk","id":"answer","content":"token"},{}]\n\n')
      : original(url, init)));
    const streaming = new DeepAgentModelProvider({ baseUrl: "http://kernel.invalid", pollIntervalMs: 1, timeoutMs: 1000, streamEnabled: true });
    const failure = new Error("journal write failed");
    await expect(streaming.completeWithProgress(input, async () => {}, async () => { throw failure; })).rejects.toBe(failure);
  });
  it("does not reannounce completed history tools and still reports pending tool completion after resume", async () => {
    const old = [
      { type: "ai", content: "", tool_calls: [{ id: "old", name: "read_file", args: {} }, { id: "pending", name: "call_skill", args: { name: "research" } }] },
      { type: "tool", tool_call_id: "old", content: "old result", status: "success" },
    ];
    const current = [...old, { type: "tool", tool_call_id: "pending", content: "new result", status: "success" }, { type: "ai", id: "answer", content: "done" }];
    fakeKernel(current);
    const original = globalThis.fetch;
    let submitted = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/runs") && init?.method === "POST") submitted = true;
      if (url.endsWith("/state") && !submitted) return Response.json({ values: { messages: old } });
      return original(url, init);
    }));
    const events: ModelCallProgressEvent[] = [];
    await provider().completeWithProgress({ ...input, checkpointResume: true }, async (event) => { events.push(event); });
    expect(events.map((event) => event.toolCallId)).toEqual(["pending", "pending"]);
    expect(events.map((event) => event.phase)).toEqual(["in_progress", "complete"]);
  });
  it("does not leak secret keys or private reasoning blocks into public events", () => {
    expect(publicExecutionPayload('{"name":"research","api_key":"credential","nested":{"password":"hidden"}}'))
      .toEqual({ name: "research", api_key: "[REDACTED]", nested: { password: "[REDACTED]" } });
    expect(ExecutionEvent.safeParse({ kind: "reasoning", runId: "r", seq: 1, emittedAt: "now", delta: "private" }).success).toBe(false);
  });
});
