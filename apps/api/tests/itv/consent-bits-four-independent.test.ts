/**
 * F87 —— 四项同意位彼此独立 + `[全部拒绝]` 合法完整 + 服务端分发（uc-6-3 R3/R7/R12 V1/V6）。
 *
 * 纯单元测试，不连 Postgres（issue #74：本地只保证纯测试与 typecheck）。覆盖两层：
 *   ① `submitConsent`（F86 编排）——bits 原样落库，不做任何校验或改写，
 *      全部拒绝与任意组合都被同等接受。
 *   ② `deriveConsentDistribution`（F87 新增，domain/interview/consent-distribution.ts）——
 *      四条链路的服务端过滤器：录音/转写/AI 分析三者级联，署名与其余三者完全独立。
 */
import { describe, expect, it } from "vitest";
import { submitConsent } from "../../src/application/interview/submit-consent";
import {
  deriveConsentDistribution,
  type ConsentDistribution,
} from "../../src/domain/interview/consent-distribution";
import type { ConsentBitsValue as ConsentBits } from "../../src/application/interview/consent-token-ports";
import {
  InMemoryConsentSnapshotRepository,
  InMemoryPortalTokenRepository,
  InMemorySigningTokenRepository,
  FixedConsentRenderParamsProvider,
} from "../../src/infrastructure/interview/in-memory-consent-token-repository";

const RENDER_PARAMS = {
  retentionDays: 180,
  dataController: "远洋咨询",
  contactName: "林可",
  complianceEmail: "compliance@example.com",
};

function harness() {
  const signingTokens = new InMemorySigningTokenRepository();
  const portalTokens = new InMemoryPortalTokenRepository();
  const snapshots = new InMemoryConsentSnapshotRepository();
  const renderParams = new FixedConsentRenderParamsProvider(new Map([["itv-1", RENDER_PARAMS]]));
  return { signingTokens, portalTokens, snapshots, renderParams };
}

async function issueAndSubmit(bits: ConsentBits) {
  const deps = harness();
  const now = new Date("2026-07-28T07:00:00.000Z");
  const issued = await deps.signingTokens.issue({
    tokenId: "stk-1",
    token: "tok-1",
    interviewId: "itv-1",
    subjectId: "subj-weber",
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  });
  const result = await submitConsent(
    { signingTokens: deps.signingTokens, portalTokens: deps.portalTokens, snapshots: deps.snapshots, renderParams: deps.renderParams, now: () => now },
    { token: issued.token, bits },
  );
  return { result, deps };
}

describe("F87 — 四项同意位彼此独立、服务端模型与分发", () => {
  it("[全部拒绝]（四位全 false）是合法完整结果，submitConsent 不抛错、bits 原样落库", async () => {
    const allDeclined: ConsentBits = { record: false, transcript: false, ai_analysis: false, attribution: false };
    const { result, deps } = await issueAndSubmit(allDeclined);
    expect(result.submissionId).toBeTruthy();
    // 签署令牌换出了门户令牌——即便全部拒绝，受访者依然获得事后自助改选择的通道（AC8）。
    expect(result.portalToken.tokenId).toBeTruthy();

    // 直接从快照仓储里读出刚保存的那一条，断言 bits 与提交时完全一致——不是被
    // "全部拒绝"这个特殊值悄悄改写成别的东西（比如某个字段被强制 true）。
    const saved = deps.snapshots.peek(result.snapshotId);
    expect(saved?.bits).toEqual(allDeclined);
  });

  it("四项彼此独立：任意组合都被原样接受，不因某一位为 false 而连带改写另一位", async () => {
    const combos: ConsentBits[] = [
      { record: true, transcript: false, ai_analysis: false, attribution: true },
      { record: false, transcript: true, ai_analysis: true, attribution: false },
      { record: true, transcript: true, ai_analysis: false, attribution: false },
      { record: false, transcript: false, ai_analysis: false, attribution: true },
    ];
    for (const bits of combos) {
      const { result } = await issueAndSubmit(bits);
      expect(result.submissionId).toBeTruthy();
    }
  });

  it("署名位（attribution）与其余三位完全独立：三者全拒时署名仍可为 true", () => {
    const bits: ConsentBits = { record: false, transcript: false, ai_analysis: false, attribution: true };
    const dist = deriveConsentDistribution(bits);
    expect(dist.attributionAllowed).toBe(true);
    expect(dist.recordingAllowed).toBe(false);
    expect(dist.transcriptPersistAllowed).toBe(false);
    expect(dist.aiAnalysisAllowed).toBe(false);
  });

  it("录音=否 时，即使转文字稿/AI 分析单独勾了 true，两者的分发结果仍是 false（没有音频可转）", () => {
    const bits: ConsentBits = { record: false, transcript: true, ai_analysis: true, attribution: false };
    const dist = deriveConsentDistribution(bits);
    expect(dist.recordingAllowed).toBe(false);
    expect(dist.transcriptPersistAllowed).toBe(false);
    expect(dist.aiAnalysisAllowed).toBe(false);
  });

  it("录音=是、转文字稿=否 时，AI 分析分发结果也是 false（没有文字稿可喂），但录音本身仍允许", () => {
    const bits: ConsentBits = { record: true, transcript: false, ai_analysis: true, attribution: false };
    const dist = deriveConsentDistribution(bits);
    expect(dist.recordingAllowed).toBe(true);
    expect(dist.transcriptPersistAllowed).toBe(false);
    expect(dist.aiAnalysisAllowed).toBe(false);
  });

  it("录音=是、转文字稿=是、AI 分析=否 时，只有 AI 分析被拒（已裁决 O-05 的降级语义），其余两条链路正常放行", () => {
    const bits: ConsentBits = { record: true, transcript: true, ai_analysis: false, attribution: true };
    const dist = deriveConsentDistribution(bits);
    expect(dist.recordingAllowed).toBe(true);
    expect(dist.transcriptPersistAllowed).toBe(true);
    expect(dist.aiAnalysisAllowed).toBe(false);
    expect(dist.attributionAllowed).toBe(true);
  });

  it("全部同意时四条链路全部放行", () => {
    const bits: ConsentBits = { record: true, transcript: true, ai_analysis: true, attribution: true };
    const dist: ConsentDistribution = deriveConsentDistribution(bits);
    expect(dist).toEqual({
      recordingAllowed: true,
      transcriptPersistAllowed: true,
      aiAnalysisAllowed: true,
      attributionAllowed: true,
    });
  });

  it("全部拒绝时分发结果全部为 false，且函数不抛错（合法完整结果，不是失败态）", () => {
    const bits: ConsentBits = { record: false, transcript: false, ai_analysis: false, attribution: false };
    expect(() => deriveConsentDistribution(bits)).not.toThrow();
    expect(deriveConsentDistribution(bits)).toEqual({
      recordingAllowed: false,
      transcriptPersistAllowed: false,
      aiAnalysisAllowed: false,
      attributionAllowed: false,
    });
  });
});
