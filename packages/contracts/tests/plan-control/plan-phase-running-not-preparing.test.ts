/**
 * issue #3208 —— 「阶段条高亮『准备』，同一行右侧写『执行中』」的机械门控。
 *
 * 人类 2026-09-09 在 devapp 验收：一条 run 已跑 8 分 02 秒、调用工具 6 次、技能活动
 * 20 项，`copilotkit-v2-plan-control.tsx` 那一行（steps 为空 + runLive）同时渲染
 * `PlanPhaseIndicator phase={ledger.phase}`（= `preparing` → 高亮「准备」）与
 * `<span role="status">执行中</span>`（由 `runStatus` 推出）。**同一屏两处自相矛盾。**
 *
 * 根因不是前端：`derivePlanPhase` 里 `if (input.ledgerEmpty) return "preparing";`
 * 排在 `runStatus === "running"` **之前**，于是任何一条没有写过计划的 run（大量普通
 * 对话）阶段恒为 `preparing`——#3187 记录的 44 次 `/plan-control/.../ledger` 请求
 * 全部返回 `phase:"preparing" / runStatus:"running" / steps:0` 就是这条分支。
 *
 * 修法是让 run 的在途性优先于「账本有没有步骤」：`preparing` 从此只表示
 * **没有在途 run 且没有计划**（idle 线程 / 新线程），不再与「正在跑」重叠。
 * 撤销该顺序调整 ⇒ 本文件第一条立刻回红。
 */
import { describe, it, expect } from "vitest";
import { derivePlanPhase } from "../../src/plan-control";

const BASE = {
  ledgerEmpty: true,
  pendingToolCalls: [] as const,
  hasFailedStep: false,
  hasPendingPlanConfirmation: false,
};

describe("#3208 · 在途 run 的阶段不得是 preparing", () => {
  it("run 在跑 + 账本为空 + 无中断 ⇒ executing（不是 preparing）", () => {
    expect(derivePlanPhase({ ...BASE, runStatus: "running" })).toBe("executing");
  });

  it("已暂停（interrupted）+ 账本为空 ⇒ executing —— 暂停的是一条在途 run，不是「还没开始」", () => {
    expect(derivePlanPhase({ ...BASE, runStatus: "interrupted" })).toBe("executing");
  });

  it("preparing 仍然可达，且只在没有在途 run 时：idle + 账本为空", () => {
    expect(derivePlanPhase({ ...BASE, runStatus: "idle" })).toBe("preparing");
  });

  it("既有优先级不被这次调整绕过：终态 / 计划确认 / call_skill 审批仍然压过 executing", () => {
    expect(derivePlanPhase({ ...BASE, runStatus: "cancelled" })).toBe("cancelled");
    expect(derivePlanPhase({ ...BASE, runStatus: "succeeded" })).toBe("done");
    expect(derivePlanPhase({ ...BASE, runStatus: "running", hasFailedStep: true })).toBe("failed");
    expect(derivePlanPhase({ ...BASE, runStatus: "running", hasPendingPlanConfirmation: true })).toBe("planning");
    expect(derivePlanPhase({
      ...BASE, runStatus: "running",
      pendingToolCalls: [{ toolName: "call_skill", awaitingApproval: true }],
    })).toBe("approving");
  });
});
