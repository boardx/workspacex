/**
 * issue #3132（B7）—— `buildDeepAgentKernelFields` 的单测。
 *
 * 这个模块是从 `execute-run.ts` 抽出来的（棘轮门 R7：网关不许再膨胀），所以断言的
 * 重点是**键的缺席与在场**，不是值：内核侧把「键不在」和「键在但是空的」当两件事解
 * （`hitlSkillNames` 缺席 = "每次都问" 的 fail-closed 默认；空数组 = "算过了，一个都不用问"）。
 * 用 `toHaveProperty` / `in` 而不是比较 `undefined`，否则「总是返回全部键、缺的填
 * undefined」这种改法能骗过全部断言。
 */
import { describe, expect, it } from "vitest";
import { PLAN_CONFIRM_MIN_STEPS } from "@repo/contracts/plan-control";
import { buildDeepAgentKernelFields } from "../../src/application/agent-run/deep-agent-kernel-fields";
import type { SkillRiskEntry } from "../../src/domain/agent-run/skill-risk-level";

const RISKS: readonly SkillRiskEntry[] = [
  { stableName: "safe-reader", riskLevel: "L0" },
  { stableName: "danger-writer", riskLevel: "L2" },
  { stableName: "middle", riskLevel: "L1" },
];

describe("buildDeepAgentKernelFields（#3132 B7 从 execute-run.ts 抽出）", () => {
  it("非 deep-agent run：一个字段都不填（连键都不出现）", () => {
    const fields = buildDeepAgentKernelFields({
      isDeepAgentRun: false, mountedSkillCount: 3, skillRisks: RISKS,
    });
    expect(Object.keys(fields)).toEqual([]);
    expect("planConfirmMinSteps" in fields).toBe(false);
    expect("hitlSkillNames" in fields).toBe(false);
  });

  it("deep-agent run：`planConfirmMinSteps` 一律填，且取契约常量而不是本地又定一个数字", () => {
    const fields = buildDeepAgentKernelFields({
      isDeepAgentRun: true, mountedSkillCount: 0, skillRisks: [],
    });
    expect(fields.planConfirmMinSteps).toBe(PLAN_CONFIRM_MIN_STEPS);
  });

  it("计划确认门不看挂了几个 skill——一个 skill 都没挂时 `planConfirmMinSteps` 仍在场", () => {
    const fields = buildDeepAgentKernelFields({
      isDeepAgentRun: true, mountedSkillCount: 0, skillRisks: [],
    });
    expect("planConfirmMinSteps" in fields).toBe(true);
    // 同一次调用里 `hitlSkillNames` 必须缺席：两个字段的条件确实是独立的，
    // 不是「一起有一起无」。
    expect("hitlSkillNames" in fields).toBe(false);
  });

  it("deep-agent run 且挂了 skill：`hitlSkillNames` 只投影 L2 的那些", () => {
    const fields = buildDeepAgentKernelFields({
      isDeepAgentRun: true, mountedSkillCount: RISKS.length, skillRisks: RISKS,
    });
    expect(fields.hitlSkillNames).toEqual(["danger-writer"]);
  });

  it("挂了 skill 但全是 L0/L1：投影空数组（键在场），而不是退回缺席的 fail-closed 默认", () => {
    const fields = buildDeepAgentKernelFields({
      isDeepAgentRun: true,
      mountedSkillCount: 2,
      skillRisks: [
        { stableName: "safe-reader", riskLevel: "L0" },
        { stableName: "middle", riskLevel: "L1" },
      ],
    });
    expect("hitlSkillNames" in fields).toBe(true);
    expect(fields.hitlSkillNames).toEqual([]);
  });
});
