/**
 * F130 ⑴ · I-28′ -- `checkToolScopeCap` as a pure function (same shape as
 * `checkProjectsColumnSet`): `rank(authScope) <= maxScopeFor(sideEffect)`, taken/exposed via
 * `@repo/contracts/agent-runtime` and callable with zero HTTP / DB.
 *
 * ⚠ **Four-cell, not "reject N times"** (notes ⑷, discipline items 9/10): a suite that only
 * asserts the over-cap side is rejected goes fully green against a "reject everything"
 * implementation. The ⭐-marked compliant-value cases below are what catches that -- this
 * repo has hit exactly this shape of hollow gate nine times.
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";

describe("F130 ⑴ I-28′ · checkToolScopeCap -- 纯函数、可脱 HTTP 直测", () => {
  it("越界被拒：对外发送 × 全体成员 ⇒ 拒 + TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP", () => {
    const r = AR.checkToolScopeCap({ sideEffect: "对外发送", authScope: "全体成员" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP");
  });

  it("越界被拒：写入外部 × 仅某团队 ⇒ 拒", () => {
    const r = AR.checkToolScopeCap({ sideEffect: "写入外部", authScope: "仅某团队" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP");
  });

  it("⭐ 合规值通过：对外发送 × 需人工确认每次 ⇒ 通过（缺这一格，『一律拒绝』会全绿）", () => {
    const r = AR.checkToolScopeCap({ sideEffect: "对外发送", authScope: "需人工确认每次" });
    expect(r.ok).toBe(true);
  });

  it("⭐ 合规值通过：对外发送 × 未开放 ⇒ 通过", () => {
    const r = AR.checkToolScopeCap({ sideEffect: "对外发送", authScope: "未开放" });
    expect(r.ok).toBe(true);
  });

  it("⭐ 合规值通过：只读 × 全体成员 ⇒ 通过", () => {
    const r = AR.checkToolScopeCap({ sideEffect: "只读", authScope: "全体成员" });
    expect(r.ok).toBe(true);
  });

  it("边界恰好：只读 × 全体成员 通过 ∧ 对外发送 × 仅项目负责人 被拒（封顶取错一档就会被此格抓到）", () => {
    const readAll = AR.checkToolScopeCap({ sideEffect: "只读", authScope: "全体成员" });
    const egressOwner = AR.checkToolScopeCap({ sideEffect: "对外发送", authScope: "仅项目负责人" });
    expect(readAll.ok).toBe(true);
    expect(egressOwner.ok).toBe(false);
  });

  it("写入外部的封顶恰好是「需人工确认每次」这一档，不多不少", () => {
    expect(AR.checkToolScopeCap({ sideEffect: "写入外部", authScope: "需人工确认每次" }).ok).toBe(true);
    expect(AR.checkToolScopeCap({ sideEffect: "写入外部", authScope: "仅项目负责人" }).ok).toBe(false);
  });

  it("穷举：3 副作用 × 5 授权范围 = 15 格，结果恰好等于 rank(authScope) <= maxScopeFor(sideEffect)", () => {
    for (const sideEffect of AR.ToolSideEffect.options) {
      for (const authScope of AR.ToolAuthScope.options) {
        const r = AR.checkToolScopeCap({ sideEffect, authScope });
        const expected =
          AR.TOOL_AUTH_SCOPE_RANK[authScope] <= AR.MAX_SCOPE_RANK_FOR_SIDE_EFFECT[sideEffect];
        expect(r.ok, `sideEffect=${sideEffect} authScope=${authScope}`).toBe(expected);
      }
    }
  });

  it("拒绝时带上 maxAllowedRank / requestedRank，供界面说清楚差多少而不是只说「不行」", () => {
    const r = AR.checkToolScopeCap({ sideEffect: "对外发送", authScope: "全体成员" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.requestedRank).toBe(AR.TOOL_AUTH_SCOPE_RANK["全体成员"]);
      expect(r.maxAllowedRank).toBe(AR.TOOL_AUTH_SCOPE_RANK["需人工确认每次"]);
    }
  });
});
