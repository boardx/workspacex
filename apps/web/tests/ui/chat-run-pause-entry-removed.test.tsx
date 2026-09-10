/**
 * issue #3318（人类裁决 2026-09-10）—— **chat 里不能再出现「暂停」入口。**
 *
 * > chat 中，暂停不了，先取消暂停的动作，只支持取消
 *
 * 真实链路上暂停不生效（根因另立 #3319），所以先把入口撤掉，只留「取消」。
 *
 * ## 这条判据为什么这么写
 *
 * 两种假修法都要挡住，而且它们红的方式不一样：
 *   - **「藏起来但仍可触发」**（`display:none` / `hidden` / 零尺寸）：元素还在 DOM 上，
 *     键盘、辅助技术、以及任何拿得到节点的脚本都还能点它。所以这里判的是
 *     `queryByTestId(...) === null`（**根本不在 DOM 上**），不是 `not.toBeVisible()`。
 *   - **「元素在但在视口外」**：同理，一律按"还在"处理——本仓栽过
 *     `getBoundingClientRect` 读不出 overflow 裁剪，几何全绿而用户看不见；
 *     反过来"看不见但还在"同样不算移除。
 * 再加一条不认 testid 的兜底：**任何**可点击元素的可及名里不许出现「暂停」，
 * 免得换个 testid 重新长出来。「暂停中…」这个中间态文案同样一个字都不许剩。
 *
 * ## 阳性对照（不然这条判据可能只是"什么都没渲染"）
 * 每个用例都先断言**暂停按钮原本该在的那一屏确实渲染出来了**
 * （run 真的在跑、运行级控制那一行/进度卡在），再断言它上面没有暂停入口。
 *
 * ## 反证
 * 把 `CHAT_RUN_PAUSE_ENTRY_ENABLED` 翻回 `true`（= 把入口加回去），本文件每条用例
 * 立刻红（真实输出贴在 PR #? 正文里）。这条判据**不**随该常量跳过：常量翻牌那天
 * 是一次有意的产品动作，本文件必须跟着一起被重新裁决，而不是悄悄睡过去。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
import { PLAN_RUN_PAUSE_TESTID, PLAN_RUN_PROGRESS_TESTID, PLAN_RUN_RESUME_TESTID } from "@/components/plan-control/plan-run-progress";

function ledger(overrides: Partial<PlanLedgerView> = {}): PlanLedgerView {
  return {
    cancelRequestedAt: null, pausedAt: null, pauseRequestedAt: null,
    revision: 3, engineEpoch: 1, origin: "engine", stepsAreProposal: false,
    pendingPermissionRequestId: null, steps: [], orphanedConstraints: [],
    phase: "preparing", gate: { required: false, reason: "no-plan" },
    progress: { completed: 0, total: 0, elapsedMs: 0 },
    pendingApplyAtNextRun: false, runStatus: "idle", activeRunId: null,
    errorCode: null, failedStepId: null,
    ...overrides,
  };
}

/** 「不在可交互的 DOM 里」——不是"不可见"，是**没有这个节点**。 */
function expectNoPauseEntry(): void {
  expect(
    screen.queryByTestId(PLAN_RUN_PAUSE_TESTID),
    "chat 里不许再有暂停入口（#3318）；藏起来但仍在 DOM 上不算移除",
  ).toBeNull();
  const clickable = [
    ...screen.queryAllByRole("button"),
    ...screen.queryAllByRole("link"),
    ...screen.queryAllByRole("menuitem"),
  ];
  const pauseLike = clickable.filter((el) => (el.textContent ?? "").includes("暂停"));
  expect(
    pauseLike.map((el) => el.outerHTML),
    "换个 testid 也不行：任何可点击元素上都不许出现「暂停」",
  ).toEqual([]);
  expect(
    screen.queryByText(/暂停中/),
    "「暂停中…」这个中间态文案是 #3318 实测里卡住用户的那一屏，不许残留",
  ).toBeNull();
}

describe("#3318 —— chat 的暂停入口已移除，取消仍是唯一终止动作", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.planControlErrorCode.mockReturnValue(null);
  });

  it("分支①：run 在跑、账本还没有步骤（运行级控制那一行）——行在，暂停入口不在", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({ runStatus: "running", activeRunId: "run-live" }),
    );
    render(<CopilotKitV2PlanControl threadId="t-3318-no-steps" />);

    // 阳性对照：暂停按钮原本就长在这一行上（#3099 那条分支）。
    const row = await screen.findByTestId("chat-task-workbench-plan-control");
    expect(within(row).getByRole("status")).toHaveTextContent("执行中");
    expectNoPauseEntry();
  });

  it("分支②：run 在跑、账本有步骤（展开的计划面板 / 进度卡）——卡在，暂停入口不在", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({
        phase: "executing", runStatus: "running", activeRunId: "run-live",
        steps: [{ planStepId: "s1", content: "调研竞品定价", status: "in_progress", constraints: [] }],
        progress: { completed: 0, total: 1, elapsedMs: 4000 },
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-3318-steps" />);
    // 面板默认折叠——先做用户本来就要做的那一步，否则"没找到暂停"只是因为没展开。
    (await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID)).click();

    // 阳性对照：进度卡（暂停按钮原本就在它右上角）真的渲染出来了。
    await waitFor(() => expect(screen.getByTestId(PLAN_RUN_PROGRESS_TESTID)).toBeInTheDocument());
    expect(screen.getByTestId(PLAN_RUN_PROGRESS_TESTID)).toHaveTextContent("调研竞品定价");
    expectNoPauseEntry();
  });

  it("pause-requested 中间态：账本带着 pauseRequestedAt 回来，界面也不再说「正在暂停 / 暂停中…」", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({
        phase: "executing", runStatus: "running", activeRunId: "run-live",
        pauseRequestedAt: "2026-09-10T00:00:00.000Z",
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-3318-pause-requested" />);

    const row = await screen.findByTestId("chat-task-workbench-plan-control");
    expect(
      within(row).getByRole("status"),
      "没有入口就产生不了 pause-requested；真出现了也不该告诉用户「有个暂停正在进行」",
    ).toHaveTextContent("执行中");
    expectNoPauseEntry();
  });

  it("待应用编辑横幅不再教用户去「先暂停」", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({
        phase: "executing", runStatus: "running", activeRunId: "run-live",
        pendingApplyAtNextRun: true,
        steps: [{ planStepId: "s1", content: "调研竞品定价", status: "in_progress", constraints: [] }],
        progress: { completed: 0, total: 1, elapsedMs: 4000 },
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-3318-pending-apply" />);

    // 阳性对照：横幅本身还在（改动落账本这件事仍要告诉用户）。
    expect(await screen.findByTestId("chat-task-workbench-plan-pending-apply")).toBeInTheDocument();
    expectNoPauseEntry();
  });

  it("已暂停的存量 run：恢复入口保留（这是脱困出口，不是暂停入口）", async () => {
    api.fetchPlanLedger.mockResolvedValue(
      ledger({
        phase: "executing", runStatus: "interrupted", activeRunId: "run-live",
        pausedAt: "2026-09-10T00:00:00.000Z",
      }),
    );
    render(<CopilotKitV2PlanControl threadId="t-3318-paused" />);

    expect(await screen.findByTestId(PLAN_RUN_RESUME_TESTID)).toBeInTheDocument();
    expect(screen.queryByTestId(PLAN_RUN_PAUSE_TESTID)).toBeNull();
  });
});
