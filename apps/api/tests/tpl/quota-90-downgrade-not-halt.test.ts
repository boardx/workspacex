import { describe, expect, it } from "vitest";
import { templates } from "@repo/contracts";
import {
  evaluateQuotaDowngrade,
  quotaThresholdReached,
  type QuotaUsage,
} from "../../src/domain/templates/quota-policy";

/**
 * F20 —— **配额与降级：达 90% 自动降级、可见提示、不硬停**（`uc-2-1` R3 步骤 6 / R7 /
 * V11）。原型原话：「现场卡住比多花钱贵」——所以本文件的每一条断言都在证明
 * **降级发生了但调用没被拒绝**，而不是反过来。
 *
 * ⚠ 断言写成参数化的比例（`downgradeAtRatio`），不写死「0.9」——蓝本可以配别的阈值，
 * 门的判定语句是「用量占比 ≥ 配置的比例」，与那个比例具体是多少无关（呼应
 * `required-column-drives-gate.test.ts` 的纪律：判定语句与具体取值无关）。
 */

function usage(usedTokens: number, budget: number, downgradeAtRatio: number): QuotaUsage {
  return { usedTokens, perSessionTokenBudget: budget, downgradeAtRatio };
}

describe("默认预算 3.5M、90% 阈值：跨阈值前后各断言一次", () => {
  const budget = 3_500_000;
  const ratio = 0.9;

  it("89% 用量：未达阈值，不降级、无提示", () => {
    const u = usage(Math.round(budget * 0.89), budget, ratio);
    expect(quotaThresholdReached(u)).toBe(false);
    const verdict = evaluateQuotaDowngrade(u, "onsite");
    expect(verdict).toEqual({ downgraded: false, hardStop: false, visibleNotice: null });
  });

  it("恰好 90% 用量：达阈值，自动降级 + 提示非空 + 不硬停", () => {
    const u = usage(Math.round(budget * ratio), budget, ratio);
    expect(quotaThresholdReached(u)).toBe(true);
    const verdict = evaluateQuotaDowngrade(u, "postSession");
    expect(verdict.downgraded).toBe(true);
    expect(verdict.hardStop).toBe(false);
    expect(typeof verdict.visibleNotice).toBe("string");
    expect((verdict.visibleNotice ?? "").length).toBeGreaterThan(0);
  });

  it("超过 90%（99%）：仍然只降级、不硬停 —— 越紧张也不中断现场", () => {
    const u = usage(Math.round(budget * 0.99), budget, ratio);
    const verdict = evaluateQuotaDowngrade(u, "onsite");
    expect(verdict.downgraded).toBe(true);
    expect(verdict.hardStop).toBe(false);
  });
});

describe("阈值判定语句与「是不是 90%」无关（参数化）", () => {
  it("阈值配成 0.5 时，50% 用量即降级；配成 0.99 时，90% 用量不降级", () => {
    const lowThreshold = usage(500_000, 1_000_000, 0.5);
    expect(quotaThresholdReached(lowThreshold)).toBe(true);

    const highThreshold = usage(900_000, 1_000_000, 0.99);
    expect(quotaThresholdReached(highThreshold)).toBe(false);
  });

  it("提示文案里的百分比随 downgradeAtRatio 变化，不是写死的『90%』", () => {
    const at50 = usage(500_000, 1_000_000, 0.5);
    const verdict = evaluateQuotaDowngrade(at50, "onsite");
    expect(verdict.visibleNotice).toContain("50%");
    expect(verdict.visibleNotice).not.toContain("90%");
  });
});

describe("hardStop 在契约层面就不可配为 true —— 不是实现层面『恰好没写』", () => {
  it("QuotaPolicy.hardStop 只接受 false，true 会被 zod 拒绝", () => {
    expect(templates.QuotaPolicy.shape.hardStop.safeParse(true).success).toBe(false);
    expect(templates.QuotaPolicy.shape.hardStop.safeParse(false).success).toBe(true);
  });

  it("setQuotaPolicy 的失败面里没有任何『达阈值即拒绝调用』式的错误码", () => {
    // 反证：确认契约错误面只有找不到/无权限/依赖不可用三类，没有配额类拒绝码——
    // 达阈值这件事在契约里本来就不该有一个可以让调用失败的码。
    expect(templates.operations.setQuotaPolicy.err).toEqual([
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "DEPENDENCY_UNAVAILABLE",
    ]);
  });
});
