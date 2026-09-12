import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
  deriveRemoteThreadId,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
let processHandle: ChildProcess;
let baseUrl: string;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("failed to reserve loopback port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForHealth(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch { /* process is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("self-hosted runtime fixture did not become healthy");
}

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  processHandle = spawn(`${ROOT}/apps/deep-agent-service/.venv/bin/python`, [
    `${ROOT}/apps/api/tests/fixtures/self-hosted-agent-runtime.py`, String(port),
  ], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
  await waitForHealth(baseUrl);
}, 30_000);

afterAll(async () => {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    processHandle.once("exit", () => resolve());
    setTimeout(resolve, 2_000);
  });
});

const input = (threadId: string, user: string) => ({
  modelProvider: DEEP_AGENT_PROVIDER_NAME,
  modelId: "deep-agent",
  system: "contract test",
  user,
  history: [],
  skills: [],
  threadId,
});

const provider = () => new DeepAgentModelProvider({
  baseUrl, streamEnabled: true, timeoutMs: 5_000, pollIntervalMs: 10,
});

describe("DeepAgentModelProvider ↔ self-hosted runtime HTTP contract", () => {
  it("discovers both registered assistants and completes through thread/run/state/SSE", async () => {
    const discovery = await fetch(`${baseUrl}/assistants/search`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toEqual([
      { assistant_id: "Deep Agent", graph_id: "Deep Agent" },
      { assistant_id: "Guided Research", graph_id: "Guided Research" },
    ]);

    const threadId = "api-runtime-contract";
    const result = await provider().completeWithProgress(input(threadId, "hello") as never, async () => {}, async () => {});
    expect(result.text).toBe("runtime answer");

    const remoteThreadId = deriveRemoteThreadId(threadId);
    const thread = await fetch(`${baseUrl}/threads/${remoteThreadId}`);
    expect(thread.status).toBe(200);
    expect(await thread.json()).toMatchObject({ thread_id: remoteThreadId, status: "idle", interrupts: {} });

    const state = await fetch(`${baseUrl}/threads/${remoteThreadId}/state`);
    expect(await state.json()).toMatchObject({ values: { messages: [{ type: "ai", content: "runtime answer" }] }, next: [] });
  });

  it("returns the provider interrupt shape and accepts command.resume without replaying input", async () => {
    const threadId = "api-runtime-interrupt";
    const interrupted = await provider().completeWithProgress(input(threadId, "interrupt") as never, async () => {});
    expect(interrupted).toMatchObject({
      text: "",
      interrupted: {
        toolName: "call_skill",
        toolCallId: "approval-1",
        skillStableName: "diagram-maker",
      },
    });

    const resumed = await provider().completeWithProgress({
      ...input(threadId, "must not be replayed"), resume: { decision: "approve" },
    } as never, async () => {});
    expect(resumed.text).toBe("resumed answer");
  });

  it("exposes replayable SSE frames and a terminal cancel status", async () => {
    const threadId = "raw-runtime-cancel";
    await fetch(`${baseUrl}/threads`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ thread_id: threadId }),
    });
    const created = await fetch(`${baseUrl}/threads/${threadId}/runs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistant_id: "Deep Agent", input: { messages: [{ role: "user", content: "slow" }] } }),
    });
    const { run_id: runId } = await created.json() as { run_id: string };
    const cancelled = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ ok: true });

    const status = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`);
    expect(await status.json()).toMatchObject({ run_id: runId, thread_id: threadId, status: "cancelled" });

    const stream = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}/stream`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const body = await stream.text();
    expect(body).toContain("event: metadata");
    expect(body).toContain('"status": "cancelled"');
  });
});
