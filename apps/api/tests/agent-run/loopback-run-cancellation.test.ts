import { DeepAgentModelProvider, DEEP_AGENT_PROVIDER_NAME } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { expect, it, vi } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

it("accepts cancellation, interrupts the status, stops an open stream, and resets on a new run", async () => {
  const request = fixture({ LOOPBACK_DEEP_AGENT_SLOW_TRIGGER: "slow", LOOPBACK_DEEP_AGENT_SLOW_HOLD_MS: "10000" });
  const { thread_id: id } = await request("POST", "/threads", {});
  const input = { input: { messages: [{ role: "user", content: "slow" }] } };
  await request("POST", `/threads/${id}/runs`, input);
  const stream = request.openStream(`/threads/${id}/runs/${id}/stream`);
  expect(stream.isEnded()).toBe(false);
  expect(await request("POST", `/threads/${id}/runs/${id}/cancel?action=interrupt&wait=true`, {})).toEqual({});
  expect(stream.isEnded()).toBe(true);
  expect(await request("GET", `/threads/${id}/runs/${id}`)).toEqual({ status: "interrupted" });
  const frames = stream.frames.length;
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(stream.frames).toHaveLength(frames);
  await request("POST", `/threads/${id}/runs`, input);
  expect(await request("GET", `/threads/${id}/runs/${id}`)).toEqual({ status: "pending" });
});

it("rejects unknown run ids and thread placeholders that have never started", async () => {
  const request = fixture();
  const { thread_id: id } = await request("POST", "/threads", {});
  expect(await request("POST", `/threads/${id}/runs/${id}/cancel`, {})).toEqual({ error: "unknown run" });
  await request("POST", `/threads/${id}/runs`, { input: { messages: [{ role: "user", content: "hello" }] } });
  expect(await request("POST", `/threads/${id}/runs/unknown/cancel?action=interrupt&wait=true`, {})).toEqual({ error: "unknown run" });
  expect(await request("GET", `/threads/${id}/runs/${id}`)).toEqual({ status: "pending" });
});

it("holds multistep stream open with readable write_todos and releases at a bounded deadline", async () => {
  const request = fixture({ LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "1", LOOPBACK_DEEP_AGENT_MULTISTEP_STREAM_HOLD_MS: "250" });
  const { thread_id: id } = await request("POST", "/threads", {});
  await request("POST", `/threads/${id}/runs`, { input: { messages: [{ role: "user", content: "multistep" }] } });
  const stream = request.openStream(`/threads/${id}/runs/${id}/stream`);
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(stream.isEnded()).toBe(false);
    const state = await request("GET", `/threads/${id}/state`);
    expect(state.values.messages.flatMap((m: any) => m.tool_calls ?? []).some((call: any) => call.name === "write_todos")).toBe(true);
    for (let i = 0; i < 10; i++) expect(await request("GET", `/threads/${id}/runs/${id}`)).toEqual({ status: "pending" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(stream.isEnded()).toBe(true);
    expect(await request("GET", `/threads/${id}/runs/${id}`)).toEqual({ status: "success" });
  } finally { await request("POST", `/threads/${id}/runs/${id}/cancel`, {}); }
});

it("delivers write_todos through production completeWithProgress before held stream EOF", async () => {
  const request = fixture({ LOOPBACK_DEEP_AGENT_STREAM_GAP_MS: "1", LOOPBACK_DEEP_AGENT_MULTISTEP_STREAM_HOLD_MS: "250" });
  let live: ReturnType<typeof request.openStream> | undefined;
  const observed: { toolName: string; beforeEof: boolean }[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/stream")) {
      live = request.openStream(path);
      const stream = live;
      let cursor = 0;
      return new Response(new ReadableStream({ start(controller) {
        const timer = setInterval(() => {
          for (; cursor < stream.frames.length; cursor++) controller.enqueue(new TextEncoder().encode(stream.frames[cursor]!));
          if (stream.isEnded()) { clearInterval(timer); controller.close(); }
        }, 1);
      } }), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json(await request(init?.method ?? "GET", path, typeof init?.body === "string" ? JSON.parse(init.body) : undefined));
  });
  try {
    const provider = new DeepAgentModelProvider({ baseUrl: "http://fixture.test", streamEnabled: true, timeoutMs: 2000, pollIntervalMs: 1 });
    await provider.completeWithProgress({ modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "multistep" }, async (event) => {
      observed.push({ toolName: event.toolName, beforeEof: live?.isEnded() === false });
    }, async () => {});
    expect(observed.some((event) => event.toolName === "write_todos" && event.beforeEof)).toBe(true);
  } finally { vi.unstubAllGlobals(); }
}, 20_000);
