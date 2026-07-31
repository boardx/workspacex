import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  evaluateQuotaDowngrade,
  quotaThresholdReached,
  type QuotaUsage,
} from "../../src/domain/templates/quota-policy";
import { validateModelStrategy } from "../../src/domain/templates/model-strategy";
import type { SelectableCandidateRow } from "../../src/domain/model/selectable";

/**
 * F20 —— **机密材料仅本地、不被配额降级覆盖**（I-21，`uc-2-1` R7「与原型对齐 proto-03
 * 『含客户机密 → 禁止降级』」，V10 后半句）。
 *
 * 「隐私硬路由优先级高于配额降级」不是一句形容词——本文件把「用量已经超过阈值」
 * 和「这次调用属于机密 lane」同时给到判定函数，断言机密 lane **仍然**不降级。
 * 只测「机密 lane 从不降级」而不把「用量已超阈值」同时喂进去，等于没测到 I-21
 * 真正要防的那个时刻：**配额压力下**是否还守得住硬路由。
 */

function usage(usedRatio: number, budget = 3_500_000, downgradeAtRatio = 0.9): QuotaUsage {
  return {
    usedTokens: Math.round(budget * usedRatio),
    perSessionTokenBudget: budget,
    downgradeAtRatio,
  };
}

describe("机密 lane 在配额达阈值时仍不降级", () => {
  it("用量远超 90% 阈值（99%），非机密 lane 会降级，机密 lane 不会", () => {
    const overBudget = usage(0.99);
    expect(quotaThresholdReached(overBudget)).toBe(true);

    const onsiteVerdict = evaluateQuotaDowngrade(overBudget, "onsite");
    expect(onsiteVerdict.downgraded).toBe(true);

    const confidentialVerdict = evaluateQuotaDowngrade(overBudget, "confidential");
    expect(confidentialVerdict).toEqual({ downgraded: false, hardStop: false, visibleNotice: null });
  });

  it("用量恰好触发阈值（用满预算 100%）—— 机密 lane 依旧不降级", () => {
    const exhausted = usage(1.0);
    expect(evaluateQuotaDowngrade(exhausted, "confidential").downgraded).toBe(false);
    expect(evaluateQuotaDowngrade(exhausted, "postSession").downgraded).toBe(true);
  });

  it("远低于阈值时机密 lane 本来就不该降级 —— 这条不构成「防线生效」的证据", () => {
    // 反证：如果只测这条就收工，一个「机密 lane 永远返回 downgraded:false 而不看用量」
    // 的错误实现也能让它通过——必须靠上面「超阈值仍不降级」那条来分辨。
    const low = usage(0.1);
    expect(evaluateQuotaDowngrade(low, "confidential").downgraded).toBe(false);
    expect(evaluateQuotaDowngrade(low, "onsite").downgraded).toBe(false);
  });

  it("hardStop 恒为 false —— 机密 lane 不降级不代表被拒绝调用", () => {
    const overBudget = usage(0.99);
    expect(evaluateQuotaDowngrade(overBudget, "confidential").hardStop).toBe(false);
    expect(templates.QuotaPolicy.shape.hardStop.safeParse(true).success).toBe(false);
    expect(templates.QuotaPolicy.shape.hardStop.safeParse(false).success).toBe(true);
  });
});

describe("机密硬路由与配额降级是两条独立的防线，结论必须一致", () => {
  const pool: SelectableCandidateRow[] = [
    { modelId: "qwen3-local", kind: "self-hosted", shape: "single", status: "已启用", complianceAttrs: [], members: [] },
    { modelId: "sonnet-4.6", kind: "closed-api", shape: "single", status: "已启用", complianceAttrs: [], members: [] },
  ];

  it("配额达阈值不会让 model-strategy 的硬路由校验松口 —— 机密 lane 选云端模型仍被拒", () => {
    // 「达配额阈值」本身不出现在 validateModelStrategy 的参数里——它压根不该有一个
    // 「配额紧张时放宽机密校验」的分支，这正是 I-21「优先级高于」的字面意思。
    const verdict = validateModelStrategy(
      { onsite: "sonnet-4.6", postSession: "sonnet-4.6", confidential: "sonnet-4.6" },
      pool,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.code).toBe("CONFIDENTIAL_ROUTE_VIOLATION");
  });
});
