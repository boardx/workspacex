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
/** #783 -- when set, `/state` returns the entry at index `min(stateCallCount, len-1)`
 * instead of the static `stateResponse`, simulating a run whose `values.messages` grows
 * across successive polls while `running`. */
let stateSequence: unknown[] | null = null;
let stateCallCount = 0;

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
      if (stateSequence !== null) {
        const body = stateSequence[Math.min(stateCallCount, stateSequence.length - 1)];
        stateCallCount += 1;
        return respond(res, 200, body);
      }
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
  stateSequence = null;
  stateCallCount = 0;
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

describe("DeepAgentModelProvider.completeWithProgress (#783, #742 Gap 1 in_progress)", () => {
  it("每次调用宣布时先报一个 in_progress，结果到达时再报一个 complete，两者共享 toolCallId，按序、终态答案不变", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["running", "running", "success"];
    stateSequence = [
      // poll #1: run just announced it will call list_org_skills, no result yet.
      {
        values: {
          messages: [
            { type: "human", content: "画一个架构图" },
            {
              type: "ai", content: "我先看看有哪些技能可用",
              tool_calls: [{ id: "call-1", name: "list_org_skills", args: {} }],
            },
          ],
        },
      },
      // poll #2: that call's result landed, AND a second call was announced.
      {
        values: {
          messages: [
            { type: "human", content: "画一个架构图" },
            {
              type: "ai", content: "我先看看有哪些技能可用",
              tool_calls: [{ id: "call-1", name: "list_org_skills", args: {} }],
            },
            { type: "tool", tool_call_id: "call-1", content: "- diagram-maker：画图技能" },
            {
              type: "ai", content: "调用画图技能",
              tool_calls: [{ id: "call-2", name: "call_skill", args: { skill_stable_name: "diagram-maker", task: "画架构图" } }],
            },
          ],
        },
      },
      // poll #3 (terminal): the second call's result landed too.
      {
        values: {
          messages: [
            { type: "human", content: "画一个架构图" },
            { type: "ai", content: "我先看看有哪些技能可用", tool_calls: [{ id: "call-1", name: "list_org_skills", args: {} }] },
            { type: "tool", tool_call_id: "call-1", content: "- diagram-maker：画图技能" },
            { type: "ai", content: "调用画图技能", tool_calls: [{ id: "call-2", name: "call_skill", args: { skill_stable_name: "diagram-maker", task: "画架构图" } }] },
            { type: "tool", tool_call_id: "call-2", content: "已生成架构图。" },
            { type: "ai", content: "已经帮你画好架构图了。" },
          ],
        },
      },
    ];

    const events: unknown[] = [];
    const result = await provider().completeWithProgress(
      { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" },
      async (event) => { events.push(event); },
    );

    expect(result.text).toBe("已经帮你画好架构图了。");
    expect(events).toEqual([
      {
        toolName: "list_org_skills", toolArgsSummary: "{}",
        toolResultSummary: null, planningNote: "我先看看有哪些技能可用",
        phase: "in_progress", toolCallId: "call-1",
      },
      {
        toolName: "list_org_skills", toolArgsSummary: "{}",
        toolResultSummary: "- diagram-maker：画图技能", planningNote: "我先看看有哪些技能可用",
        phase: "complete", toolCallId: "call-1",
      },
      {
        toolName: "call_skill", toolArgsSummary: '{"skill_stable_name":"diagram-maker","task":"画架构图"}',
        toolResultSummary: null, planningNote: "调用画图技能",
        phase: "in_progress", toolCallId: "call-2",
      },
      {
        toolName: "call_skill", toolArgsSummary: '{"skill_stable_name":"diagram-maker","task":"画架构图"}',
        toolResultSummary: "已生成架构图。", planningNote: "调用画图技能",
        phase: "complete", toolCallId: "call-2",
      },
    ]);
  });

  it("一个宣布了但从未收到结果的调用只报一次 in_progress，不会伪造一个 complete", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["success"];
    stateSequence = [
      {
        values: {
          messages: [
            { type: "ai", content: "", tool_calls: [{ id: "call-orphan", name: "call_skill", args: {} }] },
            { type: "ai", content: "算了，直接回答你。" },
          ],
        },
      },
    ];

    const events: unknown[] = [];
    const result = await provider().completeWithProgress(
      { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" },
      async (event) => { events.push(event); },
    );

    expect(events).toEqual([
      {
        toolName: "call_skill", toolArgsSummary: "{}", toolResultSummary: null,
        planningNote: null, phase: "in_progress", toolCallId: "call-orphan",
      },
    ]);
    expect(result.text).toBe("算了，直接回答你。");
  });

  it("同一个事件不会因为跨多次轮询重复读到而被上报两次（in_progress 与 complete 各自恰好一次）", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["running", "running", "success"];
    const completedPairState = {
      values: {
        messages: [
          { type: "ai", content: "", tool_calls: [{ id: "call-1", name: "call_skill", args: {} }] },
          { type: "tool", tool_call_id: "call-1", content: "结果" },
          { type: "ai", content: "完成了。" },
        ],
      },
    };
    // The SAME completed pair is visible on every poll from the first one onward -- a
    // provider whose state read simply lags status by one poll would still hit this.
    stateSequence = [completedPairState, completedPairState, completedPairState];

    const events: unknown[] = [];
    await provider().completeWithProgress(
      { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" },
      async (event) => { events.push(event); },
    );

    // The first poll already sees BOTH halves at once (announcement and answer in the same
    // read), so it reports in_progress THEN complete in that one poll -- exactly 2 events,
    // never re-reported on the two later polls that see the identical state again.
    expect(events).toHaveLength(2);
    expect((events as { phase: string }[]).map((e) => e.phase)).toEqual(["in_progress", "complete"]);
  });

  it("run 转 error 之前已经完成的调用仍然被上报（补读一次，不因为终态而丢失）", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["error"];
    stateSequence = [
      {
        values: {
          messages: [
            { type: "ai", content: "", tool_calls: [{ id: "call-1", name: "call_skill", args: {} }] },
            { type: "tool", tool_call_id: "call-1", content: "部分结果" },
          ],
        },
      },
    ];

    const events: unknown[] = [];
    await expect(provider().completeWithProgress(
      { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" },
      async (event) => { events.push(event); },
    )).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });

    expect(events).toHaveLength(2);
    expect((events[0] as { phase: string }).phase).toBe("in_progress");
    expect((events[1] as { toolResultSummary: string; phase: string }).toolResultSummary).toBe("部分结果");
    expect((events[1] as { toolResultSummary: string; phase: string }).phase).toBe("complete");
  });

  it("onProgress 拒绝会让整个调用失败，不是被吞掉——不是 best effort", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["success"];
    stateSequence = [
      {
        values: {
          messages: [
            { type: "ai", content: "", tool_calls: [{ id: "call-1", name: "call_skill", args: {} }] },
            { type: "tool", tool_call_id: "call-1", content: "结果" },
            { type: "ai", content: "完成了。" },
          ],
        },
      },
    ];

    await expect(provider().completeWithProgress(
      { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" },
      async () => { throw new Error("run store append failed"); },
    )).rejects.toThrow("run store append failed");
  });

  // DA-16 -- write_todos's toolArgsSummary sources real `state.values.todos`, not a
  // re-serialization of the call's own args (see `realTodosSummary`'s own doc).
  it("write_todos 完成时 toolArgsSummary 取自真实 values.todos（账本 ground truth），与工具调用参数本身不同也不受影响", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["success"];
    stateSequence = [
      {
        values: {
          messages: [
            {
              type: "ai", content: "",
              // The call's OWN args ask for only two todos, both pending.
              tool_calls: [{ id: "call-1", name: "write_todos", args: { todos: [{ content: "画架构图", status: "pending" }] } }],
            },
            { type: "tool", tool_call_id: "call-1", content: "已更新 todo 列表" },
            { type: "ai", content: "计划已更新。" },
          ],
          // But the REAL post-write state has a different (ground-truth) snapshot -- e.g.
          // TodoListMiddleware already advanced a prior item to completed in this same
          // write. If the event's toolArgsSummary still echoed the args above, a client
          // would render a stale/wrong plan.
          todos: [
            { content: "分析需求", status: "completed" },
            { content: "画架构图", status: "in_progress" },
          ],
        },
      },
    ];

    const events: { toolName: string; toolArgsSummary: string | null; phase?: string }[] = [];
    await provider().completeWithProgress(
      { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" },
      async (event) => { events.push(event); },
    );

    const complete = events.find((e) => e.phase === "complete");
    expect(complete?.toolArgsSummary).toBe(JSON.stringify({
      todos: [
        { content: "分析需求", status: "completed" },
        { content: "画架构图", status: "in_progress" },
      ],
    }));
    // The in_progress event (announced before the tool result exists, hence before
    // `values.todos` could reflect it) is untouched -- ground truth only overrides the
    // COMPLETED event, never a still-pending announcement.
    const inProgress = events.find((e) => e.phase === "in_progress");
    expect(inProgress?.toolArgsSummary).toBe('{"todos":[{"content":"画架构图","status":"pending"}]}');
  });

  it("values.todos 缺失或校验不过时，write_todos 的 toolArgsSummary 回落到调用参数本身，不是零值也不是崩溃", async () => {
    threadId = `thread-${randomUUID()}`;
    runId = `run-${randomUUID()}`;
    statusSequence = ["success"];
    stateSequence = [
      {
        values: {
          messages: [
            {
              type: "ai", content: "",
              tool_calls: [{ id: "call-1", name: "write_todos", args: { todos: [{ content: "画架构图", status: "pending" }] } }],
            },
            { type: "tool", tool_call_id: "call-1", content: "已更新 todo 列表" },
            { type: "ai", content: "计划已更新。" },
          ],
          // Real state present but fails `AguiTodosSnapshot` validation (empty content) --
          // `realTodosSummary` must return null, not a fabricated/empty snapshot.
          todos: [{ content: "", status: "pending" }],
        },
      },
    ];

    const events: { toolName: string; toolArgsSummary: string | null; phase?: string }[] = [];
    await provider().completeWithProgress(
      { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "m1", system: "s", user: "u" },
      async (event) => { events.push(event); },
    );

    const complete = events.find((e) => e.phase === "complete");
    expect(complete?.toolArgsSummary).toBe('{"todos":[{"content":"画架构图","status":"pending"}]}');
  });
});
