/**
 * issue #3320 —— 用**真组件**渲出 `RunTracePanel` 的**折叠**态，供
 * `chat-trace-failure-forward-motion-geometry.spec.ts` 在真浏览器里判「可见 + 在动」。
 *
 * 剧本逐点复现人类在 devapp 上的那一屏（issue #3320 的两张截图）：
 *   t1 `edit_file` 失败（String not found）→ t2 `edit_file` 成功 → t3 `execute` **仍在飞**，
 *   run 的 status 仍是 `running`。
 *
 * ⚠ 两个刻意的选择，缺一这条门就测不到目标：
 * ① `expanded` 不传 ⇒ 走组件自己的默认值 `false`。人类的原话是「用户必须手动展开才发现还活着」，
 *    在展开态上量任何东西都答非所问。
 * ② `running={false}` ⇒ 模拟「本轮已吐过 `final_message`」的最坏相位。`task-timeline.tsx` 里
 *    `running = props.isRunning && !trace.some(e => e.kind === "final_message")`，长任务里正文
 *    早发完、工具还在跑时它就翻假——#3316 那条「静止的 spinner」的根因正是拿它当活性来源。
 *    活性条必须在这个相位下照样动：它取的是执行账本的 status 事实，不是这个 prop。
 *
 * 用法：node --import tsx e2e/fixtures/trace-forward-motion-fixture.tsx <输出 html 路径>
 */
import * as React from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

const base = { runId: "run-3320", emittedAt: "2026-09-10T00:00:00Z" };
const events: ExecutionEvent[] = [
  { ...base, seq: 1, kind: "status", status: "running" },
  { ...base, seq: 2, kind: "tool_start", toolCallId: "t1", toolName: "edit_file", args: { path: "gen-maau-pdf.js" } },
  { ...base, seq: 3, kind: "tool_end", toolCallId: "t1", toolName: "edit_file", result: "Error: String not found in file", ok: false },
  // ↓ 失败**之后**系统仍在推进：一件成功收尾、一件仍在飞。
  { ...base, seq: 4, kind: "tool_start", toolCallId: "t2", toolName: "edit_file", args: { path: "gen-maau-pdf.js" } },
  { ...base, seq: 5, kind: "tool_end", toolCallId: "t2", toolName: "edit_file", result: "ok", ok: true },
  { ...base, seq: 6, kind: "tool_start", toolCallId: "t3", toolName: "execute", args: { command: "cd /workspace && node gen-maau-pdf.js", timeout: "60" } },
];

const markup = renderToStaticMarkup(<RunTracePanel runId="run-3320" events={events} running={false} />);
writeFileSync(
  process.argv[2]!,
  `<html><head><link rel="stylesheet" href="out.css"></head><body class="bg-background">`
  + `<div style="width:760px">${markup}</div></body></html>`,
);
