/**
 * F212（`agent-interrupts` 契约束）—— `ARGS_MAX_CHARS` 豁免（`domain.md` 缺口 AI-3）。
 *
 * 待批工具（HITL）的 args 要被前端 `JSON.parse`（渲染卡片、edit 决策改参数再提交），
 * 不是给人读的摘要。`fill_run_params` 多字段 + 依据文案、`choose_execution_option`
 * 2-3 张选项卡三项对照，都大概率超过默认 500 字符截断档，截断会把它切成非法 JSON。
 * 同 `deep-agent-hitl.ts` 的 `call_skill` 一样的坑（issue #2017），本测试验证
 * `DeepAgentModelProvider` 对三个新工具名同样给了 4000 字符的豁免，且 delta 是合法 JSON。
 *
 * 沿用 `tests/agent-runtime/deep-agent-model-provider.test.ts` 的确定性 loopback
 * HTTP server 套路：不 mock fetch，起一个真实 HTTP server 实现四个端点形状。
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";

let server: Server;
let base = "";
let threadId = "";
let runId = "";
let statusSequence: string[] = ["success"];
let statusCallCount = 0;
let stateSequence: unknown[] | null = null;
let stateCallCount = 0;

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startServer(): Promise<void> {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/threads") return respond(res, 200, { thread_id: threadId });
    if (req.method === "POST" && url === `/threads/${threadId}/runs`) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => respond(res, 200, { run_id: runId }));
      return;
    }
    if (req.method === "GET" && url === `/threads/${threadId}/runs/${runId}`) {
      const status = statusSequence[Math.min(statusCallCount, statusSequence.length - 1)];
      statusCallCount += 1;
      return respond(res, 200, { status });
    }
    if (req.method === "GET" && url === `/threads/${threadId}/state`) {
      const body = (stateSequence ?? [])[Math.min(stateCallCount, (stateSequence ?? []).length - 1)];
      stateCallCount += 1;
      return respond(res, 200, body);
    }
    respond(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
}

function provider(): DeepAgentModelProvider {
  return new DeepAgentModelProvider({ baseUrl: base, timeoutMs: 5_000, pollIntervalMs: 10 });
}

beforeAll(async () => { await startServer(); });
afterEach(() => {
  threadId = `thread-${randomUUID()}`;
  runId = `run-${randomUUID()}`;
  statusSequence = ["success"];
  statusCallCount = 0;
  stateSequence = null;
  stateCallCount = 0;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

/** 200 个 ParamField 撑出一个必超 500 字符、但远小于 4000 字符的长 args，逼近真实 fill_params 表单体量。 */
function longFillParamsArgs(): Record<string, unknown> {
  const fields = Array.from({ length: 12 }, (_, i) => ({
    name: `field_${i}`,
    label: `字段 ${i}`,
    aiGuess: `AI 猜测值示例内容 ${i}`,
    rationale: `这是字段 ${i} 的猜测依据说明文案，足够长以撑起总体积超过默认的 500 字符截断档`,
    required: true,
    currentValue: null,
  }));
  return { requestId: "req-1", fields };
}

describe("F212 ARGS_MAX_CHARS 豁免 —— 三个新 HITL 工具的 args 不被默认 500 字符截断", () => {
  for (const [label, toolName] of Object.entries(AGENT_INTERRUPTS_TOOL_NAMES)) {
    it(`${label}（${toolName}）的长 args 完整保留、可被 JSON.parse`, async () => {
      threadId = `thread-${randomUUID()}`;
      runId = `run-${randomUUID()}`;
      statusSequence = ["success"];
      const longArgs = longFillParamsArgs();
      const rawJson = JSON.stringify(longArgs);
      // 确保这份 fixture 真的超过默认截断档，否则这条测试不构成反证。
      expect(rawJson.length).toBeGreaterThan(500);

      stateSequence = [
        {
          values: {
            messages: [
              {
                type: "ai",
                content: "",
                tool_calls: [{ id: "call-1", name: toolName, args: longArgs }],
              },
              { type: "tool", tool_call_id: "call-1", content: "已记录" },
              { type: "ai", content: "已处理完毕。" },
            ],
          },
        },
      ];

      const events: { toolName: string; toolArgsSummary: string | null }[] = [];
      await provider().completeWithProgress(
        { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" },
        async (event) => { events.push(event); },
      );

      const announced = events.find((e) => e.toolName === toolName);
      expect(announced?.toolArgsSummary, "该工具的 in_progress 事件缺失").toBeDefined();
      // 没被截断：尾部没有省略号，且整段是合法 JSON。
      expect(announced?.toolArgsSummary?.endsWith("…")).toBe(false);
      expect(() => JSON.parse(announced?.toolArgsSummary ?? "")).not.toThrow();
      expect(JSON.parse(announced?.toolArgsSummary ?? "")).toEqual(longArgs);
    });
  }
});
