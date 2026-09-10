/**
 * issue #3316 ① —— 用**真组件**渲出 `RunTracePanel` 在「run 还活着、某一步还没收到
 * tool_end」这一刻的 DOM，供 `chat-trace-liveness-motion.spec.ts` 在真浏览器里判断
 * 折叠行那枚状态图标**是不是真的在转**。
 *
 * ## 夹具为什么长这样（这就是人类在 devapp 上撞见的那一刻）
 * 事实来自两条独立的线：
 *   · 执行账本（`events`）说这轮 run 的最后一条 status 是 `running`，且 `t2` 只有
 *     `tool_start` 没有 `tool_end` —— 折叠行因此显示「正在执行 · 历时 …」。
 *   · React 侧的 `running` prop **没有传**（默认 false）。这不是臆造的组合：面板挂在
 *     本轮**第一条** assistant 消息上（`resolveTraceAnchors` 取 `anchors[runId]` 的第一条），
 *     而 `props.isRunning` 是 CopilotKit **逐条消息**的标志，只有正在流式的那条为真。
 *     长任务里正文早已发完、工具还在跑，锚点那条消息的 `isRunning` 就是 false。
 *
 * 两条线一分叉，同一件事实「这轮还活着」就有了两个互相矛盾的答案——正是本仓
 * AGENTS.md 明令禁止的「同一事实声明在两处」。
 *
 * 用法：node --import tsx e2e/fixtures/trace-liveness-fixture.tsx <输出 html 路径>
 */
import * as React from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

const base = { runId: "run-1", emittedAt: "2026-09-07T00:00:00Z" };
const events: ExecutionEvent[] = [
  { ...base, seq: 0, kind: "status", status: "running" },
  { ...base, seq: 1, kind: "tool_start", toolCallId: "t1", toolName: "run_script", args: { script: "build.py" } },
  { ...base, seq: 2, kind: "tool_end", toolCallId: "t1", toolName: "run_script", result: "ok", ok: true },
  { ...base, seq: 3, kind: "tool_start", toolCallId: "t2", toolName: "bash", args: { command: "python make_pptx.py" } },
];

const markup = renderToStaticMarkup(
  // `running` 刻意不传 —— 见文件头。
  <RunTracePanel runId="run-1" events={events} expanded onExpandedChange={() => {}} />,
);
writeFileSync(
  process.argv[2]!,
  `<html><head><link rel="stylesheet" href="out.css"></head><body class="bg-background"><div style="width:760px">${markup}</div></body></html>`,
);
