/**
 * issue #3100 D6 —— 多步剧本里 `spawn_async_task` 的**线格式**取证。
 *
 * ## 为什么这个文件必须存在
 *
 * TW-P0-7③（`chat-task-workbench-tool-events.spec.ts:93`，「子 Agent 可折叠树」）恒红的
 * 第一道闸不在前端：`apps/api/scripts/loopback-deep-agent-provider.ts` 这个 deep-agent
 * 确定性替身**全文零次**出现 `spawn_async_task`——剧本里压根没有这个事件类型，于是
 * `RunTracePanel` 的 `hasSubtasks` 永远为假、`SubtaskRunLivePanel` 永远不挂载、
 * `subtask_runs` 表永远没有行。补上剧本之后，本仓「替身的方言 ≠ 上游的方言」那条纪律
 * （CRLF 事故）要求：替身发出的字节必须对**真实上游**取证，不能只对着自己的假设写。
 *
 * 真实上游 = `apps/deep-agent-service/src/deep_agent_service/tools.py::spawn_async_task`：
 *   - POST `<subtask_callback_base_url>/internal/subtask-runs`
 *   - header `x-deep-agent-internal-key`（key 为空串时**不带**这个头）
 *   - body `{orgId, parentRunId, description, context, idempotencyKey}`，
 *     `idempotencyKey` = 这次调用的 `tool_call_id`
 *   - 返回串 `子任务已派发（subtaskRunId=…），正在后台异步执行，…`
 *   - 四个 configurable 键任一缺席 ⇒ 「无法派发异步子任务：…」，**不假装成功**
 * 下面每条断言都逐字对着这份清单。
 */
import { describe, expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

const TRIGGER = "multistep";
/** `deep-agent-model-provider.ts::subtaskConfig()` 写进 `configurable` 的那四个键。 */
const CALLBACK = {
  subtask_callback_base_url: "http://127.0.0.1:4001",
  subtask_callback_key: "internal-key-not-a-secret",
  org_id: "org-3100",
  parent_run_id: "run-parent-3100",
};

interface Seen { url: string; method?: string; headers?: Record<string, string>; body: unknown }

function recordingFetch(seen: Seen[], respond: () => { status: number; body: unknown }) {
  return (async (url: unknown, init: unknown) => {
    const options = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
    seen.push({
      url: String(url),
      method: options.method,
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.parse(options.body),
    });
    const { status, body } = respond();
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
}

/** 剧本的终稿落在第 8 个半步；`/state` 按 `statusPolls` 分阶段揭示。 */
async function pollTo(request: ReturnType<typeof fixture>, thread: string, times: number) {
  for (let i = 0; i < times; i += 1) await request("GET", `/threads/${thread}/runs/${thread}`);
}
const toolMessage = (state: any, callId: string) =>
  state.values.messages.find((m: any) => m.type === "tool" && m.tool_call_id === callId);
const spawnCall = (state: any) =>
  state.values.messages.flatMap((m: any) => m.tool_calls ?? []).find((c: any) => c.name === "spawn_async_task");

describe("loopback deep-agent 替身 · spawn_async_task 的线格式（issue #3100 D6）", () => {
  it("配好回调通路时：按 tools.py 的字节形状真的 POST 一次，并把 TS 侧回的 id 原样写进 ToolMessage", async () => {
    const seen: Seen[] = [];
    const request = fixture({ LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER: TRIGGER },
      recordingFetch(seen, () => ({ status: 200, body: { subtaskRunId: "sub-7", status: "pending" } })));
    await request("POST", "/threads", { thread_id: "t" });
    await request("POST", "/threads/t/runs", {
      input: { messages: [{ role: "user", content: TRIGGER }] },
      config: { configurable: CALLBACK },
    });

    // ① 请求字节 —— 逐条对着 tools.py 的 `httpx.post(...)`。
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://127.0.0.1:4001/internal/subtask-runs");
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.headers?.["content-type"]).toBe("application/json");
    expect(seen[0]!.headers?.["x-deep-agent-internal-key"]).toBe(CALLBACK.subtask_callback_key);
    expect(Object.keys(seen[0]!.body as object).sort())
      .toEqual(["context", "description", "idempotencyKey", "orgId", "parentRunId"]);
    expect(seen[0]!.body).toMatchObject({ orgId: CALLBACK.org_id, parentRunId: CALLBACK.parent_run_id });
    const sentDescription = (seen[0]!.body as { description: string }).description;
    expect(sentDescription.length).toBeGreaterThan(0);

    // ② `idempotencyKey` 必须**就是**这次调用的 tool_call_id（真实工具用的是
    //    `InjectedToolCallId`）——两者分叉会让重试语义静默失效。
    await pollTo(request, "t", 8);
    const state = await request("GET", "/threads/t/state");
    const call = spawnCall(state);
    expect(call).toBeDefined();
    expect((seen[0]!.body as { idempotencyKey: string }).idempotencyKey).toBe(call.id);

    // ③ args 形状 = 真实工具签名（description 必填、context 可选），且与真的发出去的一致。
    expect(call.args.description).toBe(sentDescription);
    expect(call.args.context).toBe((seen[0]!.body as { context: string }).context);

    // ④ ToolMessage 正文 = 真实工具的成功返回串，id 是 TS 侧回的那一个，不是编的。
    expect(toolMessage(state, call.id).content)
      .toBe("子任务已派发（subtaskRunId=sub-7），正在后台异步执行，不需要等待它完成，请继续处理对话的其它部分。");

    // ⑤ 剧本没被这一步顶掉：终稿仍然揭示。
    expect(state.values.messages[state.values.messages.length - 1].content).toContain("多步依赖链已完整执行");
  });

  it("没配回调通路时：一个请求都不发，ToolMessage 如实说派发失败，不编 subtaskRunId", async () => {
    // 不注入 fetch —— 真发了请求就会以 ReferenceError 露馅，而不是悄悄通过。
    const request = fixture({ LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER: TRIGGER });
    await request("POST", "/threads", { thread_id: "t" });
    await request("POST", "/threads/t/runs", { input: { messages: [{ role: "user", content: TRIGGER }] } });
    await pollTo(request, "t", 8);
    const state = await request("GET", "/threads/t/state");
    const call = spawnCall(state);
    expect(call).toBeDefined();
    const content: string = toolMessage(state, call.id).content;
    expect(content).toContain("无法派发异步子任务");
    expect(content).not.toContain("subtaskRunId=");
  });

  it("TS 侧拒绝入队（401 fail-closed）时：不假装成功，回派发失败那句话", async () => {
    const seen: Seen[] = [];
    const request = fixture({ LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER: TRIGGER },
      recordingFetch(seen, () => ({ status: 401, body: { message: "subtask_callback_unauthorized" } })));
    await request("POST", "/threads", { thread_id: "t" });
    await request("POST", "/threads/t/runs", {
      input: { messages: [{ role: "user", content: TRIGGER }] },
      config: { configurable: CALLBACK },
    });
    await pollTo(request, "t", 8);
    const state = await request("GET", "/threads/t/state");
    const content: string = toolMessage(state, spawnCall(state).id).content;
    expect(seen).toHaveLength(1);
    expect(content).toContain("派发子任务失败");
    expect(content).not.toContain("subtaskRunId=");
  });

  it("key 为空串时不带鉴权头 —— 与 tools.py 的 `if callback[\"key\"] != \"\"` 同一判据", async () => {
    const seen: Seen[] = [];
    const request = fixture({ LOOPBACK_DEEP_AGENT_MULTISTEP_TRIGGER: TRIGGER },
      recordingFetch(seen, () => ({ status: 200, body: { subtaskRunId: "sub-8" } })));
    await request("POST", "/threads", { thread_id: "t" });
    await request("POST", "/threads/t/runs", {
      input: { messages: [{ role: "user", content: TRIGGER }] },
      config: { configurable: { ...CALLBACK, subtask_callback_key: "" } },
    });
    expect(seen[0]!.headers).not.toHaveProperty("x-deep-agent-internal-key");
  });
});
