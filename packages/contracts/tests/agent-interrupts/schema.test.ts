/**
 * F212（`agent-interrupts` 契约束）—— zod schema 行为断言。
 *
 * 覆盖 `domain.md` 五节的不变量：I-2（confirm_intent assumptions ≥2）、
 * I-3（fill_params 有猜测必有依据）、I-5（choose_option options ∈ [2,3]）、
 * I-6（choose_option resume 用 optionId 回指）；以及 `usecases.md` 顶部
 * 统一失败枚举 `AgentInterruptError`（8 正式码 + 1 占位码）完整性。
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_INTERRUPTS_TOOL_NAMES,
  AGENT_INTERRUPTS_TOOL_NAME_LIST,
  AgentInterruptKind,
  AGENT_INTERRUPT_KIND_TO_TOOL_NAME,
  ConfirmIntentArgs,
  ConfirmIntentDecision,
  ParamField,
  FillParamsArgs,
  FillParamsDecision,
  OptionCard,
  ChooseOptionArgs,
  ChooseOptionDecision,
  CHOOSE_OPTION_ALLOWED_DECISIONS,
  AgentInterruptError,
} from "../../src/agent-interrupts";

describe("F212 agent-interrupts — 工具名单一事实源（不变量 I-7）", () => {
  it("三个工具名互不相同", () => {
    const names = Object.values(AGENT_INTERRUPTS_TOOL_NAMES);
    expect(new Set(names).size).toBe(names.length);
    expect(AGENT_INTERRUPTS_TOOL_NAME_LIST).toEqual(names);
  });

  it("kind → 工具名映射与工具名常量同源", () => {
    for (const kind of AgentInterruptKind.options) {
      expect(AGENT_INTERRUPT_KIND_TO_TOOL_NAME[kind]).toBeDefined();
      expect(AGENT_INTERRUPTS_TOOL_NAME_LIST).toContain(AGENT_INTERRUPT_KIND_TO_TOOL_NAME[kind]);
    }
  });
});

describe("UC-1 confirmTaskIntent —— 目标复述卡", () => {
  it("assumptions 少于 2 条被拒（不变量 I-2）", () => {
    expect(
      ConfirmIntentArgs.safeParse({ requestId: "r1", understanding: "u", assumptions: ["only one"] }).success,
    ).toBe(false);
    expect(
      ConfirmIntentArgs.safeParse({ requestId: "r1", understanding: "u", assumptions: ["a", "b"] }).success,
    ).toBe(true);
  });

  it("out 的 approve/edit 两分支都能被 discriminatedUnion 判别", () => {
    expect(ConfirmIntentDecision.safeParse({ decision: "approve" }).success).toBe(true);
    expect(
      ConfirmIntentDecision.safeParse({ decision: "edit", editedArgs: { assumptions: ["a", "b"] } }).success,
    ).toBe(true);
    expect(
      ConfirmIntentDecision.safeParse({ decision: "edit", editedArgs: { assumptions: ["only one"] } }).success,
    ).toBe(false);
  });
});

describe("UC-2 fillRunParams —— 参数补全表单", () => {
  it("有猜测无依据被拒（不变量 I-3）", () => {
    expect(
      ParamField.safeParse({
        name: "n",
        label: "l",
        aiGuess: "guessed",
        rationale: null,
        required: true,
        currentValue: null,
      }).success,
    ).toBe(false);
    expect(
      ParamField.safeParse({
        name: "n",
        label: "l",
        aiGuess: "guessed",
        rationale: "近 6 份月报都用同比",
        required: true,
        currentValue: null,
      }).success,
    ).toBe(true);
    // aiGuess === null 时无需 rationale。
    expect(
      ParamField.safeParse({
        name: "n",
        label: "l",
        aiGuess: null,
        rationale: null,
        required: true,
        currentValue: null,
      }).success,
    ).toBe(true);
  });

  it("appliedTo 只允许两态（design-signoff §六 决策①：知情降级），不接受第三个值", () => {
    const edit = {
      decision: "edit" as const,
      editedArgs: { fields: [{ name: "n", value: "v" }] },
      appliedTo: "full-rerun" as const,
    };
    expect(FillParamsDecision.safeParse(edit).success).toBe(true);
    expect(FillParamsDecision.safeParse({ ...edit, appliedTo: "selective-rerun" }).success).toBe(false);
  });

  it("FillParamsArgs 接纳一组 ParamField", () => {
    expect(
      FillParamsArgs.safeParse({
        requestId: "r1",
        fields: [{ name: "n", label: "l", aiGuess: null, rationale: null, required: false, currentValue: null }],
      }).success,
    ).toBe(true);
  });
});

describe("UC-3 chooseExecutionOption —— 多方案对比", () => {
  const mkOption = (id: string) => ({
    optionId: id,
    title: id,
    effort: "中" as const,
    timeToValue: "≈2 天",
    expectedReturn: "中",
  });

  it("options 长度必须在 2–3 之间（不变量 I-5）", () => {
    expect(ChooseOptionArgs.safeParse({ requestId: "r1", options: [mkOption("a")] }).success).toBe(false);
    expect(
      ChooseOptionArgs.safeParse({ requestId: "r1", options: [mkOption("a"), mkOption("b")] }).success,
    ).toBe(true);
    expect(
      ChooseOptionArgs.safeParse({
        requestId: "r1",
        options: [mkOption("a"), mkOption("b"), mkOption("c"), mkOption("d")],
      }).success,
    ).toBe(false);
  });

  it("resume 用 optionId 回指（不变量 I-6），out 走 edit（design-signoff §六 决策②），reject 作为逃生口保留", () => {
    expect(
      ChooseOptionDecision.safeParse({ decision: "edit", editedArgs: { selectedOptionId: "a" } }).success,
    ).toBe(true);
    expect(ChooseOptionDecision.safeParse({ decision: "reject" }).success).toBe(true);
    expect(ChooseOptionDecision.safeParse({ decision: "approve" }).success).toBe(false);
    expect(ChooseOptionDecision.safeParse({ decision: "respond" }).success).toBe(false);
  });

  it("allowedDecisions 恰好是 edit 与 reject，不含 approve/respond", () => {
    expect([...CHOOSE_OPTION_ALLOWED_DECISIONS].sort()).toEqual(["edit", "reject"]);
  });

  it("OptionCard 的三项固定对照字段齐全", () => {
    expect(
      OptionCard.safeParse({
        optionId: "a",
        title: "方案 A",
        effort: "低",
        timeToValue: "即时",
        expectedReturn: "小幅提升",
      }).success,
    ).toBe(true);
  });
});

describe("统一失败枚举 AgentInterruptError", () => {
  it("八个正式码 + 一个占位码，逐字对应 usecases.md 顶部约定", () => {
    expect([...AgentInterruptError.options].sort()).toEqual(
      [
        "NOT_VISIBLE",
        "NO_WRITE_ROLE",
        "NO_ACTIVE_INTERRUPT",
        "INTERRUPT_KIND_MISMATCH",
        "STALE_INTERRUPT",
        "MALFORMED_RESUME_PAYLOAD",
        "SELECTED_OPTION_NOT_FOUND",
        "AUDIT_SINK_UNAVAILABLE",
        "FIELD_REQUIRED_BLANK",
      ].sort(),
    );
  });
});
