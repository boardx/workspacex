import { describe, expect, it } from "vitest";
import {
  isInspectorCollapsed,
  nextInspectorTab,
  type InspectorSignals,
} from "@/lib/chat-task-inspector-tabs";
import { currentPlanStep } from "@/lib/agui-plan-todos";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";

/**
 * issue #2068 —— 右栏 Inspector 的页签规则 + loading 气泡「第几步」的派生规则。
 *
 * 这两条都是**纯函数**，所以在这里被逐条钉死：真栈 e2e 一轮十几分钟，只负责证明
 * "接线是通的"，不负责穷举分支。反面用例（用户手点后不被拽走、首帧不自动切、
 * 全部完成后不显示"第 n/n 步"）与正面用例同等重要——本仓已九次"全绿但空转"。
 */

const S = (materialsCount: number, artifactsCount: number, isRunning: boolean): InspectorSignals =>
  ({ materialsCount, artifactsCount, isRunning });

describe("nextInspectorTab", () => {
  it("首帧（prev 为 null）不自动切换——刚打开就把用户拽走不是自动切换", () => {
    expect(nextInspectorTab(null, S(3, 2, true), "run-details")).toBe("run-details");
  });

  it("材料变多 → 切「材料」", () => {
    expect(nextInspectorTab(S(0, 0, false), S(1, 0, false), "progress")).toBe("materials");
  });

  it("运行从停到跑 → 切「进度」", () => {
    expect(nextInspectorTab(S(1, 0, false), S(1, 0, true), "materials")).toBe("progress");
  });

  it("产物变多 → 切「产物」", () => {
    expect(nextInspectorTab(S(1, 0, true), S(1, 1, true), "progress")).toBe("artifacts");
  });

  it("产物与运行同一 tick 一起跃迁时，产物优先——否则用户永远看不到产物自动弹出", () => {
    expect(nextInspectorTab(S(0, 0, false), S(0, 1, true), "progress")).toBe("artifacts");
  });

  it("材料与运行同一 tick 一起跃迁时，材料优先于运行", () => {
    expect(nextInspectorTab(S(0, 0, false), S(1, 0, true), "progress")).toBe("materials");
  });

  it("反证：信号没有跃迁就保留用户手点的页签（重渲染不许把人拽回去）", () => {
    const same = S(2, 1, true);
    expect(nextInspectorTab(same, same, "run-details")).toBe("run-details");
    // 运行中每秒重渲染一次，若按"当前状态"而不是"跃迁"来切，这里会被拽回 progress。
    expect(nextInspectorTab(S(2, 1, true), S(2, 1, true), "materials")).toBe("materials");
  });

  it("反证：数量减少（材料被删）不触发切换", () => {
    expect(nextInspectorTab(S(3, 0, false), S(2, 0, false), "artifacts")).toBe("artifacts");
  });

  it("反证：run 结束（跑→停）不触发切换——那一刻该由产物或用户决定看哪里", () => {
    expect(nextInspectorTab(S(1, 0, true), S(1, 0, false), "progress")).toBe("progress");
  });
});

describe("isInspectorCollapsed", () => {
  it("四个页签全空 → 折叠（TW-P0-4③：不许常驻占六分之一屏）", () => {
    expect(isInspectorCollapsed(S(0, 0, false), false, false)).toBe(true);
  });

  it.each([
    ["有材料", S(1, 0, false), false, false],
    ["有产物", S(0, 1, false), false, false],
    ["在运行", S(0, 0, true), false, false],
    ["有计划", S(0, 0, false), true, false],
    ["有运行详情", S(0, 0, false), false, true],
  ])("%s → 不折叠", (_label, signals, hasPlan, hasRunDetails) => {
    expect(isInspectorCollapsed(signals as InspectorSignals, hasPlan as boolean, hasRunDetails as boolean)).toBe(false);
  });
});

describe("currentPlanStep", () => {
  const todo = (content: string, status: PlanTodo["status"]): PlanTodo => ({ content, status });

  it("优先取第一条 in_progress", () => {
    expect(currentPlanStep([
      todo("理解需求", "completed"),
      todo("对比竞品", "in_progress"),
      todo("生成报告", "pending"),
    ])).toEqual({ index: 2, total: 3, content: "对比竞品" });
  });

  it("没有 in_progress 时退回第一条 pending（引擎刚标完上一步的那个窗口）", () => {
    expect(currentPlanStep([
      todo("理解需求", "completed"),
      todo("对比竞品", "pending"),
    ])).toEqual({ index: 2, total: 2, content: "对比竞品" });
  });

  it("反证：全部完成 → null，不显示「第 n/n 步」", () => {
    expect(currentPlanStep([todo("a", "completed"), todo("b", "completed")])).toBeNull();
  });

  it("反证：没有计划 / 空计划 → null，不编一句「正在处理第 1 步」", () => {
    expect(currentPlanStep(null)).toBeNull();
    expect(currentPlanStep([])).toBeNull();
  });
});
