/**
 * 2026-09-22 —— 长任务产出正文之前的「最近几步」预览，挂在**折叠区之外**。
 *
 * 取证起点（人类实测截图）：一次深度研究历时 05:20、已完成 17 步、「有失败步骤」，而
 * **整屏除了那一行折叠标题什么都没有**——17 步全在 `hidden` 里，失败那一步不展开就到不了。
 *
 * ⚠ 第一版我改的是「默认展开」，被 `fullstack-smoke` 按设计拦下：
 * `chat-trace-failure-forward-motion-geometry.spec.ts` 的前提逐字写着「若哪天默认改成展开，
 * 本条门的前提就变了，必须在这里红出来」。全仓另有五条 e2e 断言 `aria-expanded === "false"`。
 * 那个默认值是反复确认过的产品选择，所以改成走这个组件本来就有的先例：**要让人看见的东西
 * 挂到折叠区外面**（活性条与后台任务面板都是这么做的）。展开与否一个字没改。
 */
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import { RUN_TRACE_LIVE_PREVIEW_LIMIT } from "@/components/chat/workbench/run-trace-live-preview";

const base = { runId: "run-preview", emittedAt: "2026-09-22T00:00:00Z" };
const status = (seq: number, s: "running" | "succeeded"): ExecutionEvent => ({ ...base, seq, kind: "status", status: s });
const start = (seq: number, id: string, tool = "search_documents"): ExecutionEvent =>
  ({ ...base, seq, kind: "tool_start", toolCallId: id, toolName: tool, args: { query: "资料" } });
const end = (seq: number, id: string, ok = true, tool = "search_documents"): ExecutionEvent =>
  ({ ...base, seq, kind: "tool_end", toolCallId: id, toolName: tool, result: "ok", ok });

/** 两个已收尾 + 一个在飞：与截图同形状（还在跑、没有正文、动作不止一个）。 */
const busy: ExecutionEvent[] = [
  status(1, "running"),
  start(2, "a"), end(3, "a"),
  start(4, "b", "edit_file"), end(5, "b", false, "edit_file"),
  start(6, "c", "execute"),
];
afterEach(cleanup);

it("还在跑、还没有正文：折叠态下也能看到最近几步，且失败那一步就在里面", () => {
  render(<RunTracePanel runId="run-preview" events={busy} />);
  // 折叠区照旧是关的——本改动不碰展开语义
  expect(screen.getByTestId("run-trace-body")).toHaveAttribute("hidden");
  const preview = screen.getByTestId("run-trace-live-preview");
  const rows = screen.getAllByTestId("run-trace-live-preview-row");
  expect(rows.length).toBeLessThanOrEqual(RUN_TRACE_LIVE_PREVIEW_LIMIT);
  // 失败的那一步不展开就看得见——截图里「有失败步骤」四个字之外什么都没有
  expect(rows.some((row) => row.getAttribute("data-status") === "failed")).toBe(true);
  expect(preview).toHaveAttribute("data-total", "3");
});

it("动作多于预览条数时说清楚「上面只是最近几步」", () => {
  render(<RunTracePanel runId="run-preview" events={[...busy, start(7, "d"), end(8, "d")]} />);
  expect(screen.getByTestId("run-trace-live-preview-more").textContent).toContain("全部 4 个动作");
});

it("正文一出现就消失——不跟正文抢位置", () => {
  const delta: ExecutionEvent = { ...base, seq: 7, kind: "text_delta", messageId: "m1", delta: "正在" };
  render(<RunTracePanel runId="run-preview" events={[...busy, delta]} />);
  expect(screen.queryByTestId("run-trace-live-preview")).toBeNull();
});

it("run 结束后不留下它——历史记录只由折叠区承载", () => {
  render(<RunTracePanel runId="run-preview" events={[...busy, status(7, "succeeded")]} />);
  expect(screen.queryByTestId("run-trace-live-preview")).toBeNull();
});

it("只有 1 个动作时不出现——折叠行那一句已经把它说完了", () => {
  render(<RunTracePanel runId="run-preview" events={[status(1, "running"), start(2, "a"), end(3, "a")]} />);
  expect(screen.queryByTestId("run-trace-live-preview")).toBeNull();
});

it("用户展开之后不再重复摆一遍——完整轨迹已经在屏幕上", () => {
  render(<RunTracePanel runId="run-preview" events={busy} />);
  expect(screen.getByTestId("run-trace-live-preview")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("run-trace-toggle"));
  expect(screen.getByTestId("run-trace-body")).not.toHaveAttribute("hidden");
  expect(screen.queryByTestId("run-trace-live-preview")).toBeNull();
});
