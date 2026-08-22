/**
 * DA-03（#1749，rubric D3）的反证套件：deep-agent 通路的 token 级真流式。
 *
 * 判据来自 rubric v2：「事件时间戳证明逐步」——所以本文件不只断言 delta 内容与顺序，
 * 还断言**到达时刻是分散的**（假服务在片段之间真实 sleep，收集侧记录单调钟），
 * 终态一次性打包冒充流式（基线 agui-bridge 的形状，rubric 反伪造条款点名）在这条
 * 断言下必然露馅：所有 delta 会挤在同一毫秒邻域。
 *
 * 回退（S1=B 双轨）同样有反证：/stream 返回 404 时必须走轮询拿到同样的终稿，
 * onDelta 一次都不 fire——新通路故障不得比旧世界更糟，也不得伪造流式。
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";

const FINAL_MESSAGES = [
  { type: "human", content: "hi" },
  { type: "ai", content: "Hello world", tool_calls: [] },
];

let server: Server | undefined;
const seenRunBodies: { stream_mode?: unknown }[] = [];
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

function startFake(opts: { streamStatus: number; chunks: readonly string[]; gapMs: number }): Promise<string> {
  server = createServer(async (req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/threads") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ thread_id: "t1" }));
      return;
    }
    if (req.method === "POST" && url === "/threads/t1/runs") {
      let raw = "";
      for await (const c of req) raw += c;
      seenRunBodies.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ run_id: "r1" }));
      return;
    }
    if (req.method === "GET" && url === "/threads/t1/runs/r1/stream") {
      if (opts.streamStatus !== 200) {
        res.writeHead(opts.streamStatus).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const c of opts.chunks) {
        res.write(`event: messages\ndata: [{"content": ${JSON.stringify(c)}, "type": "AIMessageChunk"}, {}]\n\n`);
        await new Promise((r) => setTimeout(r, opts.gapMs));
      }
      res.end();
      return;
    }
    if (req.method === "GET" && url === "/threads/t1/runs/r1") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "success" }));
      return;
    }
    if (req.method === "GET" && url === "/threads/t1/state") {
      res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ values: { messages: FINAL_MESSAGES } }));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`);
    });
  });
}

function provider(baseUrl: string, streamEnabled: boolean): DeepAgentModelProvider {
  return new DeepAgentModelProvider({ baseUrl, timeoutMs: 10_000, pollIntervalMs: 10, streamEnabled });
}

const INPUT = {
  modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u",
  history: [], skills: [],
} as never;

describe("DA-03 真流式（rubric D3）", () => {
  it("createRun 声明 stream_mode: [messages-tuple]——不声明时 join 流只有 values 快照、零 token（2026-08-23 生产无流式的根因）", async () => {
    const baseUrl = await startFake({ streamStatus: 200, chunks: ["hi"], gapMs: 1 });
    seenRunBodies.length = 0;
    await provider(baseUrl, true).completeWithProgress(INPUT, async () => {}, async () => {});
    expect(seenRunBodies[0]?.stream_mode).toEqual(["messages-tuple"]);
  });

  it("delta 按序逐个到达，且到达时刻分散——终态打包冒充流式在这条断言下必然露馅", async () => {
    const baseUrl = await startFake({ streamStatus: 200, chunks: ["He", "llo ", "world"], gapMs: 25 });
    const arrivals: { delta: string; at: number }[] = [];
    const result = await provider(baseUrl, true).completeWithProgress(
      INPUT,
      async () => {},
      async (delta) => void arrivals.push({ delta, at: performance.now() }),
    );
    expect(arrivals.map((a) => a.delta)).toEqual(["He", "llo ", "world"]);
    // 三个片段间隔 2×25ms：首尾到达时间差必须体现真实间隔（留余量断 >=30ms）。
    expect(arrivals[2]!.at - arrivals[0]!.at).toBeGreaterThanOrEqual(30);
    expect(result.text).toBe("Hello world");
  });

  it("回退（S1=B）：/stream 404 时走轮询拿到同样终稿，onDelta 一次都不 fire", async () => {
    const baseUrl = await startFake({ streamStatus: 404, chunks: [], gapMs: 0 });
    const deltas: string[] = [];
    const result = await provider(baseUrl, true).completeWithProgress(
      INPUT,
      async () => {},
      async (d) => void deltas.push(d),
    );
    expect(deltas).toEqual([]);
    expect(result.text).toBe("Hello world");
  });

  it("开关关闭时不碰 /stream 端点——行为与 DA-03 之前逐字相同", async () => {
    const baseUrl = await startFake({ streamStatus: 500, chunks: [], gapMs: 0 });
    const deltas: string[] = [];
    const result = await provider(baseUrl, false).completeWithProgress(
      INPUT,
      async () => {},
      async (d) => void deltas.push(d),
    );
    expect(deltas).toEqual([]);
    expect(result.text).toBe("Hello world");
  });

  it("不传 onDelta 时（既有调用方）流路不启用，轮询照旧", async () => {
    const baseUrl = await startFake({ streamStatus: 500, chunks: [], gapMs: 0 });
    const result = await provider(baseUrl, true).completeWithProgress(INPUT, async () => {});
    expect(result.text).toBe("Hello world");
  });
});
