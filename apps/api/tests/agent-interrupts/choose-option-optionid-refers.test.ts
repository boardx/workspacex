/**
 * F215（`agent-interrupts` 契约束）—— UC-3 `chooseExecutionOption` 的
 * `SELECTED_OPTION_NOT_FOUND` 守卫：`apps/api/src/application/agent-interrupts/
 * choose-option-decision.ts` 的 `resolveChooseOptionDecision`。范围边界见该文件头。
 *
 * I-6 反证核心：selectedOptionId ∉ 原始 options[].optionId 集合 ⇒
 * SELECTED_OPTION_NOT_FOUND；且选项数组重排后仍按 id 命中正确项（不静默选错）。
 */
import { describe, expect, it } from "vitest";
import { resolveChooseOptionDecision } from "../../src/application/agent-interrupts/choose-option-decision";
import type { ChooseOptionArgs, ChooseOptionDecision } from "@repo/contracts/agent-interrupts";

const mkOption = (id: string, title: string) => ({
  optionId: id, title, effort: "低" as const, timeToValue: "即时", expectedReturn: `${title}的收益`,
});

const ORIGINAL_OPTIONS: ChooseOptionArgs["options"] = [
  mkOption("opt-quickwin", "先做快赢清单"),
  mkOption("opt-experiment", "小流量 A/B 实验"),
  mkOption("opt-deepdive", "渠道归因深挖"),
];

describe("F215 UC-3 —— I-6：optionId 不在原始集合里 ⇒ SELECTED_OPTION_NOT_FOUND", () => {
  it("selectedOptionId 命中原始集合中的一项 ⇒ resolved，且返回的是那一项本身", () => {
    const decision: ChooseOptionDecision = {
      decision: "edit", editedArgs: { selectedOptionId: "opt-experiment" },
    };
    const result = resolveChooseOptionDecision(ORIGINAL_OPTIONS, decision);
    expect(result).toEqual({ kind: "resolved", option: mkOption("opt-experiment", "小流量 A/B 实验") });
  });

  it("selectedOptionId 不在原始集合里（伪造/过期 id）⇒ SELECTED_OPTION_NOT_FOUND，不静默执行错误方案", () => {
    const decision: ChooseOptionDecision = {
      decision: "edit", editedArgs: { selectedOptionId: "opt-does-not-exist" },
    };
    const result = resolveChooseOptionDecision(ORIGINAL_OPTIONS, decision);
    expect(result).toEqual({ kind: "error", code: "SELECTED_OPTION_NOT_FOUND" });
  });

  it("选项数组重排后仍按 id 命中正确项——不是「凑巧下标对上」", () => {
    const reordered = [...ORIGINAL_OPTIONS].reverse();
    const decision: ChooseOptionDecision = {
      decision: "edit", editedArgs: { selectedOptionId: "opt-quickwin" },
    };
    // 重排前 "opt-quickwin" 在下标 0，重排后在下标 2——如果实现偷偷按下标寻址，
    // 这条断言会失败（拿到 reordered[0] = "渠道归因深挖"，而不是 quickwin）。
    const result = resolveChooseOptionDecision(reordered, decision);
    expect(result).toEqual({ kind: "resolved", option: mkOption("opt-quickwin", "先做快赢清单") });
  });

  it("reject（都不要）⇒ declined，不查找选项、不报 SELECTED_OPTION_NOT_FOUND", () => {
    const decision: ChooseOptionDecision = { decision: "reject" };
    expect(resolveChooseOptionDecision(ORIGINAL_OPTIONS, decision)).toEqual({ kind: "declined" });
  });

  it("边界：只有 2 项时的选择——I-5 下限态与 I-6 守卫互不干扰", () => {
    const twoOptions = ORIGINAL_OPTIONS.slice(0, 2);
    const decision: ChooseOptionDecision = {
      decision: "edit", editedArgs: { selectedOptionId: "opt-quickwin" },
    };
    expect(resolveChooseOptionDecision(twoOptions, decision).kind).toBe("resolved");
  });
});
