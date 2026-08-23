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
  it("createRun 声明 stream_mode: [messages-tuple, updates]——不声明时 join 流只有 values 快照、零 token（2026-08-23 生产无流式的根因）", async () => {
    const baseUrl = await startFake({ streamStatus: 200, chunks: ["hi"], gapMs: 1 });
    seenRunBodies.length = 0;
    await provider(baseUrl, true).completeWithProgress(INPUT, async () => {}, async () => {});
    // D2（同一份 2026-08-23 重评，见 deep-agent-model-provider.ts createRun 里这个字段
    // 旁的注释）：不加 "updates" 时工具调用可见性只能靠轮询兜底，不是逐次事件驱动。
    expect(seenRunBodies[0]?.stream_mode).toEqual(["messages-tuple", "updates"]);
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

/**
 * D2（工具调用透明度，#1749 系列）的反证套件：`updates` stream_mode 里 "tools" 节点的
 * patch 真的被消费进 `agent_run_steps` 记账路径（onProgress → execute-run.ts 的
 * `record(...)`），不是解析了却没人用。
 *
 * 关键反证点：这条服务器**从不**在 messages-tuple chunk 上带 `tool_call_id`（与
 * 2026-08-23 对真实 `apps/deep-agent-service` 的实测证据一致——90 条 messages 事件
 * 0 条带这个字段，见 `deep-agent-model-provider.ts` `tryStreamRun` 头部注释）。若
 * `onProgress` 仍然在流式阶段（而不是等 `completeWithProgress` 末尾那次补读）被真的
 * 触发，只能是靠新增的 `updates`→"tools" 分支，不可能是旧的 tool_call_id 探测。
 */
describe("D2 工具调用透明度：updates 事件驱动 onProgress（不是解析了没人用）", () => {
  const TOOL_CALL_STATE = {
    values: {
      messages: [
        { type: "human", content: "画一个架构图" },
        {
          type: "ai", content: "先看看有哪些技能可用",
          tool_calls: [{ id: "call-1", name: "list_org_skills", args: {} }],
        },
        { type: "tool", tool_call_id: "call-1", content: "- diagram-maker：画图技能" },
        { type: "ai", content: "已完成，diagram-maker 可用。" },
      ],
    },
  };

  function startUpdatesFake(opts: {
    updatesFrames: readonly string[]; // raw JSON.stringify'd `data:` payloads, sent as `event: updates`
  }): Promise<{ baseUrl: string; stateReadCount: () => number }> {
    let stateReadCount = 0;
    server = createServer(async (req, res) => {
      const url = req.url ?? "";
      if (req.method === "POST" && url === "/threads") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ thread_id: "t1" }));
        return;
      }
      if (req.method === "POST" && url === "/threads/t1/runs") {
        for await (const _c of req) { /* drain */ }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ run_id: "r1" }));
        return;
      }
      if (req.method === "GET" && url === "/threads/t1/runs/r1/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        // 一条无 tool_call_id 的 messages-tuple chunk，与真实生产观测到的形状一致——
        // 这条本身不该触发任何 onProgress。
        res.write(`event: messages\ndata: [{"content":"","type":"AIMessageChunk"}, {}]\n\n`);
        for (const payload of opts.updatesFrames) {
          res.write(`event: updates\ndata: ${payload}\n\n`);
        }
        res.end();
        return;
      }
      if (req.method === "GET" && url === "/threads/t1/runs/r1") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "success" }));
        return;
      }
      if (req.method === "GET" && url === "/threads/t1/state") {
        stateReadCount += 1;
        res.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(TOOL_CALL_STATE));
        return;
      }
      res.writeHead(404).end();
    });
    return new Promise((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve({ baseUrl: `http://127.0.0.1:${port}`, stateReadCount: () => stateReadCount });
      });
    });
  }

  // #742 Gap 1: `TOOL_CALL_STATE` already has both the announcement and the result from the
  // very first read, so the very first `extractToolCallEvents` pass reports BOTH phases for
  // `call-1` in one go (in_progress then complete) -- every later read of the identical
  // state reports neither again (already in both emitted sets).
  const EXPECTED_EVENTS = [
    {
      toolName: "list_org_skills", toolArgsSummary: "{}",
      toolResultSummary: null, planningNote: "先看看有哪些技能可用",
      phase: "in_progress", toolCallId: "call-1",
    },
    {
      toolName: "list_org_skills", toolArgsSummary: "{}",
      toolResultSummary: "- diagram-maker：画图技能", planningNote: "先看看有哪些技能可用",
      phase: "complete", toolCallId: "call-1",
    },
  ];

  it("updates 事件带 tools 节点 patch 时，onProgress 真的被调用，且拿到正确的 tool_call 记账字段", async () => {
    const { baseUrl, stateReadCount } = await startUpdatesFake({
      updatesFrames: [
        JSON.stringify({
          tools: {
            messages: [{ type: "tool", tool_call_id: "call-1", name: "list_org_skills", content: "- diagram-maker：画图技能", status: "success" }],
          },
        }),
      ],
    });

    const events: unknown[] = [];
    const result = await provider(baseUrl, true).completeWithProgress(
      INPUT,
      async (event) => { events.push(event); },
      async () => {},
    );

    // 复用的正是 execute-run.ts `record(...)` 写 agent_run_steps 时读的同一份字段
    // （toolName/toolArgsSummary/toolResultSummary/planningNote）——证明 updates 事件
    // 真的映射进了既有记账路径，不是解析了没人用。
    expect(events).toEqual(EXPECTED_EVENTS);
    expect(result.text).toBe("已完成，diagram-maker 可用。");
    // 3 次 state 读 = updates 帧触发的那 1 次（流式阶段） + status 转 success 之后固定
    // 发生的 2 次（`emitNewToolEvents` 补读 + `readCompletion`，见下面"无关节点"用例的
    // 基线）。比基线多出的这 1 次，就是 updates 帧真的触发了额外读的直接证据。
    expect(stateReadCount()).toBe(3);
  }, 10_000);

  it("updates 帧里出现无关节点（非 tools）不触发任何 state 读，静默跳过而不是猜", async () => {
    const { baseUrl, stateReadCount } = await startUpdatesFake({
      updatesFrames: [
        JSON.stringify({ "PatchToolCallsMiddleware.before_agent": null }),
        JSON.stringify({ "SummarizationMiddleware.before_model": null }),
        JSON.stringify({ model: { messages: [] } }),
      ],
    });

    const events: unknown[] = [];
    const result = await provider(baseUrl, true).completeWithProgress(
      INPUT,
      async (event) => { events.push(event); },
      async () => {},
    );

    // 流式阶段没有任何一帧命中 "tools" 键，本该在流阶段触发 0 次 state 读；status 转
    // success 之后固定发生 2 次读（`emitNewToolEvents` 的补读 + `readCompletion` 读
    // 最终答案，与 updates 帧是否出现无关，见 provider 的 `completeWithProgress` 实现）
    // ——用这个数字而不是 0/1 来确认"流式阶段本身零额外读"，而不是巧合碰对。
    expect(events).toEqual(EXPECTED_EVENTS);
    expect(result.text).toBe("已完成，diagram-maker 可用。");
    expect(stateReadCount()).toBe(2);
  }, 10_000);
});
