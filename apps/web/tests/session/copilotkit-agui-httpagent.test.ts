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
import { HttpAgent } from "@ag-ui/client";
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
});
