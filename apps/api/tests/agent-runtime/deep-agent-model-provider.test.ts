/**
 * #740 -- `DeepAgentModelProvider`. Same philosophy as
 * `configured-model-provider-stream.test.ts` and `deep-research-agent-bootstrap-chat.test.ts`:
 * a real loopback HTTP server implementing the four endpoint shapes this adapter depends on
 * (create thread / create run / poll status / read state), not a mocked `fetch` -- the thing
 * that can actually be wrong here is how this file talks HTTP, not business logic.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME, DeepAgentModelProvider,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { ModelCallError } from "../../src/application/agent-run/ports";

let server: Server;
let base = "";
let threadId = "";
let runId = "";
let capturedRunBodies: unknown[] = [];
let statusSequence: string[] = ["success"];
let statusCallCount = 0;
let stateResponse: unknown = { values: { messages: [] } };
let threadCreateStatus = 200;

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startServer(): Promise<void> {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/threads") {
      if (threadCreateStatus !== 200) return respond(res, threadCreateStatus, { error: "boom" });
      return respond(res, 200, { thread_id: threadId });
    }
    if (req.method === "POST" && url === `/threads/${threadId}/runs`) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try { capturedRunBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { capturedRunBodies.push({}); }
        respond(res, 200, { run_id: runId });
      });
      return;
    }
    if (req.method === "GET" && url === `/threads/${threadId}/runs/${runId}`) {
      const status = statusSequence[Math.min(statusCallCount, statusSequence.length - 1)];
      statusCallCount += 1;
      return respond(res, 200, { status });
    }
    if (req.method === "GET" && url === `/threads/${threadId}/state`) {
      return respond(res, 200, stateResponse);
    }
    respond(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
}

function provider(overrides: Partial<{ timeoutMs: number; pollIntervalMs: number }> = {}): DeepAgentModelProvider {
  return new DeepAgentModelProvider({
    baseUrl: base, timeoutMs: overrides.timeoutMs ?? 5_000, pollIntervalMs: overrides.pollIntervalMs ?? 10,
  });
}

beforeAll(async () => { await startServer(); });
afterEach(() => {
  threadId = `thread-${randomUUID()}`;
  runId = `run-${randomUUID()}`;
  capturedRunBodies = [];
  statusSequence = ["success"];
  statusCallCount = 0;
  stateResponse = { values: { messages: [{ type: "ai", content: "默认回复" }] } };
  threadCreateStatus = 200;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("DeepAgentModelProvider.complete", () => {
  it("整个协议：建线程 → 提交 run（system/history/user + org_skills）→ 轮询到终态 → 读最终 AI 消息", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["running", "running", "success"];
    stateResponse = {
      values: {
        messages: [
          { type: "human", content: "你好" },
          { type: "ai", content: "你好，我能帮你做什么？" },
        ],
      },
    };

    const result = await provider().complete({
      modelProvider: DEEP_AGENT_PROVIDER_NAME,
      modelId: "m1",
      system: "你是通用助手。技能A：画图。",
      user: "画一个流程图",
      history: [{ role: "user", content: "上一轮消息" }],
      skills: [{ versionId: "v1", stableName: "diagram-maker", name: "画图技能", content: "You draw diagrams." }],
    });

    expect(result.text).toBe("你好，我能帮你做什么？");
    expect(statusCallCount).toBeGreaterThanOrEqual(3); // 轮询循环真的被走过

    expect(capturedRunBodies).toHaveLength(1);
    const body = capturedRunBodies[0] as {
      assistant_id: string;
      input: { messages: { role: string; content: string }[] };
      config: { configurable: { org_skills: { stable_name: string; name: string; content: string }[] } };
    };
    expect(body.assistant_id).toBe("Deep Agent");
    expect(body.input.messages).toEqual([
      { role: "system", content: "你是通用助手。技能A：画图。" },
      { role: "user", content: "上一轮消息" },
      { role: "user", content: "画一个流程图" },
    ]);
    expect(body.config.configurable.org_skills).toEqual([
      { stable_name: "diagram-maker", name: "画图技能", content: "You draw diagrams." },
    ]);
  });

  it("run 状态转 error 时失败，不是悬挂或伪装成功", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["error"];

    await expect(provider().complete({
      modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u",
    })).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });
  });

  it("超过超时预算仍未到终态时失败", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["running"]; // 永远 running

    await expect(provider({ timeoutMs: 30, pollIntervalMs: 10 }).complete({
      modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u",
    })).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });
  });

  it("最终 state 里没有非空 AI 消息时失败，不是返回空字符串当成功", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["success"];
    stateResponse = { values: { messages: [{ type: "human", content: "你好" }] } };

    await expect(provider().complete({
      modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u",
    })).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });
  });

  it("baseUrl 未配置时拒绝，不悄悄用一个猜测的地址", async () => {
    const unconfigured = new DeepAgentModelProvider({ baseUrl: "", timeoutMs: 1000, pollIntervalMs: 10 });
    await expect(unconfigured.complete({
      modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u",
    })).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
  });

  it("pin 的 provider 不是 deep-agent 时拒绝，没有 fallback", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    await expect(provider().complete({
      modelProvider: "some-other-provider", modelId: "m1", system: "s", user: "u",
    })).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
  });

  it("空 system 不会发出一条空系统消息", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    await provider().complete({ modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "  ", user: "u" });
    const body = capturedRunBodies[0] as { input: { messages: { role: string }[] } };
    expect(body.input.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("未 pin skills 时 org_skills 是空数组，不是 undefined", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    await provider().complete({ modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" });
    const body = capturedRunBodies[0] as { config: { configurable: { org_skills: unknown[] } } };
    expect(body.config.configurable.org_skills).toEqual([]);
  });

  it("传输层错误不泄露 host/port 细节", async () => {
    const unreachable = new DeepAgentModelProvider({
      baseUrl: "http://127.0.0.1:1", timeoutMs: 1000, pollIntervalMs: 10,
    });
    let threw = false;
    try {
      await unreachable.complete({ modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" });
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(ModelCallError);
      expect((e as ModelCallError).detail).not.toContain("127.0.0.1");
    }
    expect(threw).toBe(true);
  });
});
