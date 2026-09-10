import { afterEach, it, expect, vi } from "vitest";
import { DeepAgentModelProvider } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import type { ModelCallProgressEvent } from "../../src/application/agent-run/ports";
import { createToolProgressWriter } from "../../src/application/agent-run/skill-activity-writer";
import type { ExecutionEventInput } from "@repo/contracts/execution-journal";
import { toOrgId } from "../../src/domain/org-id";

/**
 * issue #3322 —— 一次工具调用**执行期间**必须能产出中间进展。
 *
 * ## 判据为什么落在**顺序**上，不落在"回调被调用过"上
 *
 * 用户实测的缺陷形状是：pptx 跑了 03:54，`tool_start` 与 `tool_end` 之间**什么都没有**。
 * 断言"`onToolProgress` 被调用过一次"在这个缺陷下**无法被证伪**——一个直接调回调的
 * 替身能让它永远绿。所以这里断言的是三件事的**相对位置**：进展必须落在这次工具调用的
 * 开始之后、结束之前。跑真正的 `DeepAgentModelProvider`（真 SSE 分帧、真 `updates` /
 * `custom` 解析、真状态重读），只把 HTTP 字节换成替身——那正是"我们不控制"的那一层。
 */
afterEach(() => vi.unstubAllGlobals());

const AI_TOOL_CALL = { type: "ai", id: "m1", content: "", tool_calls: [{ id: "call-1", name: "call_skill", args: { skill_stable_name: "deck-maker" } }] };
const TOOL_RESULT = { type: "tool", id: "m2", tool_call_id: "call-1", content: "生成好了", status: "success" };

function progressFrame(message: string): string {
  return `event: custom\ndata: ${JSON.stringify({ type: "tool_progress", version: 1, toolCallId: "call-1", toolName: "call_skill", message })}\n\n`;
}

function stubKernel(body: string) {
  let stateReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/stream")) return new Response(body, { headers: { "content-type": "text/event-stream" } });
    if (init?.method === "POST" && url.endsWith("/runs")) return Response.json({ run_id: "remote" });
    if (url.endsWith("/state")) {
      stateReads++;
      /*
       * 状态按**时间**推进，不是一个常量：第 1 次读发生在 `startRun` 里（那时这一轮
       * 还什么都没发生）；第 2 次是宣告工具调用那一帧触发的重读——工具**还没有结果**，
       * 这正是那段真空开始的时刻；之后才有结果。
       *
       * ⚠ 若让状态从头就带着 `TOOL_RESULT`，`tool_start` 与 `tool_end` 会在同一次重读里
       * 一起发出来，中间不存在任何时间——那样这支测试就**测不到**它要测的那段真空了。
       */
      const messages = stateReads <= 1 ? []
        : stateReads === 2 ? [AI_TOOL_CALL]
          : [AI_TOOL_CALL, TOOL_RESULT, { type: "ai", id: "final", content: "done" }];
      return Response.json({ values: { messages } });
    }
    if (url.endsWith("/runs/remote")) return Response.json({ status: "success" });
    return Response.json({ thread_id: "thread", status: "idle" });
  }));
}

/** 一次工具调用的时间线，按事件到达顺序记下来。 */
async function runTimeline(): Promise<string[]> {
  const timeline: string[] = [];
  const provider = new DeepAgentModelProvider({ baseUrl: "http://kernel.invalid", streamEnabled: false, timeoutMs: 2000, pollIntervalMs: 1 });
  await provider.completeWithProgress(
    {
      modelProvider: "deep-agent", modelId: "test", system: "", user: "做个 deck", threadId: "thread",
      onToolProgress: async (progress) => { timeline.push(`progress:${progress.message}`); },
    },
    async (event: ModelCallProgressEvent) => { timeline.push(`${event.phase === "in_progress" ? "start" : "end"}:${event.toolName}`); },
  );
  return timeline;
}

it("delivers intra-tool progress between the tool's start and its end", async () => {
  stubKernel(
    `event: updates\ndata: ${JSON.stringify({ agent: { messages: [AI_TOOL_CALL] } })}\n\n`
    + progressFrame("技能「PPT 生成」已开始生成…")
    + progressFrame("技能「PPT 生成」正在生成…已产出 1240 字")
    + `event: updates\ndata: ${JSON.stringify({ tools: { messages: [TOOL_RESULT] } })}\n\n`,
  );

  const timeline = await runTimeline();

  const start = timeline.indexOf("start:call_skill");
  const end = timeline.indexOf("end:call_skill");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const between = timeline.slice(start + 1, end);
  // 这一行就是 #3322：改之前 `between` 恒为空数组。
  expect(between).toEqual([
    "progress:技能「PPT 生成」已开始生成…",
    "progress:技能「PPT 生成」正在生成…已产出 1240 字",
  ]);
});

it("keeps a malformed progress frame from failing a run that is otherwise succeeding", async () => {
  stubKernel(
    `event: updates\ndata: ${JSON.stringify({ agent: { messages: [AI_TOOL_CALL] } })}\n\n`
    + `event: custom\ndata: ${JSON.stringify({ type: "tool_progress", version: 1, toolCallId: "call-1" })}\n\n`
    + progressFrame("形状不合法的那条被丢掉了，这条还要到")
    + `event: updates\ndata: ${JSON.stringify({ tools: { messages: [TOOL_RESULT] } })}\n\n`,
  );

  const timeline = await runTimeline();

  expect(timeline.filter((row) => row.startsWith("progress:"))).toEqual(["progress:形状不合法的那条被丢掉了，这条还要到"]);
  expect(timeline).toContain("end:call_skill");
});

it("writes progress under the same tool-call identity the ledger uses for tool_start", async () => {
  const written: ExecutionEventInput[] = [];
  const write = createToolProgressWriter(
    { appendExecutionEvent: async (_org, _run, event) => { written.push(event); } },
    toOrgId("00000000-0000-0000-0000-000000000001"), "run-1", "attempt-7", () => {},
  );

  await write({ type: "tool_progress", version: 1, toolCallId: "call-1", toolName: "call_skill", message: "正在生成…" });

  // `execute-run.ts` 写 tool_start 用的是 `${attemptId}:${providerToolCallId}`。进展要挂在
  // 同一行工具下，就必须逐字同构——否则前端按 key 找不到那行，进展落在一个孤儿上。
  expect(written).toEqual([{
    kind: "tool_progress", attemptId: "attempt-7", toolCallId: "attempt-7:call-1",
    sourceToolCallId: "call-1", toolName: "call_skill", message: "正在生成…",
  }]);
});

it("never fails the run when the journal write itself fails", async () => {
  const logged: string[] = [];
  const write = createToolProgressWriter(
    { appendExecutionEvent: async () => { throw new Error("db down"); } },
    toOrgId("00000000-0000-0000-0000-000000000001"), "run-1", "attempt-7",
    (message, fields) => { logged.push(`${message}:${String(fields.code)}`); },
  );

  await expect(write({ type: "tool_progress", version: 1, toolCallId: "c", toolName: "call_skill", message: "m" })).resolves.toBeUndefined();
  // 不抛，但也不静默——结构化 log 带错误码。
  expect(logged).toEqual(["tool progress append failed:TOOL_PROGRESS_APPEND_FAILED"]);
});
