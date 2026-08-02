/**
 * F95 —— 虚拟来源隔离必须服务端强制，不是按钮置灰 (`uc-6-5` R3 step8, AC3/V3,
 * D-25，契约 `markStrongInsight`/`referenceForDecision` 的 `VIRTUAL_SOURCE_FORBIDDEN`)。
 *
 * ⚠ 纯逻辑单测，不连数据库（issue #74：本地不跑任何需要 Postgres 的测试）。
 *
 * 本文件的断言看的是"接口层门"本身，不是渲染结果——一个只在前端把
 * 「标为强洞察」按钮置灰的实现，组件测试会全绿，而任何直接调接口的人
 * （脚本 / 另一个前端 / agent）都能绕过去。所以这里直接调用两个接口各自
 * 会调用的同一道门函数，断言它对虚拟来源**总是**拒绝。
 */
import { describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import {
  checkMarkStrongAllowed,
  checkReferenceForDecisionAllowed,
  checkSourceAllowsStrongUse,
} from "../../src/domain/interview/insight-source-gate";

describe("F95 · AC3/V3 · 虚拟来源标强 ⇒ VIRTUAL_SOURCE_FORBIDDEN（接口层拒绝）", () => {
  it("markStrongInsight 门：sourceKind=virtual 被拒绝", () => {
    const result = checkMarkStrongAllowed({ sourceKind: "virtual" });
    expect(result).toEqual({ ok: false, reason: "VIRTUAL_SOURCE_FORBIDDEN" });
  });

  it("markStrongInsight 门：sourceKind=human 放行", () => {
    const result = checkMarkStrongAllowed({ sourceKind: "human" });
    expect(result).toEqual({ ok: true });
  });

  it("契约 markStrongInsight.err 收录 VIRTUAL_SOURCE_FORBIDDEN", () => {
    expect(interview.operations.markStrongInsight.err).toContain("VIRTUAL_SOURCE_FORBIDDEN");
  });
});

describe("F95 · AC3/V3 · 虚拟来源引用为决策依据 ⇒ VIRTUAL_SOURCE_FORBIDDEN（同一道门，I-28）", () => {
  it("referenceForDecision 门：sourceKind=virtual 被拒绝", () => {
    const result = checkReferenceForDecisionAllowed({ sourceKind: "virtual" });
    expect(result).toEqual({ ok: false, reason: "VIRTUAL_SOURCE_FORBIDDEN" });
  });

  it("referenceForDecision 门：sourceKind=human 放行", () => {
    const result = checkReferenceForDecisionAllowed({ sourceKind: "human" });
    expect(result).toEqual({ ok: true });
  });

  it("契约 referenceForDecision.err 收录 VIRTUAL_SOURCE_FORBIDDEN", () => {
    expect(interview.operations.referenceForDecision.err).toContain("VIRTUAL_SOURCE_FORBIDDEN");
  });

  it("两个接口复用的是同一个门函数，不是两处各自判一次", () => {
    expect(checkMarkStrongAllowed).toBe(checkSourceAllowsStrongUse);
    expect(checkReferenceForDecisionAllowed).toBe(checkSourceAllowsStrongUse);
  });
});

describe("F95 · 反证：若门只判断调用方角色而不看 sourceKind，上面两条断言必须红", () => {
  it("逐字重放「永远放行」的坏实现，断言其在虚拟来源上会错误通过", () => {
    const alwaysAllow = (): { ok: true } => ({ ok: true });
    // 坏实现对虚拟来源也放行——用它复算一次，证明真实实现与它不同。
    expect(alwaysAllow()).toEqual({ ok: true });
    expect(checkSourceAllowsStrongUse({ sourceKind: "virtual" })).not.toEqual(alwaysAllow());
  });

  it("门函数只依赖 sourceKind 这一个字段：混入无关字段不影响判定", () => {
    const virtualInsight = {
      sourceKind: "virtual" as const,
      insightId: "ins-x",
      text: "无关字段不应改变判定",
      strong: false,
      evidenceQuoteIds: ["q1"],
      pinnedSourceSnapshotId: null,
    };
    expect(() => interview.Insight.parse(virtualInsight)).not.toThrow();
    expect(checkSourceAllowsStrongUse(virtualInsight)).toEqual({
      ok: false,
      reason: "VIRTUAL_SOURCE_FORBIDDEN",
    });
  });
});
