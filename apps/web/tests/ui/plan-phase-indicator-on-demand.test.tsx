/**
 * issue #3214 + #3208（方案 A：按需渲染 + 收进折叠头）—— 阶段指示器**什么时候该在
 * DOM 里**的机械门控。
 *
 * ## 判据（签核人 2026-09-09 裁决原话「先保留这个吧，但是只有需要的时候弹出来」）
 *
 * 同一屏已经有两处在说"现在到哪一步了"：`PlanRunProgress` 的运行进度卡
 * （准备/执行/回复 + 已用秒）与折叠头那行 `执行计划 · <stateLabel>`。因此
 * 阶段条只在**它是新增信息**的四态常驻：
 *
 * | phase | 常驻？ | 为什么 |
 * |---|---|---|
 * | `planning` / `approving` | 是 | 需要用户动作，且进度卡此时不渲染 |
 * | `failed` / `cancelled`   | 是 | 终态，进度卡已卸载（`runLive === false`） |
 * | `preparing`              | 否 | **没有 run**（#3214：空白会话也在显示"准备"） |
 * | `executing` / `done`     | 否 | 与同屏进度卡 / 折叠头摘要纯重复 |
 *
 * ## 这个文件为什么必须**两个方向**都断言
 *
 * 默认隐藏之后，「元素不存在 ⇒ 断言无从执行 ⇒ 静默假绿」正是本仓反复栽的
 * 「红 ≠ 跑过」形态。所以：四个常驻态断言**它在、且线上格数正确**；三个不常驻态
 * 断言**它确实不在**，并且**展开折叠头之后它又回来**（裁决第 4 条：收起后仍可触达）。
 * 撤掉修复中的任一半，这里必有一条红。
 *
 * ⚠ 渲染条件的事实源：`shouldSurfacePlanPhaseIndicator(ledger.phase)`——与指示器
 * 自己显示的那个值**是同一个 `ledger.phase`**，不是另起一路推断（本仓今晚第五次
 * 「同一事实声明在两处」事故的直接教训，见 #3220 / #3207）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
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

import { CopilotKitV2PlanControl, PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID } from "@/components/chat/copilotkit-v2-plan-control";
import { PLAN_PHASE_INDICATOR_TESTID } from "@/components/plan-control/plan-phase-indicator";
import { PLAN_RUN_PAUSE_TESTID } from "@/components/plan-control/plan-run-progress";
import { shouldSurfacePlanPhaseIndicator, type PlanPhase } from "@repo/contracts/plan-control";

function ledger(overrides: Partial<PlanLedgerView> = {}): PlanLedgerView {
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
    gate: { required: false, reason: "no-plan" },
    progress: { completed: 0, total: 2, elapsedMs: 1_000 },
    pendingApplyAtNextRun: false,
    runStatus: "idle",
    activeRunId: null,
    errorCode: null,
    failedStepId: null,
    ...overrides,
  };
}

function cellCount(): number {
  return document.querySelectorAll(`[data-testid="${PLAN_PHASE_INDICATOR_TESTID}"] [data-phase-step]`).length;
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.planControlErrorCode.mockReturnValue(null);
});

/*
 * 方向一：四个常驻态——它必须在，且线上格数与 `ui.md` 2.3 一致
 * （`preparing/planning/executing/approving/done` 五格；`failed`/`cancelled`
 * 替换整条，没有格子）。把渲染条件误写成"永不显示"⇒ 这四条全红。
 */
describe("#3208 方案 A ①：需要用户动作 / 终态这四态，阶段条常驻（且格数正确）", () => {
  const CASES: readonly { phase: PlanPhase; patch: Partial<PlanLedgerView>; cells: number }[] = [
    { phase: "planning", patch: { runStatus: "idle", gate: { required: true, reason: "multi-step" } }, cells: 5 },
    { phase: "approving", patch: { runStatus: "running", activeRunId: "r1" }, cells: 5 },
    { phase: "failed", patch: { runStatus: "failed", errorCode: "MODEL_CALL_FAILED" }, cells: 0 },
    { phase: "cancelled", patch: { runStatus: "cancelled" }, cells: 0 },
  ];
  it.each(CASES)("phase=$phase ⇒ 默认（折叠态）就能看到阶段条，线上 $cells 格", async ({ phase, patch, cells }) => {
    api.fetchPlanLedger.mockResolvedValue(ledger({ phase, ...patch }));
    render(<CopilotKitV2PlanControl threadId={`t-${phase}`} />);
    await screen.findByTestId(PLAN_PHASE_INDICATOR_TESTID);

    /*
     * ⚠ 反证记录（不要删这段）：只断言"能找到"是**不够敏感**的。`planning`/
     * `approving`/`failed` 三态 `needsDecision` 为真会自动展开面板，于是即使把
     * 「常驻」整个撤掉（`shouldSurfacePlanPhaseIndicator` 恒 false），它们照样
     * 能在展开态里被找到——实测只有 `cancelled` 一条会红。「常驻」的真实含义是
     * **折叠态下也在**，所以这里先把面板收起来，再断言它仍然在。
     */
    const toggle = screen.queryByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
    if (toggle && toggle.getAttribute("aria-expanded") === "true") fireEvent.click(toggle);
    const el = screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID);
    expect(el.getAttribute("data-phase")).toBe(phase);
    expect(cellCount()).toBe(cells);
    if (cells > 0) expect(el.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });
});

/*
 * 方向二：三个不常驻态——它必须**确实不在**。
 * 撤掉渲染条件（改回无条件挂载）⇒ 这三条全红，包括 #3214 那条空白会话。
 */
describe("#3214 + #3208 方案 A ②：无 run / 与进度卡重复的三态，阶段条不在 DOM 里", () => {
  /*
   * ⚠ 这条用例第一版是**假绿的**（反证记录，不要删）：只 `await` 到
   * `fetchPlanLedger` 被调用就断言"元素不在"，而那一刻账本还没 resolve、组件
   * 还什么都没渲染——未修的代码同样通过。「元素不存在 ⇒ 断言无从执行」正是
   * 本仓反复栽的那个形态。
   *
   * 现在两件事一起做：① `settle()` 真的把账本 resolve 后的那次渲染冲干净；
   * ② **同一个 `settle()` 预算**下用 `planning` 账本做阳性对照——对照能出现，
   * 才证明空白会话那条"不出现"不是等得不够久。
   */
  async function settle(): Promise<void> {
    await waitFor(() => expect(api.fetchPlanLedger).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  }

  it("#3214：全新空白会话（无 run、无计划、phase=preparing）⇒ 整块不渲染，没有「准备」高亮", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({ phase: "preparing", steps: [], runStatus: "idle", progress: { completed: 0, total: 0, elapsedMs: 0 } }),
    );
    const { container } = render(<CopilotKitV2PlanControl threadId="t-blank" />);
    await settle();
    expect(screen.queryByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeNull();
    expect(container.textContent).not.toContain("准备");

    // 阳性对照：同样的 mock 路径、同样的 settle 预算，planning 账本必须看得见。
    cleanup();
    api.fetchPlanLedger.mockResolvedValue(ledger({ phase: "planning", gate: { required: true, reason: "multi-step" } }));
    render(<CopilotKitV2PlanControl threadId="t-blank-control" />);
    await settle();
    expect(screen.getByTestId(PLAN_PHASE_INDICATOR_TESTID).getAttribute("data-phase")).toBe("planning");
  });

  it.each(["executing", "done"] as const)("phase=%s ⇒ 折叠态下阶段条不在（与同屏进度卡/折叠头摘要重复）", async (phase) => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({ phase, runStatus: phase === "executing" ? "running" : "succeeded", activeRunId: phase === "executing" ? "r1" : null }),
    );
    render(<CopilotKitV2PlanControl threadId={`t-${phase}`} />);
    await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
    expect(screen.queryByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeNull();
  });
});

/*
 * 裁决第 4 条：收起后**仍可触达**。折叠头就是那个入口——展开即出现。
 * 把「展开也显示」这一半删掉 ⇒ 这两条红（于是"藏起来"就变成了"永久拿不到"）。
 */
describe("#3208 方案 A ③：折叠头是触达入口——展开后阶段条出现在原位", () => {
  it.each(["executing", "done"] as const)("phase=%s：点开折叠头 ⇒ 阶段条出现，五格齐全", async (phase) => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({ phase, runStatus: phase === "executing" ? "running" : "succeeded", activeRunId: phase === "executing" ? "r1" : null }),
    );
    render(<CopilotKitV2PlanControl threadId={`t-${phase}-expand`} />);
    const toggle = await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    const el = await screen.findByTestId(PLAN_PHASE_INDICATOR_TESTID);
    expect(el.getAttribute("data-phase")).toBe(phase);
    expect(cellCount()).toBe(5);
  });
});

/*
 * 硬约束（#3081 / F3）：能力面一个字不动。隐藏阶段条不得把暂停按钮一起带走——
 * 「正在跑但模型没产出计划」这条分支上，暂停是用户此刻**唯一**的控制入口。
 */
describe("#3081 不回归：阶段条隐藏了，但暂停入口仍在原处", () => {
  it("executing + 无计划步骤 ⇒ 阶段条不在，「暂停」仍可点", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({ phase: "executing", steps: [], runStatus: "running", activeRunId: "r1", progress: { completed: 0, total: 0, elapsedMs: 5_000 } }),
    );
    render(<CopilotKitV2PlanControl threadId="t-exec-noplan" />);
    const pause = await screen.findByTestId(PLAN_RUN_PAUSE_TESTID);
    expect(pause.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByTestId(PLAN_PHASE_INDICATOR_TESTID)).toBeNull();
  });
});

/*
 * 同一事实不得声明在两处：渲染判据来自契约里那一个纯函数，组件不另建一张表。
 * 若有人在组件里复制一份"哪几态要显示"，改契约这条不会红——所以这条钉的是
 * **契约函数本身的取值**，组件行为由上面三组用例钉。
 */
describe("单一事实源：shouldSurfacePlanPhaseIndicator 是「常驻哪几态」的唯一判据", () => {
  it.each([
    ["planning", true], ["approving", true], ["failed", true], ["cancelled", true],
    ["preparing", false], ["executing", false], ["done", false],
  ] as const)("phase=%s ⇒ %s", (phase, expected) => {
    expect(shouldSurfacePlanPhaseIndicator(phase)).toBe(expected);
  });
});
