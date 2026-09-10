/**
 * issue #3310 —— 「已裁决的那一条中断」是服务端拥有的事实，且它要按**被采纳的编辑值**
 * 呈现，不是模型最初的提案。
 *
 * 人类实测（devapp `6df8148cc`）：模型复述「为**舟山**马鞍岛的房产中介生成用户画像」，
 * 用户点「改假设」把舟山改成中山并确认，卡片此后一直画着舟山。取证结论见
 * `decided-interrupt.ts` 头注：编辑值确实到了服务端与后续执行，**断的是展示**。
 */
import { describe, expect, it } from "vitest";
import { applyEditedInterruptArgs } from "../../src/application/agent-run/decided-interrupt";
import { validateInterruptDecision } from "../../src/application/agent-run/validate-interrupt-decision";
import type { RestorableInterrupt } from "@repo/contracts/agent-interrupts";

const PROPOSED: RestorableInterrupt = {
  toolName: "confirm_task_intent",
  args: { requestId: "req-1", understanding: "为舟山马鞍岛的一位房产中介生成用户画像", assumptions: ["服务区域是舟山马鞍岛"] },
};

describe("#3310 ② 展示用的中断快照合入被采纳的编辑值", () => {
  it("改过的假设与理解都落到展示快照上，舟山一个字不留", () => {
    const decided = applyEditedInterruptArgs(PROPOSED, JSON.stringify({
      understanding: "为中山马鞍岛的一位房产中介生成用户画像",
      assumptions: ["服务区域是中山马鞍岛"],
    }));
    expect(JSON.stringify(decided)).not.toContain("舟山");
    expect(JSON.stringify(decided)).toContain("中山马鞍岛");
    // requestId 是这条记录的身份，编辑不许动它——界面靠它认出「就是我刚才确认的那一条」。
    expect(decided.args).toMatchObject({ requestId: "req-1" });
  });

  it("合不上时逐字回落到原提案，绝不编一份出来，也不因此丢掉这条记录", () => {
    for (const broken of [null, undefined, "not json", "[]", JSON.stringify({ assumptions: [""] })]) {
      expect(applyEditedInterruptArgs(PROPOSED, broken)).toEqual(PROPOSED);
    }
  });

  it("fill_run_params 的 {name,value} 精简形状合进 currentValue，不整块覆盖 ParamField", () => {
    const form: RestorableInterrupt = { toolName: "fill_run_params", args: { requestId: "r", fields: [
      { name: "region", label: "地区", aiGuess: "舟山", rationale: "来自原文", required: true, currentValue: null },
    ] } };
    const decided = applyEditedInterruptArgs(form, JSON.stringify({ fields: [{ name: "region", value: "中山" }] }));
    expect(decided.args).toMatchObject({ fields: [{ name: "region", label: "地区", rationale: "来自原文", currentValue: "中山" }] });
  });
});

describe("#3310 ② edit 决策的白名单接受 understanding，且没有被放宽成任意键", () => {
  it("assumptions + understanding 通过", () => {
    expect(validateInterruptDecision(PROPOSED, { decision: "edit", editedArgs: {
      assumptions: ["服务区域是中山马鞍岛"], understanding: "为中山马鞍岛的一位房产中介生成用户画像",
    } })).toBe(true);
  });
  it("只有 assumptions（用户没改那句话）仍然通过", () => {
    expect(validateInterruptDecision(PROPOSED, { decision: "edit", editedArgs: { assumptions: ["x"] } })).toBe(true);
  });
  it("白名单之外的键（含 requestId 这种身份字段）一律拒绝", () => {
    expect(validateInterruptDecision(PROPOSED, { decision: "edit", editedArgs: { assumptions: ["x"], requestId: "别的" } })).toBe(false);
    expect(validateInterruptDecision(PROPOSED, { decision: "edit", editedArgs: { assumptions: ["x"], toolName: "别的" } })).toBe(false);
  });
  it("空 understanding 不是合法编辑（契约 min(1)）", () => {
    expect(validateInterruptDecision(PROPOSED, { decision: "edit", editedArgs: { assumptions: ["x"], understanding: "" } })).toBe(false);
  });
});
