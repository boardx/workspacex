/**
 * 2026-09-22 —— 正文还没出来、run 还在跑时，执行轨迹**默认展开**。
 *
 * ## 取证起点（人类实测截图）
 *
 * 一次深度研究：折叠行写着「正在推进任务 · 已完成 17 步 · 有失败步骤 · 历时 05:20 ·
 * 工具 17 次 · 技能活动 25 项」，而**整屏除了这一行什么都没有**——正文一个字都还没产生，
 * 已经发生的 17 步全在 `hidden` 区块里。用户能看到的只有一行字和一只蝴蝶，而且那一行里
 * 「有失败步骤」还告诉他出过错、却没有任何可达的地方看那是哪一步。
 *
 * 这正是 #3320 自己诊断出的主机制 (b)「渲染了但默认折叠且无活性信号」。当时只补了折叠行
 * 里的活性文案——在**有正文**的普通对话里够用，在一次五分钟零正文的长任务里撑不起一屏。
 *
 * ## 判据边界（三条都在下面单独断言）
 *   · 还活着 + 无 final_message ⇒ 默认展开
 *   · 已结束（历史记录）⇒ 默认折叠，否则整个会话会被撑开
 *   · 正文已出现（有 final_message）⇒ 默认折叠，屏幕上已经有东西可读
 *   · 只有 1 个动作 ⇒ 默认折叠（既有默认，`run-trace-panel.test.tsx` 钉着）：折叠行已经
 *     把这一条说完了，展开层里没有折叠行说不出的东西
 * 并且这只是**默认值**：用户显式收起之后必须保持收起。
 */
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

const base = { runId: "run-blank", emittedAt: "2026-09-22T00:00:00Z" };
const status = (seq: number, s: "running" | "succeeded"): ExecutionEvent => ({ ...base, seq, kind: "status", status: s });
const start = (seq: number, id: string): ExecutionEvent => ({ ...base, seq, kind: "tool_start", toolCallId: id, toolName: "edit_file", args: {} });
const end = (seq: number, id: string, ok = true): ExecutionEvent => ({ ...base, seq, kind: "tool_end", toolCallId: id, toolName: "edit_file", result: "", ok });
const final = (seq: number): ExecutionEvent => ({ ...base, seq, kind: "final_message", messageId: "m1" });

const busyNoText = [status(1, "running"), start(2, "t1"), end(3, "t1"), start(4, "t2"), end(5, "t2")];
afterEach(cleanup);

/** 展开区块用 `hidden` 控制，所以「有没有展开」判它的 hidden 属性，不判 class。 */
const bodyHidden = (): boolean => screen.getByTestId("run-trace-body").hasAttribute("hidden");

it("run 在跑且还没有正文：默认展开，17 步不再藏在 hidden 里", () => {
  render(<RunTracePanel runId="run-blank" events={busyNoText} />);
  expect(bodyHidden(), "正文还没出来时把已经发生的步骤藏起来，屏幕上就只剩一行字").toBe(false);
  expect(screen.getAllByTestId("run-trace-entry").length).toBeGreaterThan(0);
});

it("run 已结束：默认折叠——历史记录不该把整个会话撑开", () => {
  render(<RunTracePanel runId="run-blank" events={[...busyNoText, status(4, "succeeded")]} />);
  expect(bodyHidden()).toBe(true);
});

it("正文已经出来了：默认折叠——屏幕上已经有东西可读", () => {
  render(<RunTracePanel runId="run-blank" events={[...busyNoText, final(4)]} />);
  expect(bodyHidden()).toBe(true);
});

it("这只是默认值：用户显式收起之后保持收起", () => {
  render(<RunTracePanel runId="run-blank" events={busyNoText} />);
  expect(bodyHidden()).toBe(false);
  fireEvent.click(screen.getByTestId("run-trace-toggle"));
  expect(bodyHidden(), "用户的选择必须压过默认值").toBe(true);
});

it("受控用法下调用方说什么就是什么（默认值只在未选过时生效）", () => {
  // 调用方显式传 false ⇒ 即使「在跑且无正文」也保持折叠：`task-timeline` 用这条通道
  // 记住用户在这条 run 上的选择。传 `undefined` 才是「没选过」。
  render(<RunTracePanel runId="run-blank" events={busyNoText} expanded={false} />);
  expect(bodyHidden()).toBe(true);
  cleanup();
  render(<RunTracePanel runId="run-blank" events={busyNoText} expanded={undefined} />);
  expect(bodyHidden()).toBe(false);
});

it("只有 1 个动作时仍然默认折叠——折叠行已经把它说完了", () => {
  // 门槛不是拍的数字，是「折叠行的信息容量」：1 条时折叠行说得完，≥2 条时它只说得出最后一条。
  // 这条同时保住既有默认（`run-trace-panel.test.tsx`「collapses even one tool by default」）。
  render(<RunTracePanel runId="run-blank" events={[status(1, "running"), start(2, "t1")]} />);
  expect(bodyHidden()).toBe(true);
});

it("正文只流到一半（有 text_delta、还没有 final_message）：默认折叠", () => {
  /*
   * 只判 `final_message` 是不够的：正文流到一半时它还没来，而屏幕上已经有字在长出来。
   * 这条反证钉住「两种正文事件都算」——去掉 `text_delta` 那一半就会在这里红。
   */
  const delta: ExecutionEvent = { ...base, seq: 6, kind: "text_delta", messageId: "m1", delta: "正在" };
  render(<RunTracePanel runId="run-blank" events={[...busyNoText, delta]} />);
  expect(bodyHidden()).toBe(true);
});
