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
