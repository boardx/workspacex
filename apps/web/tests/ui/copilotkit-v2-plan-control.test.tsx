/**
 * 本 PR —— 钉住 `CopilotKitV2PlanControl` 真的把 `plan-control-api.ts` 的读写函数接进了
 * `copilotkit-v2-panel.tsx` 的渲染树：`threadId` 非空时轮询 `fetchPlanLedger`，六态
 * 指示器/计划面板/确认门渲染真实账本数据（不是 mock/占位），点击调序/删步/加约束/
 * 撤约束/确认/暂停/恢复/重试真的调用对应的 `plan-control-api.ts` 函数并带上正确参数
 * （不是靠用户在输入框打字模拟）。
 *
 * `plan-control-api.ts` 整体 mock 掉——本文件只钉「组件把哪个函数、用什么参数调了」，
 * 不重复验证 HTTP 往返本身（那已经被 `apps/api/tests/plan-control/http-endpoints-wired.test.ts`
 * 真实网络覆盖）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { PlanLedgerView } from "@/lib/plan-control-api";

afterEach(cleanup);

const api = vi.hoisted(() => ({
  fetchPlanLedger: vi.fn(),
  reorderPlanStep: vi.fn(),
  deletePlanStep: vi.fn(),
  addPlanConstraint: vi.fn(),
  removePlanConstraint: vi.fn(),
  confirmPlan: vi.fn(),
  confirmProposedPlan: vi.fn(),
  pausePlanRun: vi.fn(),
  resumePlanRun: vi.fn(),
  retryPlanStep: vi.fn(),
  planControlErrorCode: vi.fn((): string | null => null),
}));

vi.mock("@/lib/plan-control-api", () => api);

import { CopilotKitV2PlanControl } from "@/components/chat/copilotkit-v2-plan-control";
const PLAN_PHASE_INDICATOR_TESTID = "chat-task-workbench-plan-summary";
import { PLAN_PANEL_TESTID, PLAN_STEP_TESTID } from "@/components/plan-control/plan-panel-readonly";
import { PLAN_STEP_DELETE_TESTID, PLAN_STEP_REORDER_TESTID } from "@/components/plan-control/plan-panel-edit";
import { PLAN_CONFIRM_RUN_TESTID } from "@/components/plan-control/plan-confirm-gate";
import { PLAN_RUN_PAUSE_TESTID, PLAN_RUN_RESUME_TESTID } from "@/components/plan-control/plan-run-progress";
import { PLAN_CONTROL_EDIT_TOGGLE_TESTID, PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID } from "@/components/chat/copilotkit-v2-plan-control";

function ledgerWithSteps(overrides: Partial<PlanLedgerView> = {}): PlanLedgerView {
  return {
    cancelRequestedAt: null,
    pausedAt: null,
    pauseRequestedAt: null,
    revision: 3,
    engineEpoch: 1,
    origin: "engine",
    stepsAreProposal: false,
    pendingPermissionRequestId: null,
    steps: [
      { planStepId: "s1", content: "调研竞品定价", status: "pending", constraints: [] },
      { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
    ],
    orphanedConstraints: [],
    phase: "planning",
    gate: { required: true, reason: "multi-step" },
    progress: { completed: 0, total: 2, elapsedMs: 0 },
    pendingApplyAtNextRun: false,
    // issue #3099 —— 运行级控制只看这个字段（`deriveRunControls`），不看 `phase`。
    // 夹具默认 `idle`（没有在跑的 run），需要"能暂停/能恢复"的用例各自显式声明。
    runStatus: "idle",
    activeRunId: null,
    errorCode: null,
    failedStepId: null,
    ...overrides,
  };
}

describe("CopilotKitV2PlanControl —— 真实读账本 + 真实调用写操作", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.planControlErrorCode.mockReturnValue(null);
  });

  /**
   * issue #3132（B7）—— 人类裁决 O-2 的机械门控：确认门上的「确认并执行」在
   * **提案态**下必须**恢复停住的那条 run**（`confirmProposedPlan` →
   * `decidePermissionRequest`），而不是 `confirmPlan`（`createConfirmedRun`，
   * 会**多起一条 run**）。两条路径都存在、都是对的，走错就是多一条 run。
   *
   * 撤掉 `handleConfirm` 里的 `stepsAreProposal` 分支 ⇒ 第一条红（调了 confirmPlan）。
   */
  const proposalLedger = () => ledgerWithSteps({
    phase: "planning",
    runStatus: "running",
    revision: 0,
    stepsAreProposal: true,
    activeRunId: "run-stopped",
    pendingPermissionRequestId: "9f1d2c3b-4a5e-4f6a-8b7c-0d1e2f3a4b5c",
    gate: { required: true, reason: "multi-step" },
  });

  it("提案态点确认 ⇒ 恢复停住的那条 run，绝不新起一条（裁决 O-2）", async () => {
    api.fetchPlanLedger.mockResolvedValue(proposalLedger());
    api.confirmProposedPlan.mockResolvedValue({ runId: "run-stopped", permissionRequestId: "9f1d2c3b-4a5e-4f6a-8b7c-0d1e2f3a4b5c" });
    render(<CopilotKitV2PlanControl threadId="t-proposal" />);
    fireEvent.click(await screen.findByTestId(PLAN_CONFIRM_RUN_TESTID));
    await waitFor(() => expect(api.confirmProposedPlan).toHaveBeenCalledWith(
      "run-stopped", "9f1d2c3b-4a5e-4f6a-8b7c-0d1e2f3a4b5c",
    ));
    expect(api.confirmPlan).not.toHaveBeenCalled();
  });

  it("提案态渲染「提案」标记 —— 与已生效账本视觉可区分（设计 ① 的硬要求）", async () => {
    api.fetchPlanLedger.mockResolvedValue(proposalLedger());
    render(<CopilotKitV2PlanControl threadId="t-proposal-badge" />);
    expect(await screen.findByTestId("chat-task-workbench-plan-proposal-badge")).toBeTruthy();
  });

  it("非提案态（账本里已有计划）点确认 ⇒ 仍走既有 confirmPlan，语义逐字不变", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({
      phase: "planning", runStatus: "idle", stepsAreProposal: false,
      gate: { required: true, reason: "multi-step" },
    }));
    api.confirmPlan.mockResolvedValue({ runId: "run-new" });
    render(<CopilotKitV2PlanControl threadId="t-ledger" projectId="p1" />);
    fireEvent.click(await screen.findByTestId(PLAN_CONFIRM_RUN_TESTID));
    await waitFor(() => expect(api.confirmPlan).toHaveBeenCalledWith("t-ledger", { basedOnRevision: 3 }, "p1"));
    expect(api.confirmProposedPlan).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-task-workbench-plan-proposal-badge")).toBeNull();
  });

  it("提案态但缺 permissionRequestId ⇒ 报错，绝不悄悄回退到新起一条 run", async () => {
    api.fetchPlanLedger.mockResolvedValue(proposalLedger());
    api.fetchPlanLedger.mockResolvedValue({ ...proposalLedger(), pendingPermissionRequestId: null });
    render(<CopilotKitV2PlanControl threadId="t-missing-id" />);
    fireEvent.click(await screen.findByTestId(PLAN_CONFIRM_RUN_TESTID));
    await waitFor(() => expect(api.confirmPlan).not.toHaveBeenCalled());
    expect(api.confirmProposedPlan).not.toHaveBeenCalled();
  });

  it("threadId 为 null（新对话尚未发出第一条消息）时不渲染，也不发起任何请求", () => {
    render(<CopilotKitV2PlanControl threadId={null} />);
    expect(screen.queryByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeNull();
    expect(api.fetchPlanLedger).not.toHaveBeenCalled();
  });

  it("没有计划步骤的暂停任务仍可通过既有 checkpoint 接口继续", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({ steps: [], phase: "preparing", runStatus: "interrupted", pausedAt: "2026-09-07T00:00:00Z" }));
    api.resumePlanRun.mockResolvedValue({ runId: "run-paused" });
    render(<CopilotKitV2PlanControl threadId="t-paused" projectId="project-a" />);
    fireEvent.click(await screen.findByTestId(PLAN_RUN_RESUME_TESTID));
    await waitFor(() => expect(api.resumePlanRun).toHaveBeenCalledWith("t-paused", "project-a"));
    expect(screen.queryByText(/当前步骤/)).toBeNull();
  });

  it("无步骤暂停任务的只读访问者不能继续", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({ steps: [], phase: "preparing", runStatus: "interrupted", pausedAt: "2026-09-07T00:00:00Z" }));
    render(<CopilotKitV2PlanControl threadId="t-paused" canWrite={false} />);
    expect((await screen.findByTestId(PLAN_RUN_RESUME_TESTID)) as HTMLButtonElement).toHaveProperty("disabled", true);
    expect(api.resumePlanRun).not.toHaveBeenCalled();
  });

  it("phase='preparing'（零计划，I-1 正常态）时不渲染面板——不是错误态，是本来就没有可展示的计划", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({ steps: [], phase: "preparing", gate: { required: false, reason: "no-plan" } }),
    );
    render(<CopilotKitV2PlanControl threadId="t-1" />);
    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalledWith("t-1", undefined));
    expect(screen.queryByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeNull();
  });

  it("有真实计划时渲染进度摘要 + 只读面板 + 确认门（gate.required=true）", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    render(<CopilotKitV2PlanControl threadId="t-2" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeTruthy());
    expect(screen.getByTestId(PLAN_PANEL_TESTID).getAttribute("data-plan-mode")).toBe("read");
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)).toHaveLength(2);
    expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy();
  });

  it("点击「确认并执行」真的调用 confirmPlan(threadId, {basedOnRevision: 当前 revision})", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    api.confirmPlan.mockResolvedValue({ revision: 3, runId: "run-1", deliveredPlanDigest: "x", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-3" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy());
    fireEvent.click(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID));

    await waitFor(() => expect(api.confirmPlan).toHaveBeenCalledWith("t-3", { basedOnRevision: 3 }, undefined));
  });

  it("点击「编辑计划」切到编辑态，拖拽把手键盘调序真的调用 reorderPlanStep 带正确 planStepId/toIndex/basedOnRevision", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    api.reorderPlanStep.mockResolvedValue({ revision: 4, appliedTo: "ledger-and-engine", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-4" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID)).toBeTruthy());
    fireEvent.click(screen.getByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID));

    const handles = await screen.findAllByTestId(PLAN_STEP_REORDER_TESTID);
    expect(handles).toHaveLength(2);
    // Alt+↓ 把第一步移到第二位（PlanPanelEdit 的既有键盘等价，TW-A11Y-8）。
    fireEvent.keyDown(handles[0]!, { key: "ArrowDown", altKey: true });

    await waitFor(() =>
      expect(api.reorderPlanStep).toHaveBeenCalledWith("t-4", { basedOnRevision: 3, planStepId: "s1", toIndex: 1 }, undefined),
    );
  });

  it("编辑态点击「移除」真的调用 deletePlanStep 带正确 planStepId", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    api.deletePlanStep.mockResolvedValue({
      revision: 4, appliedTo: "ledger-and-engine", orphanedConstraintIds: [], auditEventId: "a",
    });
    render(<CopilotKitV2PlanControl threadId="t-5" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID)).toBeTruthy());
    fireEvent.click(screen.getByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID));

    const deleteButtons = await screen.findAllByTestId(PLAN_STEP_DELETE_TESTID);
    fireEvent.click(deleteButtons[0]!);

    await waitFor(() =>
      expect(api.deletePlanStep).toHaveBeenCalledWith("t-5", { basedOnRevision: 3, planStepId: "s1" }, undefined),
    );
  });

  it("phase='executing' 渲染执行进度条，点击「暂停」真的调用 pausePlanRun", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "executing", runStatus: "running", activeRunId: "run-1",
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "in_progress", constraints: [] },
        ],
        progress: { completed: 1, total: 2, elapsedMs: 5000 },
      }),
    );
    api.pausePlanRun.mockResolvedValue({ runId: "run-1", pausedAtStepId: "s2", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-6" />);
    fireEvent.click(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID));

    const pauseBtn = await screen.findByTestId("chat-task-workbench-run-pause");
    fireEvent.click(pauseBtn);
    await waitFor(() => expect(api.pausePlanRun).toHaveBeenCalledWith("t-6", undefined));
  });

  it("phase='failed' 渲染失败恢复，点击「重试该步」真的调用 retryPlanStep 带服务端算出的 failedStepId", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "failed",
        failedStepId: "s2",
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
        ],
      }),
    );
    api.retryPlanStep.mockResolvedValue({ runId: "run-2", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-7" />);

    const retryBtn = await screen.findByTestId("chat-task-workbench-failure-retry-step");
    fireEvent.click(retryBtn);
    await waitFor(() => expect(api.retryPlanStep).toHaveBeenCalledWith("t-7", { planStepId: "s2" }, undefined));
  });

  // issue #2451 —— failedStepId 是服务端真实信号，不是前端"第一个未完成的步骤"猜测：
  // 用一个两者会给出不同答案的账本形状钉住这一点（正常写路径下不会出现 s1 仍
  // pending 而 s2 已 in_progress，但 failedStepId 就是为了不依赖这个假设而存在的）。
  it("failedStepId 与「第一个未完成步骤」不一致时，展示以 failedStepId 为准", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "failed",
        failedStepId: "s2",
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "pending", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "in_progress", constraints: [] },
        ],
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-7b" />);

    // 断言精确匹配 `PlanFailureRecovery` 渲染的那句"第 N 步「标签」失败"——不是
    // 泛泛查文案是否出现在页面任意位置（下方只读步骤列表本来就会渲染两个步骤的
    // content，泛泛查询会两个都命中，测不出这里到底用了哪个）。
    expect(await screen.findByText("第 2 步「起草方案初稿」失败")).toBeInTheDocument();
    expect(screen.queryByText("第 1 步「调研竞品定价」失败")).toBeNull();
  });

  it("phase='done'（任务已跑完）渲染只读账本、但不再渲染确认门——即使 gate.required 仍是 true", async () => {
    // ⚠ 这不是假设：`evaluatePlanGate` 按契约只看 `todoCount`（UC-8），todoCount
    // 从确认前到跑完都没变过，所以真实后端在 phase='done' 时 gate.required 仍是
    // true。这条用例钉的正是「组件层面要不要拿它来渲染」，不是重新定义契约本身。
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "done",
        gate: { required: true, reason: "multi-step" },
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "completed", constraints: [] },
        ],
        progress: { completed: 2, total: 2, elapsedMs: 8000 },
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-9" />);

    // issue #2999 —— #2927 把这条改成「整块不渲染」，与同一提交里 task-timeline 对
    // `write_todos` 返回 null 相加 = run 结束后计划痕迹归零。coordinator 裁决恢复
    // 只读账本：本用例原本钉的判据（确认门不能出现）**一字未放宽**，只是不再
    // 顺带要求整个面板消失。
    await waitFor(() => expect(screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeTruthy());
    expect(screen.getByTestId("chat-task-workbench-plan-control")).toBeTruthy();
    expect(screen.queryByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeNull();
    // 只读：展开后没有「编辑计划」开关，也没有任何编辑态控件。
    fireEvent.click(screen.getByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID));
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)).toHaveLength(2);
    expect(screen.queryByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID)).toBeNull();
    expect(screen.queryAllByTestId(PLAN_STEP_DELETE_TESTID)).toHaveLength(0);
    expect(screen.queryAllByTestId(PLAN_STEP_REORDER_TESTID)).toHaveLength(0);
  });

  it("待确认计划自动展开；折叠详情仍保留确认操作", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    render(<CopilotKitV2PlanControl threadId="t-9" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy());
    const toggle = screen.getByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy();
    expect(screen.queryByTestId(PLAN_PANEL_TESTID)).toBeNull();
    // 折叠态仍然保留六态指示器——不是把计划的存在与否也藏起来。
    expect(screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy();
  });

  it("折叠后从「不需要决策」转入「失败态」时自动重新展开，不让用户错过恢复入口", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.fetchPlanLedger.mockResolvedValue(
        ledgerWithSteps({ phase: "executing", runStatus: "running", gate: { required: false, reason: "no-plan" }, activeRunId: "run-1" }),
      );
      render(<CopilotKitV2PlanControl threadId="t-10" />);
      await waitFor(() => expect(screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeTruthy());

      expect(screen.getByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID).getAttribute("aria-expanded")).toBe("false");

      // 轮询窗口内引擎把账本翻成失败态——不是用户手动刷新触发的。
      api.fetchPlanLedger.mockResolvedValue(
        ledgerWithSteps({
          phase: "failed",
          steps: [
            { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
            { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
          ],
        }),
      );
      await vi.advanceTimersByTimeAsync(3000);

      await waitFor(() =>
        expect(screen.getByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID).getAttribute("aria-expanded")).toBe("true"),
      );
      expect(await screen.findByTestId("chat-task-workbench-failure-retry-step")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // issue #2451 —— 真实截图抓到的矛盾：phase="done" 但账本里还有步骤没被标记完成。
  // issue #2999 —— #2927 让 done 态整块 return null，这条提示因此结构上不可达；
  // 恢复只读账本后提示重新可达，判据回到 #2451 的原样，另加只读钉子。
  it("phase='done' 但 progress.completed < progress.total：渲染如实提示，不伪造步骤已完成，且面板只读", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "done",
        gate: { required: true, reason: "multi-step" },
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
        ],
        progress: { completed: 1, total: 2, elapsedMs: 8000 },
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-11" />);
    fireEvent.click(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID));

    const notice = await screen.findByTestId("chat-task-workbench-plan-done-incomplete-notice");
    expect(notice.textContent).toContain("1");
    // 步骤列表本身没被悄悄改写——第二步仍然如实显示 pending，不是伪造成 completed。
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)[1]).toHaveAttribute("data-plan-status", "pending");
    // 只读：结束态没有把这份"还差一步"的账本变回可编辑/可确认的界面。
    expect(screen.queryByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID)).toBeNull();
    expect(screen.queryByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeNull();
  });

  it("phase='done' 且所有步骤都 completed：不渲染提示（沿用 #2451 的行为），账本仍只读可见", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "done",
        gate: { required: true, reason: "multi-step" },
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "completed", constraints: [] },
        ],
        progress: { completed: 2, total: 2, elapsedMs: 8000 },
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-12" />);
    fireEvent.click(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID));
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)).toHaveLength(2);
    expect(screen.queryByTestId("chat-task-workbench-plan-done-incomplete-notice")).toBeNull();
    expect(screen.queryByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID)).toBeNull();
  });

  it("phase='failed' 且 errorCode='MODEL_CALL_FAILED'：失败原因用真实文案，不是写死占位句", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "failed",
        errorCode: "MODEL_CALL_FAILED",
        steps: [{ planStepId: "s1", content: "调研竞品定价", status: "pending", constraints: [] }],
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-13" />);
    expect(await screen.findByText("模型这次没能返回可用结果")).toBeInTheDocument();
  });

  it("phase='failed' 且 errorCode=null：退回原有的诚实通用占位文案", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "failed",
        errorCode: null,
        steps: [{ planStepId: "s1", content: "调研竞品定价", status: "pending", constraints: [] }],
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-14" />);
    expect(await screen.findByText(/账本读模型目前不提供更具体的失败原因/)).toBeInTheDocument();
  });

  it("refetchSignal 变化：立即重取账本（不用等 3 秒轮询），且在追上前暂停/恢复按钮禁用并提示", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        phase: "executing", runStatus: "running", activeRunId: "run-1",
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "in_progress", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
        ],
        progress: { completed: 0, total: 2, elapsedMs: 3000 },
      }),
    );
    const { rerender } = render(<CopilotKitV2PlanControl threadId="t-15" refetchSignal={0} />);
    fireEvent.click(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID));
    await waitFor(() => expect(screen.getByTestId("chat-task-workbench-run-pause")).toBeTruthy());
    expect(screen.getByTestId("chat-task-workbench-run-pause")).not.toBeDisabled();
    expect(api.fetchPlanLedger.mock.calls.length).toBe(1);

    rerender(<CopilotKitV2PlanControl threadId="t-15" refetchSignal={1} />);

    await waitFor(() => expect(api.fetchPlanLedger.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId("chat-task-workbench-run-pause")).toBeDisabled();
    expect(screen.getByTestId("chat-task-workbench-run-recent-error")).toBeTruthy();
  });

  it("PLAN_REVISION_CHANGED：操作失败后立即重取账本，界面提示刷新而不是静默丢弃", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps());
    api.confirmPlan.mockRejectedValue(new Error("stale"));
    api.planControlErrorCode.mockReturnValue("PLAN_REVISION_CHANGED");
    render(<CopilotKitV2PlanControl threadId="t-8" />);

    await waitFor(() => expect(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeTruthy());
    fireEvent.click(screen.getByTestId(PLAN_CONFIRM_RUN_TESTID));

    await waitFor(() => expect(screen.getByTestId("chat-task-workbench-plan-action-error")).toBeTruthy());
    // 失败后应重新拉取账本（第一次挂载 + 失败后一次 = 至少 2 次）。
    await waitFor(() => expect(api.fetchPlanLedger.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

describe("compact plan presentation", () => {
  beforeEach(() => { for (const fn of Object.values(api)) fn.mockReset(); });
  it.each(["done", "cancelled", "preparing"] as const)("hides zero-step %s without actionable state", async phase => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({phase,steps:[],gate:{required:true,reason:"multi-step"}}));
    render(<CopilotKitV2PlanControl threadId="empty" />);
    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-task-workbench-plan-control")).toBeNull();
    expect(screen.queryByTestId(PLAN_RUN_RESUME_TESTID)).toBeNull();
  });
  // issue #2999 —— 恢复 #2927 之前的"默认折叠成一行事实摘要"，并加钉只读：
  // 结束态账本可见（计划痕迹不归零），但没有任何控制操作。
  it("keeps a completed plan as a read-only ledger: factual summary, steps on expand, no controls", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({phase:"done",progress:{completed:0,total:2,elapsedMs:100}}));
    render(<CopilotKitV2PlanControl threadId="ordinary" />);
    const toggle = await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("0/2 步已标记完成");
    expect(screen.queryByTestId(PLAN_PANEL_TESTID)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)).toHaveLength(2);
    expect(screen.queryByText("当前计划")).toBeNull();
    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.queryByText("编辑计划")).toBeNull();
  });
  // issue #2999 反证：done/cancelled 两态都必须「可见且只读」。撤掉产品修复
  // （把 `readOnlyLedger` 换回 `return null`）时这条会红在第一条可见性断言上。
  it.each(["done", "cancelled"] as const)("%s 态账本只读：步骤可见，编辑/删除/调序/确认/暂停一个都没有", async phase => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({
      phase,
      gate: { required: true, reason: "multi-step" },
      steps: [
        { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
        { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
      ],
      progress: { completed: 1, total: 2, elapsedMs: 8000 },
    }));
    render(<CopilotKitV2PlanControl threadId={`readonly-${phase}`} />);
    fireEvent.click(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID));
    // 可见：这正是 #2927 两处 null 相加之后归零的那份计划痕迹。
    expect(screen.getByTestId(PLAN_PANEL_TESTID)).toBeTruthy();
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)).toHaveLength(2);
    // 只读：#2927「结束后没有控制操作」的意图完整保留。
    expect(screen.queryByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID)).toBeNull();
    expect(screen.queryAllByTestId(PLAN_STEP_DELETE_TESTID)).toHaveLength(0);
    expect(screen.queryAllByTestId(PLAN_STEP_REORDER_TESTID)).toHaveLength(0);
    expect(screen.queryByTestId(PLAN_CONFIRM_RUN_TESTID)).toBeNull();
    expect(screen.queryByTestId(PLAN_RUN_RESUME_TESTID)).toBeNull();
    expect(screen.queryByTestId("chat-task-workbench-run-pause")).toBeNull();
    // 步骤状态如实透传，不因为"结束了"就伪造成全完成。
    expect(screen.getAllByTestId(PLAN_STEP_TESTID)[1]).toHaveAttribute("data-plan-status", "pending");
  });
  it("resets editing and expansion on thread changes, ignoring late old-thread reads", async () => {
    let resolveOld!: (ledger: PlanLedgerView) => void;
    api.fetchPlanLedger.mockResolvedValueOnce(ledgerWithSteps()).mockImplementationOnce(() => new Promise<PlanLedgerView>(resolve => {resolveOld=resolve;})).mockResolvedValue(ledgerWithSteps({phase:"done"}));
    const view = render(<CopilotKitV2PlanControl threadId="first" projectId="project" refetchSignal={0} />);
    fireEvent.click(await screen.findByTestId(PLAN_CONTROL_EDIT_TOGGLE_TESTID));
    expect(screen.getAllByTestId(PLAN_STEP_DELETE_TESTID).length).toBeGreaterThan(0);
    view.rerender(<CopilotKitV2PlanControl threadId="first" projectId="project" refetchSignal={1} />);
    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalledTimes(2));
    view.rerender(<CopilotKitV2PlanControl threadId="second" projectId="project" />);
    await waitFor(() => expect(screen.getByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID).getAttribute("aria-expanded")).toBe("false"));
    resolveOld(ledgerWithSteps({phase:"failed"}));
    await waitFor(() => expect(screen.getByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID).textContent).toContain("本轮已结束"));
    expect(screen.queryAllByTestId(PLAN_STEP_DELETE_TESTID)).toHaveLength(0);
    expect(api.resumePlanRun).not.toHaveBeenCalled();
  });
  it("keeps a paused plan resume visible with details initially collapsed", async () => {
    api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({phase:"executing",runStatus:"interrupted",pausedAt:"2026-09-07T00:00:00Z"}));
    render(<CopilotKitV2PlanControl threadId="paused" canWrite={false} />);
    const toggle=await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect((screen.getByTestId(PLAN_RUN_RESUME_TESTID) as HTMLButtonElement).disabled).toBe(true);
  });
});

it("zero-step pending changes remain visible and cannot be acted on by read-only viewers", async () => {
  api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({phase:"executing",steps:[],pendingApplyAtNextRun:true}));
  render(<CopilotKitV2PlanControl threadId="pending-empty" canWrite={false} />);
  const banner = await screen.findByTestId("chat-task-workbench-plan-pending-apply");
  expect(banner).toBeTruthy();
  expect(screen.queryByTestId(PLAN_PANEL_TESTID)).toBeNull();
  expect(banner.closest("fieldset")).toHaveAttribute("disabled");
});

/*
 * issue #3099 —— 本组的两条是这次解耦的**反证**：把 `runLive` 换回
 * `ledger.phase === "executing"`（改动前的写法），第一条立刻回红——`derivePlanPhase`
 * 在账本为空时恒给 `"preparing"`，暂停按钮整块不渲染。第二条钉住不能顺手把
 * 「run 结束后没有控制操作」（#2927）一起放宽。
 */
it("run 在跑但模型还没产出 write_todos（账本为空）：暂停按钮仍然可见可点", async () => {
  api.fetchPlanLedger.mockResolvedValue(
    ledgerWithSteps({ steps: [], phase: "preparing", runStatus: "running", activeRunId: "run-live", gate: { required: false, reason: "no-plan" } }),
  );
  api.pausePlanRun.mockResolvedValue({ runId: "run-live", pausedAtStepId: null, auditEventId: "a" });
  render(<CopilotKitV2PlanControl threadId="t-no-todos" />);

  const pause = await screen.findByTestId("chat-task-workbench-run-pause");
  expect((pause as HTMLButtonElement).disabled).toBe(false);
  // 不编造步骤序号/进度分数：账本里没有步骤，就不假装知道"第几步"。
  expect(screen.queryByText(/当前步骤/)).toBeNull();
  fireEvent.click(pause);
  await waitFor(() => expect(api.pausePlanRun).toHaveBeenCalledWith("t-no-todos", undefined));
});

it.each(["succeeded", "failed", "cancelled"] as const)(
  "run 已结束（runStatus=%s）：仍然没有任何运行级控制（#2927 只读态不被本次解耦放宽）",
  async (runStatus) => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        steps: [], runStatus, activeRunId: null,
        phase: runStatus === "succeeded" ? "done" : runStatus === "failed" ? "failed" : "cancelled",
        gate: { required: false, reason: "no-plan" },
      }),
    );
    render(<CopilotKitV2PlanControl threadId={`t-terminal-${runStatus}`} />);
    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-task-workbench-run-pause")).toBeNull();
    expect(screen.queryByTestId(PLAN_RUN_RESUME_TESTID)).toBeNull();
  },
);

it("editing input from a collapsed failure opens its real editing form", async () => {
  api.fetchPlanLedger.mockResolvedValue(ledgerWithSteps({phase:"failed",failedStepId:"s1"}));
  render(<CopilotKitV2PlanControl threadId="failed-edit" />);
  const toggle = await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
  await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
  fireEvent.click(toggle);
  expect(screen.queryAllByTestId(PLAN_STEP_DELETE_TESTID)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", {name:"修改输入"}));
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getAllByTestId(PLAN_STEP_DELETE_TESTID)).toHaveLength(2);
});

/*
 * issue #3132 —— 两条缺陷的反证。撤掉修复中的任一处，这里对应的用例必红。
 */
describe("issue #3132：失败态一定有可操作入口 + 六态指示器真的挂在真实 chat 上", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.planControlErrorCode.mockReturnValue(null);
  });

  /*
   * 反证一：`PlanPhaseIndicator` 从来没有被挂进 `/chat`（消费方只有单测与 /preview）。
   * 撤掉 `copilotkit-v2-plan-control.tsx` 里的 `indicator` 挂载 → 本条红。
   *
   * ⚠ **本条原来的写法是「新线程（空账本、idle）也渲染阶段指示器 … toBe("preparing")」**
   * ——那正是 #3214 报的缺陷（全新空白会话、根本没有 run，底部却显示一条高亮着
   * 「准备」的阶段条），被当成期望值写进了测试，于是 CI 一直全绿地守护着它。
   * 现在改成钉 #3132 真正要钉的那件事：**指示器确实挂进了真实 chat 渲染树**，
   * 用一个按裁决**应当常驻**的态（`planning`）来证明；空白会话那一面由
   * `plan-phase-indicator-on-demand.test.tsx` 反向断言（它必须不在）。
   * 挂载点被撤掉时，这里与那边会一起红，两个方向都还在。
   */
  it("真实 chat 渲染树里确实挂了阶段指示器（planning 常驻态），data-phase 来自账本直出", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({ steps: [], phase: "planning", runStatus: "running", activeRunId: "r1",
        stepsAreProposal: true, pendingPermissionRequestId: "9f1d2c3b-4a5e-4f6a-8b7c-0d1e2f3a4b5c",
        gate: { required: true, reason: "multi-step" } }),
    );
    render(<CopilotKitV2PlanControl threadId="t-3132-a" />);
    const indicator = await screen.findByTestId("chat-task-workbench-phase-indicator");
    expect(indicator.getAttribute("data-phase")).toBe("planning");
    // 空账本仍然不造计划面板（#3099/#2999 的语义不被放宽）。
    expect(screen.queryByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeNull();
  });

  // 反证二（本 issue 的核心）：**无计划步骤的 failed run**。
  // 撤掉 `steps.length === 0 && !runLive && !hasPlanAction` 那条门上的 `phase !== "failed"`
  // 例外，或撤掉 `PlanFailureRecovery` 渲染门上的 `failedStep` 放宽 → 本条红。
  it("无计划步骤的 failed run 仍渲染恢复入口，「重试」调用 retryPlanStep({ planStepId: null })", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        steps: [], phase: "failed", runStatus: "failed", activeRunId: null,
        failedStepId: null, errorCode: "MODEL_CALL_FAILED",
        gate: { required: false, reason: "no-plan" },
        progress: { completed: 0, total: 0, elapsedMs: 0 },
      }),
    );
    api.retryPlanStep.mockResolvedValue({ runId: "run-retry", auditEventId: "a" });
    render(<CopilotKitV2PlanControl threadId="t-3132-b" />);

    expect((await screen.findByTestId("chat-task-workbench-phase-indicator")).getAttribute("data-phase"))
      .toBe("failed");
    const retry = await screen.findByTestId("chat-task-workbench-failure-retry-step");
    expect(screen.getByTestId("chat-task-workbench-failure-edit-input")).toBeTruthy();
    // 不编造一个不存在的步骤序号。
    expect(screen.queryByText(/第 \d+ 步/)).toBeNull();

    fireEvent.click(retry);
    await waitFor(() =>
      expect(api.retryPlanStep).toHaveBeenCalledWith("t-3132-b", { planStepId: null }, undefined),
    );
  });

  // 「修改输入」在无计划时不得是点了没反应的假按钮：把焦点交回 composer。
  it("无计划的 failed run 点「修改输入」把焦点交回 composer（不是打开空的编辑态）", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledgerWithSteps({
        steps: [], phase: "failed", runStatus: "failed", activeRunId: null,
        failedStepId: null, gate: { required: false, reason: "no-plan" },
        progress: { completed: 0, total: 0, elapsedMs: 0 },
      }),
    );
    const composer = document.createElement("textarea");
    composer.setAttribute("data-testid", "copilotkit-v2-input");
    document.body.appendChild(composer);
    try {
      render(<CopilotKitV2PlanControl threadId="t-3132-c" />);
      fireEvent.click(await screen.findByTestId("chat-task-workbench-failure-edit-input"));
      expect(document.activeElement).toBe(composer);
    } finally {
      composer.remove();
    }
  });
});

/**
 * issue #3245① —— 结束态的折叠头（`执行计划 · 本轮已结束 · N/N 步已标记完成`）不再常驻。
 *
 * **按态双向断言**：该不在的态断言确实不在，该在的态断言确实在。只写「不在」那一半
 * 会退化成「元素本来就没渲染 ⇒ 静默假绿」——本仓反复栽的形态。每一条「不在」的用例
 * 都紧跟一条只改**一个**字段就重新出现的阳性对照。
 */
describe("#3245① 结束且账本跑满时不常驻，其余态照旧", () => {
  const DONE_TESTIDS = ["chat-task-workbench-plan-control", PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID, PLAN_PHASE_INDICATOR_TESTID];
  const settledDone = (overrides: Partial<PlanLedgerView> = {}) => ledgerWithSteps({
    phase: "done",
    runStatus: "idle",
    activeRunId: null,
    gate: { required: false, reason: "no-plan" },
    steps: [
      { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
      { planStepId: "s2", content: "起草方案初稿", status: "completed", constraints: [] },
    ],
    progress: { completed: 2, total: 2, elapsedMs: 12_000 },
    ...overrides,
  });

  async function renderLedger(ledger: PlanLedgerView, threadId: string) {
    api.fetchPlanLedger.mockResolvedValue(ledger);
    render(<CopilotKitV2PlanControl threadId={threadId} />);
    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalled());
  }

  it("done 且 2/2 全部标记完成 ⇒ 整块不渲染（人类截图里的那一行）", async () => {
    await renderLedger(settledDone(), "t-3245-done");
    // 等一轮真实结算，别把"还没渲染出来"读成"正确地没有渲染"。
    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalled());
    for (const id of DONE_TESTIDS) expect(screen.queryByTestId(id), `${id} 在结束态仍然常驻`).toBeNull();
    // 能力面：这一态本来就没有暂停/继续（run 已结束），确认这条门没有顺手吞掉别的东西。
    expect(screen.queryByTestId(PLAN_RUN_RESUME_TESTID)).toBeNull();
  });

  it("阳性对照：同一份账本只把 completed 从 2 改回 1 ⇒ 折叠头立刻回来（#2451 那条矛盾要有出口）", async () => {
    await renderLedger(
      settledDone({
        steps: [
          { planStepId: "s1", content: "调研竞品定价", status: "completed", constraints: [] },
          { planStepId: "s2", content: "起草方案初稿", status: "pending", constraints: [] },
        ],
        progress: { completed: 1, total: 2, elapsedMs: 12_000 },
      }),
      "t-3245-done-incomplete",
    );
    expect(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID)).toBeInTheDocument();
    expect(screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID)).toHaveTextContent("1/2 步已标记完成");
  });

  it("阳性对照：还在跑（runStatus running）⇒ 面板在，且暂停入口可达（#3081 不许被这条门弄回不可触达）", async () => {
    await renderLedger(
      settledDone({ phase: "executing", runStatus: "running", activeRunId: "run-1" }),
      "t-3245-running",
    );
    const toggle = await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
    expect(toggle).toBeInTheDocument();
    // 面板默认折叠，暂停入口在展开之后——本条只钉「这条卸载门没有把它变成不可触达」。
    fireEvent.click(toggle);
    expect(await screen.findByTestId(PLAN_RUN_PAUSE_TESTID)).toBeInTheDocument();
  });

  it("阳性对照：已暂停 ⇒ 面板在，且「继续执行」可达", async () => {
    await renderLedger(
      settledDone({ phase: "executing", runStatus: "interrupted", activeRunId: "run-1", pausedAt: "2026-09-10T00:00:00.000Z" }),
      "t-3245-paused",
    );
    expect(await screen.findByTestId(PLAN_RUN_RESUME_TESTID)).toBeInTheDocument();
  });

  it("阳性对照：done 但还有待应用的编辑 / 孤儿约束 ⇒ 面板在（还有事等用户处理）", async () => {
    await renderLedger(settledDone({ pendingApplyAtNextRun: true }), "t-3245-pending-apply");
    expect(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID)).toBeInTheDocument();
    cleanup();
    await renderLedger(
      settledDone({ orphanedConstraints: [{ constraintId: "c1", text: "只用公开资料", orphanedAtRevision: 3, formerStepContent: "调研竞品定价" }] }),
      "t-3245-orphan",
    );
    expect(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID)).toBeInTheDocument();
  });

  it("阳性对照：failed ⇒ 面板在（失败一定要有可操作入口）", async () => {
    await renderLedger(
      settledDone({ phase: "failed", runStatus: "failed", failedStepId: "s2", errorCode: "MODEL_CALL_FAILED" }),
      "t-3245-failed",
    );
    expect(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID)).toBeInTheDocument();
  });
});
