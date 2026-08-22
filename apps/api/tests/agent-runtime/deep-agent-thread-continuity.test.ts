/**
 * DA-04（#1749，rubric D4）反证套件：同一 Chat thread 的多轮调用必须复用同一个
 * 远端 LangGraph thread——checkpointer 的跨轮上下文只有 thread 稳定时才生效。
 *
 * 反证设计对应本仓两条纪律：
 * · 「静默降级是伪装的故障」：ensureThread 失败必须抛 MODEL_CALL_FAILED，
 *   不许退回每轮新 thread（那会把「续聊坏了」伪装成「记性差」）。
 * · 双轨：不传 threadId 的既有调用方行为与 DA-04 之前逐字相同（每轮新 thread）。
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
  deriveRemoteThreadId,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";

const FINAL = { values: { messages: [{ type: "ai", content: "ok", tool_calls: [] }] } };

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

interface Seen { threadPosts: { body: unknown }[]; runThreads: string[] }

function startFake(): Promise<{ baseUrl: string; seen: Seen }> {
  const seen: Seen = { threadPosts: [], runThreads: [] };
  server = createServer(async (req, res) => {
    const url = req.url ?? "";
    let raw = "";
    for await (const c of req) raw += c;
    if (req.method === "POST" && url === "/threads") {
      const body = raw === "" ? {} : JSON.parse(raw);
      seen.threadPosts.push({ body });
      res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ thread_id: body.thread_id ?? "fresh-server-id" }));
      return;
    }
    const runMatch = /^\/threads\/([^/]+)\/runs$/.exec(url);
    if (req.method === "POST" && runMatch) {
      seen.runThreads.push(runMatch[1]!);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ run_id: "r1" }));
      return;
    }
    if (req.method === "GET" && /\/runs\/r1$/.test(url)) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "success" }));
      return;
    }
    if (req.method === "GET" && /\/state$/.test(url)) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(FINAL));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      resolve({ baseUrl: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, seen });
    });
  });
}

const base = { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u", history: [], skills: [] };
const provider = (baseUrl: string) =>
  new DeepAgentModelProvider({ baseUrl, timeoutMs: 5000, pollIntervalMs: 5 });

describe("DA-04 线程连续性（rubric D4）", () => {
  it("同一 Chat thread 两轮 → 同一个远端 thread，且带 if_exists 幂等创建", async () => {
    const { baseUrl, seen } = await startFake();
    const p = provider(baseUrl);
    await p.complete({ ...base, threadId: "chat-t-1" } as never);
    await p.complete({ ...base, threadId: "chat-t-1" } as never);
    const expected = deriveRemoteThreadId("chat-t-1");
    expect(seen.runThreads).toEqual([expected, expected]);
    for (const post of seen.threadPosts) {
      expect(post.body).toEqual({ thread_id: expected, if_exists: "do_nothing" });
    }
  });

  it("不同 Chat thread → 不同远端 thread（决定性派生，无碰撞混线）", async () => {
    const { baseUrl, seen } = await startFake();
    const p = provider(baseUrl);
    await p.complete({ ...base, threadId: "chat-a" } as never);
    await p.complete({ ...base, threadId: "chat-b" } as never);
    expect(new Set(seen.runThreads).size).toBe(2);
  });

  it("不传 threadId（既有调用方）→ 每轮新 thread，POST 体为空对象——与 DA-04 之前逐字相同", async () => {
    const { baseUrl, seen } = await startFake();
    await provider(baseUrl).complete(base as never);
    expect(seen.threadPosts).toEqual([{ body: {} }]);
    expect(seen.runThreads).toEqual(["fresh-server-id"]);
  });

  it("ensureThread 失败 → 抛 MODEL_CALL_FAILED，不静默退回每轮新 thread", async () => {
    const { baseUrl } = await startFake();
    // 指到一个必然 404 的 baseUrl 前缀：/threads POST 打不中
    const bad = provider(`${baseUrl}/nope`);
    await expect(bad.complete({ ...base, threadId: "chat-t-1" } as never)).rejects.toMatchObject({
      code: "MODEL_CALL_FAILED",
    });
  });

  it("deriveRemoteThreadId：决定性 + RFC4122 形状", () => {
    expect(deriveRemoteThreadId("x")).toBe(deriveRemoteThreadId("x"));
    expect(deriveRemoteThreadId("x")).not.toBe(deriveRemoteThreadId("y"));
    expect(deriveRemoteThreadId("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// —— DA-06 附带的 api 侧反证：write_todos 参数的 JSON 完整性 ——
// （放本文件避免为 30 行再开一个测试进程；与线程连续性同属 provider 协议面。）
import { DeepAgentModelProvider as _P } from "../../src/infrastructure/agent-run/deep-agent-model-provider";

describe("DA-06 write_todos 参数完整性（rubric D1）", () => {
  it("超过 500 字符的 todos JSON 经 progress 事件后仍是完整合法 JSON；其他工具仍 500 截断", async () => {
    const todos = { todos: Array.from({ length: 12 }, (_, i) => ({
      content: `第 ${i} 步：一段足够长的描述文字用来把总长度顶过五百字符——${"填充".repeat(10)}`,
      status: "pending",
    })) };
    const argsJson = JSON.stringify(todos);
    expect(argsJson.length).toBeGreaterThan(500);
    const otherArgs = JSON.stringify({ text: "x".repeat(600) });

    const events: { toolName: string; toolArgsSummary: string | null }[] = [];
    const { baseUrl } = await (async () => {
      const seen = { threadPosts: [], runThreads: [] } as never;
      // 直接复用本文件的假上游骨架不够——state 要回带 tool_calls 的消息，就地起一个。
      const srv = createServer((req, res) => {
        const url = req.url ?? "";
        if (req.method === "POST" && url === "/threads") { res.writeHead(200).end(JSON.stringify({ thread_id: "t9" })); return; }
        if (req.method === "POST" && /\/runs$/.test(url)) { res.writeHead(200).end(JSON.stringify({ run_id: "r9" })); return; }
        if (req.method === "GET" && /\/runs\/r9$/.test(url)) { res.writeHead(200).end(JSON.stringify({ status: "success" })); return; }
        if (req.method === "GET" && /\/state$/.test(url)) {
          res.writeHead(200).end(JSON.stringify({ values: { messages: [
            { type: "ai", content: "", tool_calls: [
              { id: "c1", name: "write_todos", args: todos },
              { id: "c2", name: "call_skill", args: JSON.parse(otherArgs) },
            ] },
            { type: "tool", tool_call_id: "c1", content: "ok" },
            { type: "tool", tool_call_id: "c2", content: "ok" },
            { type: "ai", content: "done", tool_calls: [] },
          ] } }));
          return;
        }
        res.writeHead(404).end();
      });
      server = srv; // 复用 afterEach 清理
      return new Promise<{ baseUrl: string }>((resolve) => {
        srv.listen(0, "127.0.0.1", () => {
          const addr = srv.address();
          resolve({ baseUrl: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}` });
        });
      });
    })();

    const p = new _P({ baseUrl, timeoutMs: 5000, pollIntervalMs: 5 });
    await p.completeWithProgress(base as never, async (e) => {
      events.push({ toolName: e.toolName, toolArgsSummary: e.toolArgsSummary });
    });
    const todoEvent = events.find((e) => e.toolName === "write_todos");
    expect(todoEvent).toBeDefined();
    // 核心断言：完整、可 parse、逐字等于原始 JSON——前端规划条靠它活着。
    expect(todoEvent!.toolArgsSummary).toBe(argsJson);
    expect(() => JSON.parse(todoEvent!.toolArgsSummary!)).not.toThrow();
    // 反向：其他工具保持 500 截断纪律（尾带省略号，长度 501）。
    const other = events.find((e) => e.toolName === "call_skill");
    expect(other!.toolArgsSummary!.length).toBe(501);
    expect(other!.toolArgsSummary!.endsWith("…")).toBe(true);
  });
});
