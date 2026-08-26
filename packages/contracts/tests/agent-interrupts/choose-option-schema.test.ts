/**
 * F215（`agent-interrupts` 契约束）—— UC-3 `chooseExecutionOption` 的两条不变量：
 * I-5（`options` 长度 ∈ [2,3]）、I-6（resume 用 `optionId` 回指，不用数组下标）。
 *
 * `schema.test.ts`（F212）已经断言过基础形状；本文件是 F215 的独立机械判据，专门
 * 钉住 I-5 的**边界值**（1 与 4，而不只是"2 和 3 能过"）与 I-6 的**类型层面**保证
 * （`selectedOptionId` 是字符串 id，不是可以被误传成数组下标的数字）。
 */
import { describe, expect, it } from "vitest";
import {
  ChooseOptionArgs,
  ChooseOptionDecision,
  OptionCard,
  CHOOSE_OPTION_ALLOWED_DECISIONS,
} from "../../src/agent-interrupts";

const mkOption = (id: string) => ({
  optionId: id,
  title: `方案 ${id}`,
  effort: "低" as const,
  timeToValue: "即时",
  expectedReturn: "示例收益",
});

describe("F215 UC-3 chooseExecutionOption —— I-5：options 长度 ∈ [2,3]（边界值）", () => {
  it("0 项：拒绝", () => {
    expect(ChooseOptionArgs.safeParse({ requestId: "r1", options: [] }).success).toBe(false);
  });

  it("1 项：拒绝（下限之下）", () => {
    expect(ChooseOptionArgs.safeParse({ requestId: "r1", options: [mkOption("a")] }).success).toBe(false);
  });

  it("2 项：接受（下限，I-5 下限态）", () => {
    expect(
      ChooseOptionArgs.safeParse({ requestId: "r1", options: [mkOption("a"), mkOption("b")] }).success,
    ).toBe(true);
  });

  it("3 项：接受（上限）", () => {
    expect(
      ChooseOptionArgs.safeParse({
        requestId: "r1", options: [mkOption("a"), mkOption("b"), mkOption("c")],
      }).success,
    ).toBe(true);
  });

  it("4 项：拒绝（上限之上——「2–3 张」不是「至少 2 张」）", () => {
    expect(
      ChooseOptionArgs.safeParse({
        requestId: "r1", options: [mkOption("a"), mkOption("b"), mkOption("c"), mkOption("d")],
      }).success,
    ).toBe(false);
  });
});

describe("F215 UC-3 —— I-6：resume 用 optionId 回指，不用数组下标", () => {
  it("editedArgs 的字段名是 selectedOptionId（字符串 id），不是 selectedIndex/index 这类下标命名", () => {
    const shape = ChooseOptionDecision.safeParse({
      decision: "edit", editedArgs: { selectedOptionId: "opt-quickwin" },
    });
    expect(shape.success).toBe(true);
    if (shape.success && shape.data.decision === "edit") {
      expect(typeof shape.data.editedArgs.selectedOptionId).toBe("string");
    }
  });

  it("selectedOptionId 传数字（伪装成下标）在类型层面就被拒绝——防止「看起来像下标」的误用悄悄通过", () => {
    expect(
      ChooseOptionDecision.safeParse({ decision: "edit", editedArgs: { selectedIndex: 0 } }).success,
    ).toBe(false);
    expect(
      ChooseOptionDecision.safeParse({ decision: "edit", editedArgs: { selectedOptionId: 0 } }).success,
    ).toBe(false);
  });

  it("OptionCard.optionId 是稳定字符串 id 字段，且非空", () => {
    expect(OptionCard.safeParse(mkOption("opt-a")).success).toBe(true);
    expect(OptionCard.safeParse({ ...mkOption("opt-a"), optionId: "" }).success).toBe(false);
  });
});

describe("F215 UC-3 —— allowedDecisions=[edit, reject]（design-signoff 裁决②）", () => {
  it("approve 与 respond 都不在 ChooseOptionDecision 的合法判别集合里", () => {
    expect(ChooseOptionDecision.safeParse({ decision: "approve" }).success).toBe(false);
    expect(ChooseOptionDecision.safeParse({ decision: "respond" }).success).toBe(false);
  });

  it("reject（都不要逃生口）合法，且不需要 editedArgs", () => {
    expect(ChooseOptionDecision.safeParse({ decision: "reject" }).success).toBe(true);
  });

  it("CHOOSE_OPTION_ALLOWED_DECISIONS 常量恰好是 [edit, reject]，供实现期直接引用不手写字面量", () => {
    expect(CHOOSE_OPTION_ALLOWED_DECISIONS).toEqual(["edit", "reject"]);
  });
});
