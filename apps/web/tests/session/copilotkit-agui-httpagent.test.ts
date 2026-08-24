/**
 * #654 阶段 1b -- proves the frontend's `@ag-ui/client` `HttpAgent` (the same shape
 * `copilotkit-preview-panel.tsx` uses) correctly parses the EXACT SSE wire format
 * `apps/api`'s `CopilotkitAguiController` emits, and lands the assistant's real text in
 * `agent.messages` -- the state `CopilotKitPreviewPanel` renders into the DOM.
 *
 * This does not spin up `apps/api` itself (no DB / model provider in this workspace's
 * test run); instead it runs a tiny real Node `http` server that writes the SAME
 * `data: <json>\n\n` frames, with the SAME `@ag-ui/core` `EventType` values and field
 * names, that `apps/api/src/interface/controllers/copilotkit-agui.controller.ts` writes
 * (see that file and `apps/api/tests/agent-runtime/agui-bridge-sse.test.ts`, which proves
 * the SERVER side against a real backend). Together the two files prove both halves of
 * "a message goes in over SSE, AG-UI content comes out for the UI to render" without
 * needing a second full-stack harness in this package.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { HttpAgent, type AgentSubscriber } from "@ag-ui/client";
import { EventType } from "@ag-ui/core";

const REPLY_TEXT = "durable AG-UI reply from a real SSE round trip";

function writeAguiSse(res: ServerResponse, opts: {
  threadId: string; runId: string; ok: boolean;
}): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const write = (event: Record<string, unknown>): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  if (!opts.ok) {
    write({ type: EventType.RUN_ERROR, message: "AGENT_NOT_FOUND", code: "AGENT_NOT_FOUND" });
    res.end();
    return;
  }
  const messageId = randomUUID();
  write({ type: EventType.RUN_STARTED, threadId: opts.threadId, runId: opts.runId });
  write({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
  write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: REPLY_TEXT });
  write({ type: EventType.TEXT_MESSAGE_END, messageId });
  write({ type: EventType.RUN_FINISHED, threadId: opts.threadId, runId: opts.runId });
  res.end();
}

async function startBridgeStub(ok: boolean): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        threadId: string; runId: string;
      };
      writeAguiSse(res, { threadId: body.threadId, runId: body.runId, ok });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}/copilotkit/agui?agentId=stub-agent`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * DA-19a -- a stub that plays the SAME role `CopilotkitAguiController` does for thread
 * continuation: echo back `body.forwardedProps.chatThreadId` (or mint a fresh one) as a
 * `CUSTOM chat_thread_id` event before the rest of a normal successful turn. Records every
 * request's `forwardedProps` so the test can assert the SECOND call actually sent back what
 * the FIRST call taught it -- the exact round trip `copilotkit-preview-panel.tsx` performs.
 */
async function startThreadContinuationStub(): Promise<{
  url: string; close: () => Promise<void>; seenForwardedProps: () => readonly unknown[];
}> {
  const seen: unknown[] = [];
  let mintedThreadId = "";
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        threadId: string; runId: string; forwardedProps?: { chatThreadId?: string };
      };
      seen.push(body.forwardedProps);
      const resolvedThreadId = body.forwardedProps?.chatThreadId?.trim();
      mintedThreadId = resolvedThreadId !== undefined && resolvedThreadId !== "" ? resolvedThreadId : randomUUID();

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const write = (event: Record<string, unknown>): void => { res.write(`data: ${JSON.stringify(event)}\n\n`); };
      // RUN_STARTED must be the first event on the wire (`@ag-ui/client`'s own protocol
      // verifier enforces this -- see `copilotkit-agui.controller.ts` file head "DA-19a"
      // for the real bug this ordering fixes), so CUSTOM chat_thread_id comes right after.
      write({ type: EventType.RUN_STARTED, threadId: body.threadId, runId: body.runId });
      write({ type: EventType.CUSTOM, name: "chat_thread_id", value: mintedThreadId });
      const messageId = randomUUID();
      write({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
      write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: REPLY_TEXT });
      write({ type: EventType.TEXT_MESSAGE_END, messageId });
      write({ type: EventType.RUN_FINISHED, threadId: body.threadId, runId: body.runId });
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}/copilotkit/agui?agentId=stub-agent`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    seenForwardedProps: () => seen,
  };
}

/** DA-19a -- a 401 rejected BEFORE any `text/event-stream` bytes are written, exactly what
 * `apps/api`'s global auth guard produces for a missing/expired bearer token (see
 * `current-principal.decorator.ts`'s own doc: the guard resolves the principal, this
 * controller never does). Proves `HttpAgent.runAgent()` REJECTS on this shape (not silently
 * resolves with nothing) -- the panel's `catch` block has something real to catch. */
async function startUnauthorizedStub(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ statusCode: 401, message: "Unauthorized" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}/copilotkit/agui?agentId=stub-agent`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe("@ag-ui/client HttpAgent against this repo's real AG-UI SSE wire format", () => {
  it("lands the assistant's real text in agent.messages -- what the preview panel renders", async () => {
    const stub = await startBridgeStub(true);
    cleanup = stub.close;

    const agent = new HttpAgent({ url: stub.url, headers: { Authorization: "Bearer test-token" } });
    agent.messages = [{ id: randomUUID(), role: "user", content: "Hello from a real HttpAgent" }];

    const seenErrors: string[] = [];
    await agent.runAgent(undefined, {
      onRunErrorEvent: ({ event }) => { seenErrors.push(event.message); },
    });

    expect(seenErrors).toEqual([]);
    const assistant = agent.messages.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect("content" in assistant! ? assistant.content : null).toBe(REPLY_TEXT);
  });

  it("surfaces a RUN_ERROR event (not a fabricated success) when the bridge refuses the turn", async () => {
    const stub = await startBridgeStub(false);
    cleanup = stub.close;

    const agent = new HttpAgent({ url: stub.url, headers: { Authorization: "Bearer test-token" } });
    agent.messages = [{ id: randomUUID(), role: "user", content: "Hello" }];

    const seenErrors: string[] = [];
    await agent.runAgent(undefined, {
      onRunErrorEvent: ({ event }) => { seenErrors.push(event.message); },
    });

    expect(seenErrors).toEqual(["AGENT_NOT_FOUND"]);
    expect(agent.messages.some((m) => m.role === "assistant")).toBe(false);
  });

  it("DA-19a: forwardedProps.chatThreadId round-trips through a real CUSTOM chat_thread_id event -- " +
    "the same mechanism copilotkit-preview-panel.tsx uses for cross-turn continuation", async () => {
    const stub = await startThreadContinuationStub();
    cleanup = stub.close;

    let learnedThreadId: string | null = null;
    // 用 `AgentSubscriber` 做上下文类型标注（而不是手写 `event` 的字面量形状）：
    // `CustomEvent` 由 `@ag-ui/core` 的 zod schema 推导，手写的窄类型跟真实形状对不上，
    // `runAgent()` 调用处会报 TS2345（对象字面量单独标注时不会报，直到被当实参传入才暴露）。
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        if (event.name === "chat_thread_id" && typeof event.value === "string") learnedThreadId = event.value;
      },
    };

    // Turn 1: no chatThreadId known yet -- the stub mints one and reports it back.
    const agent1 = new HttpAgent({ url: stub.url, headers: { Authorization: "Bearer test-token" } });
    agent1.messages = [{ id: randomUUID(), role: "user", content: "First turn" }];
    await agent1.runAgent({ forwardedProps: {} }, subscriber);
    expect(learnedThreadId).not.toBeNull();
    const firstThreadId = learnedThreadId as unknown as string;

    // Turn 2: echo the learned id forward, exactly like the panel's `send()` does.
    const agent2 = new HttpAgent({ url: stub.url, headers: { Authorization: "Bearer test-token" } });
    agent2.messages = [{ id: randomUUID(), role: "user", content: "Second turn, same thread" }];
    await agent2.runAgent({ forwardedProps: { chatThreadId: firstThreadId } }, subscriber);

    // The server actually RECEIVED it on the wire (not just accepted locally), and echoed
    // back the SAME id -- real round trip, not two independently-generated values that
    // happen to be non-null.
    expect(stub.seenForwardedProps()).toEqual([{}, { chatThreadId: firstThreadId }]);
    expect(learnedThreadId).toBe(firstThreadId);
  });

  it("DA-19a: an HTTP 401 rejected before any SSE bytes (missing/expired bearer token) " +
    "makes runAgent() REJECT -- not resolve silently with no assistant reply and no error", async () => {
    const stub = await startUnauthorizedStub();
    cleanup = stub.close;

    const agent = new HttpAgent({ url: stub.url, headers: {} }); // no Authorization header
    agent.messages = [{ id: randomUUID(), role: "user", content: "Hello" }];

    await expect(agent.runAgent(undefined, {})).rejects.toBeTruthy();
  });
});
