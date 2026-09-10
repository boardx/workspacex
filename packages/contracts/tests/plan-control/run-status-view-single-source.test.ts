/**
 * issue #3365 —— `deriveRunStatusView` 的全叉积真值表。
 *
 * 判据**不判「某句文案存在」**：现状（缺陷本身）已经满足那种断言，它在这个缺陷下
 * 无法被证伪。这里判的是**组合的一致性**——「步骤全完成」与「当前步骤指向某一步」
 * 不得同真、「报错」与「表现成还在推进」不得同真。
 */
import { describe, expect, it } from "vitest";
import {
  deriveRunStatusView, RUN_PROGRESSING_LABELS,
  type PlanPhase, type RunStatusForPhase, type RunStatusViewInput,
} from "../../src/plan-control";

const PHASES: readonly PlanPhase[] = ["preparing", "planning", "executing", "approving", "done", "failed", "cancelled"];
const STEP_SHAPES: readonly (readonly ("pending" | "in_progress" | "completed")[])[] = [
  [], ["pending"], ["in_progress"], ["completed"],
  ["completed", "completed"], ["completed", "in_progress"], ["completed", "pending"], ["pending", "pending"],
];
const BOOLS = [false, true] as const;
const RUN_STATUSES: readonly RunStatusForPhase[] = ["idle", "running", "succeeded", "failed", "interrupted", "cancelled"];

function* cases(): Generator<RunStatusViewInput> {
  for (const phase of PHASES) for (const stepStatuses of STEP_SHAPES)
    for (const runStatus of RUN_STATUSES)
      for (const paused of BOOLS) for (const pauseRequested of BOOLS)
        for (const gateRequired of BOOLS) for (const hasRecentError of BOOLS)
          yield {
            phase, stepStatuses, runStatus, paused, pauseRequested, gateRequired,
            hasRecentError, pauseEntryEnabled: true,
            progressCompleted: stepStatuses.filter((s) => s === "completed").length,
            progressTotal: stepStatuses.length,
          };
}

const ALL = [...cases()];

describe("deriveRunStatusView 全叉积不变量（#3365）", () => {
  it(`叉积规模非平凡（${ALL.length} 例）`, () => { expect(ALL.length).toBeGreaterThan(500); });

  it("I3：currentStepIndex 非空 ⇒ 它指向的那一步不是 completed；无未完成步骤 ⇒ 恒为 null", () => {
    for (const c of ALL) {
      const v = deriveRunStatusView(c);
      if (v.currentStepIndex !== null) {
        expect(c.stepStatuses[v.currentStepIndex - 1], JSON.stringify(c)).not.toBe("completed");
      } else {
        expect(c.stepStatuses.every((s) => s === "completed"), JSON.stringify(c)).toBe(true);
      }
    }
  });

  it("I4：进度条分子恒等于账本 progress.completed，不许是「跑到第几步」的推算", () => {
    for (const c of ALL) {
      const v = deriveRunStatusView(c);
      expect(v.progressValue, JSON.stringify(c)).toBe(c.progressCompleted);
      expect(v.progressTotal, JSON.stringify(c)).toBe(c.progressTotal);
    }
  });

  it("I5：步骤全完成 ⇒ 不得同时宣称推进中（人类截图里那句「2/2 已完成」+「执行中」）", () => {
    for (const c of ALL) {
      const v = deriveRunStatusView(c);
      // 判据以**输入事实**为准（步骤全完成），不以输出的 currentStepIndex 为准——
      // 后者是被判定的量之一，用它当守卫，缺陷（兜底填一个非空值）会让守卫自己失效。
      const allDone = c.stepStatuses.length > 0 && c.stepStatuses.every((s) => s === "completed");
      if (allDone) {
        expect(v.currentStepIndex, JSON.stringify(c)).toBeNull();
        expect(v.activity, JSON.stringify(c)).not.toBe("progressing");
        expect(RUN_PROGRESSING_LABELS, JSON.stringify(c)).not.toContain(v.stateLabel);
      }
    }
  });

  it("I6：报了错 ⇒ 停滞态 + 可见恢复入口，且不得用推进族文案", () => {
    for (const c of ALL) {
      const v = deriveRunStatusView(c);
      if (!c.hasRecentError) continue;
      // 账本已经给出终态/已暂停的更权威说法时以它为准；其余一律 stalled。
      const authoritative = ["done", "failed", "cancelled"].includes(c.phase) || c.paused;
      if (authoritative) { expect(RUN_PROGRESSING_LABELS).not.toContain(v.stateLabel); continue; }
      expect(v.activity, JSON.stringify(c)).toBe("stalled");
      expect(v.showRecovery, JSON.stringify(c)).toBe(true);
      expect(RUN_PROGRESSING_LABELS, JSON.stringify(c)).not.toContain(v.stateLabel);
    }
  });

  it("I7：宣称推进中 ⇒ 有计划时必须指得出是哪一步", () => {
    for (const c of ALL) {
      const v = deriveRunStatusView(c);
      if (v.activity === "progressing" && c.stepStatuses.length > 0) {
        expect(v.currentStepIndex, JSON.stringify(c)).not.toBeNull();
      }
    }
  });

  it("人类 2026-09-10 实测那份账本（真实权威读逐字）不再自相矛盾", () => {
    const v = deriveRunStatusView({
      phase: "executing", runStatus: "running", stepStatuses: ["completed", "completed"],
      progressCompleted: 2, progressTotal: 2,
      paused: false, pauseRequested: false, gateRequired: true,
      hasRecentError: false, pauseEntryEnabled: true,
    });
    expect(v.currentStepIndex).toBeNull();     // 不再指向已完成的第 2 步
    expect(v.stateLabel).toBe("正在收尾");      // 不再说「执行中」
    expect(v.progressValue).toBe(2);            // 不再是 stepIndex-1 = 1（50%）
    expect(v.activity).toBe("settling");
  });
});
