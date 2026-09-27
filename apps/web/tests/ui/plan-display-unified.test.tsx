/**
 * 2026-09-27 人类：「现在有三个地方显示计划，是否多余的。chat 正文，session 的下方，还有右边的
 * panel，都有这个计划。怎么进一步统一和改进体验？」→ 「计划显示统一按你的方案做吧」。
 *
 * 实测的两类问题：
 *   · 数据各读各的：消息流读执行过程里最后一次 write_todos，底部读账本——同屏一度「计划 0/3」
 *     对「3/3 步已完成」。
 *   · 同一份列表同屏出现多次；「当前步骤：X  0/5 步已完成」被读成「这一步完成了 0/5」。
 *
 * 钉住的分工：进行中时消息流的计划卡读底部那份账本；底部展开时消息流让位；结束后消息流留本轮
 * 快照；右栏讲每一步做过的动作；进度卡说「第 i 步 · 共 N 步」。每条都有配对的正面用例。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import type { PlanLedgerView } from "@/lib/plan-control-api";

afterEach(cleanup);
const api = vi.hoisted(() => ({ fetchPlanLedger: vi.fn() }));
vi.mock("@/lib/plan-control-api", () => api);

import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import { ChatTaskInspector } from "@/components/chat/chat-task-inspector";
import { LivePlanContext, type LivePlan } from "@/lib/chat-workbench/live-plan-context";
import { actionsByPlanStep } from "@/lib/chat-workbench/trace-plan";
import { traceEntries } from "@/lib/chat-workbench/run-trace";
import { PlanRunProgress } from "@/components/plan-control/plan-run-progress";
import { deriveRunStatusView } from "@repo/contracts/plan-control";

const base = { runId: "run-1", emittedAt: "2026-09-27T00:00:00Z" };
let seq = 0;
const todos = (statuses: string[]) => ({ todos: ["研究设计思维历史", "整理 PPT 大纲", "生成 PPT"].map((content, i) => ({ content, status: statuses[i] })) });
const writeTodos = (statuses: string[]): ExecutionEvent[] => {
  const id = `w${++seq}`;
  return [
    { ...base, seq: ++seq, kind: "tool_start", toolCallId: id, toolName: "write_todos", args: todos(statuses) },
    { ...base, seq: ++seq, kind: "tool_end", toolCallId: id, toolName: "write_todos", ok: true, result: "" },
  ] as ExecutionEvent[];
};
const tool = (name: string, args: unknown): ExecutionEvent[] => {
  const id = `t${++seq}`;
  return [
    { ...base, seq: ++seq, kind: "tool_start", toolCallId: id, toolName: name, args },
    { ...base, seq: ++seq, kind: "tool_end", toolCallId: id, toolName: name, ok: true, result: "ok" },
  ] as ExecutionEvent[];
};
const status = (s: "running" | "succeeded"): ExecutionEvent => ({ ...base, seq: ++seq, kind: "status", status: s } as ExecutionEvent);

/** 执行过程里停在「计划 0/3」——正是人类截图里消息流那份陈旧计划。 */
const staleTraceEvents = (): ExecutionEvent[] => [status("running"), ...writeTodos(["pending", "pending", "pending"]), ...tool("web_search", { query: "design thinking" })];
const LEDGER_TODOS: LivePlan["todos"] = [
  { content: "研究设计思维历史", status: "completed" },
  { content: "整理 PPT 大纲", status: "completed" },
  { content: "生成 PPT", status: "in_progress" },
];

function renderTrace(events: ExecutionEvent[], live: LivePlan) {
  return render(<LivePlanContext.Provider value={live}><RunTracePanel runId="run-1" events={events} running /></LivePlanContext.Provider>);
}

describe("① 消息流里的计划卡", () => {
  it("进行中：读底部那份账本，不再显示执行过程里的陈旧 0/3", () => {
    renderTrace(staleTraceEvents(), { todos: LEDGER_TODOS, expanded: false });
    const card = screen.getByTestId("agent-plan-panel");
    expect(card).toHaveAttribute("data-plan-done", "2");
    expect(card.textContent).toContain("计划 2/3");
  });

  it("进行中且底部已展开：消息流让位，同屏只有一份完整列表", () => {
    renderTrace(staleTraceEvents(), { todos: LEDGER_TODOS, expanded: true });
    expect(screen.queryByTestId("run-trace-plan")).toBeNull();
  });

  it("配对：本轮结束后留本轮自己的计划快照（即使底部展开着也留，那是历史记录）", () => {
    const events = [...staleTraceEvents(), ...writeTodos(["completed", "completed", "completed"]), status("succeeded")];
    renderTrace(events, { todos: LEDGER_TODOS, expanded: true });
    expect(screen.getByTestId("agent-plan-panel")).toHaveAttribute("data-plan-done", "3");
  });

  it("配对：没有底部面板的宿主（默认上下文）照旧用执行过程里的计划", () => {
    render(<RunTracePanel runId="run-1" events={staleTraceEvents()} running />);
    expect(screen.getByTestId("agent-plan-panel")).toHaveAttribute("data-plan-done", "0");
  });
});

describe("③ 右栏「进度」页签：每一步做过的动作", () => {
  const events = (): ExecutionEvent[] => [
    status("running"),
    ...tool("read_file", { path: "/skills/pptx-create/SKILL.md" }), // 计划开始前：不归任何一步
    ...writeTodos(["in_progress", "pending", "pending"]),
    ...tool("web_search", { query: "design thinking history" }),
    ...tool("fetch_url", { url: "https://example.com/dubberly" }),
    ...writeTodos(["completed", "in_progress", "pending"]),
    ...tool("write_file", { file_path: "/workspace/outline.md" }),
  ];

  it("动作归属于它发生时正在进行的那一步；计划开始前的动作不编归属", () => {
    const map = actionsByPlanStep(traceEntries(events()));
    expect(map.get("研究设计思维历史")?.map((a) => a.tool)).toEqual(["web_search", "fetch_url"]);
    expect(map.get("整理 PPT 大纲")?.map((a) => a.tool)).toEqual(["write_file"]);
    expect(map.has("生成 PPT")).toBe(false);
    expect([...map.values()].flat().some((a) => a.tool === "read_file")).toBe(false);
  });

  it("页签里每一步下面列出它的动作；没有动作的步骤不画占位", async () => {
    api.fetchPlanLedger.mockResolvedValue({
      revision: 2, engineEpoch: 1, origin: "engine", stepsAreProposal: false, pendingPermissionRequestId: null,
      steps: [
        { planStepId: "s1", content: "研究设计思维历史", status: "completed", constraints: [] },
        { planStepId: "s2", content: "整理 PPT 大纲", status: "in_progress", constraints: [] },
        { planStepId: "s3", content: "生成 PPT", status: "pending", constraints: [] },
      ],
      orphanedConstraints: [], phase: "executing", gate: { required: true, reason: "multi-step" },
      progress: { completed: 1, total: 3, elapsedMs: 1000 }, pendingApplyAtNextRun: false,
      runStatus: "running", activeRunId: "run-1", pausedAt: null, pauseRequestedAt: null, cancelRequestedAt: null,
      errorCode: null, failedStepId: null,
    } as unknown as PlanLedgerView);
    render(<ChatTaskInspector hasSelection threadId="t-1" artifacts={null} materials={null} loading={false}
      artifactsError={null} materialsError={null} onRetry={() => {}} pendingMaterialsCount={0} isRunning
      runPhaseLabel={null} runStartedAt={null} planTodos={null} planStepActions={actionsByPlanStep(traceEntries(events()))} />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-expand"));
    await waitFor(() => expect(screen.getAllByTestId("chat-task-workbench-plan-step")).toHaveLength(3));
    const [research, outline, build] = screen.getAllByTestId("chat-task-workbench-plan-step");
    expect(within(research!).getAllByTestId("chat-task-workbench-plan-step-action")).toHaveLength(2);
    expect(within(outline!).getAllByTestId("chat-task-workbench-plan-step-action")).toHaveLength(1);
    expect(within(build!).queryByTestId("chat-task-workbench-plan-step-actions")).toBeNull();
  });
});

describe("② 进度卡的措辞", () => {
  const view = (completed: number, statuses: ("completed" | "in_progress" | "pending")[]) => deriveRunStatusView({
    phase: "executing", runStatus: "running", stepStatuses: statuses, progressCompleted: completed,
    progressTotal: statuses.length, paused: false, pauseRequested: false, gateRequired: true,
    hasRecentError: false, pauseEntryEnabled: false,
  });

  it("有当前步骤时说「第 i 步 · 共 N 步」，不再是容易看错的「0/5 步已完成」", () => {
    render(<PlanRunProgress view={view(0, ["in_progress", "pending", "pending", "pending", "pending"])} currentStepLabel="研究" elapsedMs={1000} isPaused={false} />);
    const text = screen.getByTestId("chat-task-workbench-run-progress").textContent ?? "";
    expect(text).toContain("第 1 步 · 共 5 步");
    expect(text).not.toContain("0/5 步已完成");
  });

  it("配对：没有当前步骤（收尾）时才说完成了几步", () => {
    render(<PlanRunProgress view={view(3, ["completed", "completed", "completed"])} currentStepLabel={null} elapsedMs={1000} isPaused={false} />);
    expect(screen.getByTestId("chat-task-workbench-run-progress").textContent).toContain("已完成 3/3 步");
  });
});
