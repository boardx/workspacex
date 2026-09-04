/**
 * F975 —— UC-8 `evaluatePlanGate`：封闭表驱动判定，纯函数，不失败。
 *
 * 权威规格：usecases.md UC-8 判定表 + 反证节。
 */
import { describe, expect, it } from "vitest";
import { evaluatePlanGate } from "../../src/plan-control";

describe("UC-8 evaluatePlanGate：封闭判定表", () => {
  it.each([
    { todoCount: 0, userForced: false, expected: { required: false, reason: "no-plan" } },
    { todoCount: 1, userForced: false, expected: { required: false, reason: "single-step" } },
    { todoCount: 2, userForced: false, expected: { required: true, reason: "multi-step" } },
    { todoCount: 7, userForced: false, expected: { required: true, reason: "multi-step" } },
  ])("todoCount=$todoCount userForced=$userForced -> $expected", ({ todoCount, userForced, expected }) => {
    expect(evaluatePlanGate({ todoCount, userForced })).toEqual(expected);
  });

  it("userForced=true 恒 required:true reason:user-forced，优先于 todoCount", () => {
    expect(evaluatePlanGate({ todoCount: 0, userForced: true })).toEqual({
      required: true, reason: "user-forced",
    });
    expect(evaluatePlanGate({ todoCount: 5, userForced: true })).toEqual({
      required: true, reason: "user-forced",
    });
  });
});

describe("UC-8 反证：简单提问不依赖阈值，恒 no-plan/false", () => {
  it("todoCount 恒为 0（简单提问从不触发 write_todos）⇒ 恒 required:false", () => {
    // 反证的机制事实：账本只有一个生产者（write_todos），简单提问不会调用它，
    // 所以 todoCount 恒为 0——这条路径不依赖 todoCount>=2 那条待定阈值。
    for (let i = 0; i < 5; i++) {
      expect(evaluatePlanGate({ todoCount: 0, userForced: false })).toEqual({
        required: false, reason: "no-plan",
      });
    }
  });
});

describe("UC-8：不失败（纯函数端口，err 数组为空）", () => {
  it("负数/超大 todoCount 也不抛异常（本用例只断言类型内的合法输入）", () => {
    expect(() => evaluatePlanGate({ todoCount: 100, userForced: false })).not.toThrow();
  });
});

/**
 * issue #2663 —— `taskRiskClass` 扩展点：低风险多步自动交付、高风险多步始终确认，
 * 风险等级优先于 `todoCount`；未传该字段时行为与改造前逐字一致（下一 describe 块）。
 */
describe("issue #2663 taskRiskClass：低/高风险分档", () => {
  it("multi_step_low_risk 且非 userForced ⇒ required:false，且 deliverPlan:true", () => {
    expect(
      evaluatePlanGate({ todoCount: 3, userForced: false, taskRiskClass: "multi_step_low_risk" }),
    ).toEqual({ required: false, reason: "multi-step-low-risk", deliverPlan: true });
  });

  it.each([
    { todoCount: 1, userForced: false },
    { todoCount: 2, userForced: false },
    { todoCount: 7, userForced: false },
  ])(
    "multi_step_high_risk ⇒ 恒 required:true ($todoCount, userForced=false)",
    ({ todoCount, userForced }) => {
      expect(
        evaluatePlanGate({ todoCount, userForced, taskRiskClass: "multi_step_high_risk" }),
      ).toEqual({ required: true, reason: "multi-step-high-risk" });
    },
  );

  it("multi_step_high_risk + userForced:true ⇒ required:true（userForced 优先，reason 仍是 user-forced）", () => {
    expect(
      evaluatePlanGate({ todoCount: 7, userForced: true, taskRiskClass: "multi_step_high_risk" }),
    ).toEqual({ required: true, reason: "user-forced" });
  });

  it("multi_step_high_risk 且 todoCount:1 仍 required:true——风险等级优先于步数", () => {
    expect(
      evaluatePlanGate({ todoCount: 1, userForced: false, taskRiskClass: "multi_step_high_risk" }),
    ).toEqual({ required: true, reason: "multi-step-high-risk" });
  });

  it("userForced:true 恒 required:true，不受 taskRiskClass 影响", () => {
    expect(
      evaluatePlanGate({ todoCount: 0, userForced: true, taskRiskClass: "multi_step_low_risk" }),
    ).toEqual({ required: true, reason: "user-forced" });
    expect(
      evaluatePlanGate({ todoCount: 5, userForced: true, taskRiskClass: "no_plan" }),
    ).toEqual({ required: true, reason: "user-forced" });
  });

  it("taskRiskClass: 'no_plan' 退回 todoCount 驱动表", () => {
    expect(
      evaluatePlanGate({ todoCount: 0, userForced: false, taskRiskClass: "no_plan" }),
    ).toEqual({ required: false, reason: "no-plan" });
    expect(
      evaluatePlanGate({ todoCount: 3, userForced: false, taskRiskClass: "no_plan" }),
    ).toEqual({ required: true, reason: "multi-step" });
  });
});

describe("issue #2663 回归：未传 taskRiskClass 时行为与改造前逐字一致", () => {
  it.each([
    { todoCount: 0, userForced: false, expected: { required: false, reason: "no-plan" } },
    { todoCount: 1, userForced: false, expected: { required: false, reason: "single-step" } },
    { todoCount: 2, userForced: false, expected: { required: true, reason: "multi-step" } },
    { todoCount: 7, userForced: false, expected: { required: true, reason: "multi-step" } },
    { todoCount: 0, userForced: true, expected: { required: true, reason: "user-forced" } },
    { todoCount: 5, userForced: true, expected: { required: true, reason: "user-forced" } },
  ])(
    "todoCount=$todoCount userForced=$userForced（无 taskRiskClass）-> $expected",
    ({ todoCount, userForced, expected }) => {
      expect(evaluatePlanGate({ todoCount, userForced })).toEqual(expected);
    },
  );
});
