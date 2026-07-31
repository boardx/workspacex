/**
 * F86 —— 一次性签署令牌 + 门户长效令牌的完整生命周期（uc-6-3 R3，已裁决 O-15）。
 *
 * ⚠ 刻意不碰 Postgres：本 feature 开工时受访者/访谈的持久化地基（F82 系列）仍在
 *   并发实现、尚未合并 main，issue #95 明确允许「实现你自己的最小端口 stub」——
 *   这里用 `in-memory-consent-token-repository.ts` 的内存实现对三个 use case
 *   （`issueSigningToken` / `getConsentPage` / `submitConsent`）做纯编排断言。
 *   见 issue #74：Postgres 依赖测试本地不整跑，这个文件本来就不需要 Postgres。
 *
 * 本文件要证明的**核心断言**（对应 issue 的「反证」要求）：
 *   系统中不存在「24 小时单一令牌」这条实现路径——签署令牌与门户令牌是
 *   两枚不同的令牌（不同 id、不同值、不同有效期来源），提交动作产生的是
 *   一枚**新**令牌，不是对旧令牌的续期。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  SIGNING_TOKEN_TTL_MS,
  portalTokenExpiresAt,
  signingTokenExpiresAt,
} from "../../src/domain/interview/consent-token";
import { issueSigningToken } from "../../src/application/interview/issue-signing-token";
import { getConsentPage } from "../../src/application/interview/get-consent-page";
import { submitConsent } from "../../src/application/interview/submit-consent";
import { resendPortalToken } from "../../src/application/interview/resend-portal-token";
import { revokePortalToken } from "../../src/application/interview/revoke-portal-token";
import { RetentionParamsMissingError, TokenInvalidError } from "../../src/application/interview/errors";
import {
  FixedConsentRenderParamsProvider,
  FixedConsentSessionFactsProvider,
  InMemoryConsentSnapshotRepository,
  InMemoryPortalTokenRepository,
  InMemorySigningTokenRepository,
} from "../../src/infrastructure/interview/in-memory-consent-token-repository";

const INTERVIEW = "itv-f86-weber";
const SUBJECT = "sub-f86-weber";

const COMPLETE_PARAMS = {
  retentionDays: 180,
  dataController: "远洋咨询",
  contactName: "林可",
  complianceEmail: "compliance@example.invalid",
};

/** 令牌值就在签发返回的 URL 里（`.../consent/<token>` 或 `.../portal/<token>`）——不必伸手进仓储内部状态。 */
function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

function makeDeps(now: () => Date) {
  const signingTokens = new InMemorySigningTokenRepository();
  const portalTokens = new InMemoryPortalTokenRepository();
  const snapshots = new InMemoryConsentSnapshotRepository();
  const renderParams = new FixedConsentRenderParamsProvider(
    new Map([[INTERVIEW, COMPLETE_PARAMS]]),
  );
  const sessionFacts = new FixedConsentSessionFactsProvider(
    new Map([
      [`${INTERVIEW}:${SUBJECT}`, { subjectAlias: "Weber 先生", whenAt: "2026-07-28T15:00:00.000Z", durationMinutes: 60 }],
    ]),
  );
  return { signingTokens, portalTokens, snapshots, renderParams, sessionFacts, now };
}

describe("F86 · 两种令牌的生命周期", () => {
  let clockMs: number;
  const now = () => new Date(clockMs);

  beforeEach(() => {
    clockMs = Date.parse("2026-07-28T08:00:00.000Z");
  });

  it("签署令牌：7 天、一次性——渲染变量齐全时才签发", async () => {
    const deps = makeDeps(now);
    const issued = await issueSigningToken(
      { repo: deps.signingTokens, renderParams: deps.renderParams, now },
      { interviewId: INTERVIEW, subjectId: SUBJECT },
    );

    expect(issued.tokenId).toMatch(/^stk-/);
    expect(issued.url).toContain("/consent/");

    const expiresAtMs = Date.parse(issued.expiresAt);
    expect(expiresAtMs - clockMs).toBe(SIGNING_TOKEN_TTL_MS);
    expect(expiresAtMs - clockMs).toBe(7 * 24 * 60 * 60 * 1000);

    // ⚠ 反证核心：7 天 ≠ 24 小时。若有人把签署令牌悄悄改成 24 小时单一令牌，这里先红。
    expect(expiresAtMs - clockMs).not.toBe(24 * 60 * 60 * 1000);
  });

  it("渲染变量缺失（E2）⇒ 不签发任何令牌", async () => {
    const deps = makeDeps(now);
    const incomplete = new FixedConsentRenderParamsProvider(
      new Map([[INTERVIEW, { ...COMPLETE_PARAMS, complianceEmail: "" }]]),
    );
    await expect(
      issueSigningToken(
        { repo: deps.signingTokens, renderParams: incomplete, now },
        { interviewId: INTERVIEW, subjectId: SUBJECT },
      ),
    ).rejects.toBeInstanceOf(RetentionParamsMissingError);

    // 没有任何一枚令牌被签发出去。
    const lookup = await deps.signingTokens.findActive("anything", now());
    expect(lookup.ok).toBe(false);
  });

  it("受访者打开授权页只读，不核销签署令牌；措辞恒四项", async () => {
    const deps = makeDeps(now);
    const issued = await issueSigningToken(
      { repo: deps.signingTokens, renderParams: deps.renderParams, now },
      { interviewId: INTERVIEW, subjectId: SUBJECT },
    );

    const page1 = await getConsentPage(
      { repo: deps.signingTokens, renderParams: deps.renderParams, sessionFacts: deps.sessionFacts, now },
      { token: tokenOf(issued.url) },
    );
    const page2 = await getConsentPage(
      { repo: deps.signingTokens, renderParams: deps.renderParams, sessionFacts: deps.sessionFacts, now },
      { token: tokenOf(issued.url) },
    );

    expect(page1.items).toHaveLength(4);
    expect(page1.items.map((i) => i.key)).toEqual(["record", "transcript", "ai_analysis", "attribution"]);
    expect(page1.controller).toEqual({
      org: "远洋咨询", contactName: "林可", complianceEmail: "compliance@example.invalid",
    });
    expect(page2.session.subjectAlias).toBe("Weber 先生");

    // 打开两次都成功——只读不消耗。
    const stillActive = await deps.signingTokens.findActive(tokenOf(issued.url), now());
    expect(stillActive.ok).toBe(true);
  });

  it("过期/未知令牌打开授权页 ⇒ TOKEN_INVALID（不区分具体理由）", async () => {
    const deps = makeDeps(now);
    await expect(
      getConsentPage(
        { repo: deps.signingTokens, renderParams: deps.renderParams, sessionFacts: deps.sessionFacts, now },
        { token: "no-such-token" },
      ),
    ).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it("提交：签署令牌作废（一次性）+ 另行签发门户长效令牌（有效期＝材料保留期，是一枚新令牌）", async () => {
    const deps = makeDeps(now);
    const issued = await issueSigningToken(
      { repo: deps.signingTokens, renderParams: deps.renderParams, now },
      { interviewId: INTERVIEW, subjectId: SUBJECT },
    );
    const signingToken = tokenOf(issued.url);

    const bits = { record: true, transcript: true, ai_analysis: false, attribution: false };
    const result = await submitConsent(
      {
        signingTokens: deps.signingTokens,
        portalTokens: deps.portalTokens,
        snapshots: deps.snapshots,
        renderParams: deps.renderParams,
        now,
      },
      { token: signingToken, bits },
    );

    expect(result.submissionId).toMatch(/^csub-/);
    expect(result.portalToken.tokenId).toMatch(/^ptk-/);
    // ⚠ 两种令牌的 id 前缀不同，值也不同——门户令牌**不是**签署令牌的延期版本。
    expect(result.portalToken.tokenId).not.toBe(issued.tokenId);

    const portalExpiresMs = Date.parse(result.portalToken.expiresAt);
    const expectedPortalExpiry = portalTokenExpiresAt(now(), COMPLETE_PARAMS.retentionDays);
    expect(portalExpiresMs).toBe(expectedPortalExpiry.getTime());
    // 门户令牌有效期挂在「材料保留期」（180 天），与签署令牌的 7 天是两个不同的数。
    expect(portalExpiresMs - clockMs).not.toBe(SIGNING_TOKEN_TTL_MS);
    expect(portalExpiresMs - clockMs).toBe(180 * 24 * 60 * 60 * 1000);

    // 签署令牌一次性：核销后再核销/再打开都失败。
    await expect(
      getConsentPage(
        { repo: deps.signingTokens, renderParams: deps.renderParams, sessionFacts: deps.sessionFacts, now },
        { token: signingToken },
      ),
    ).rejects.toBeInstanceOf(TokenInvalidError);

    const secondSubmit = deps.signingTokens.consume({ token: signingToken, now: now() });
    await expect(secondSubmit).resolves.toMatchObject({ ok: false, reason: "consumed" });
  });

  it("`[全部拒绝]` 四位全 false 是合法完整结果，照样签发门户令牌", async () => {
    const deps = makeDeps(now);
    const issued = await issueSigningToken(
      { repo: deps.signingTokens, renderParams: deps.renderParams, now },
      { interviewId: INTERVIEW, subjectId: SUBJECT },
    );
    const signingToken = tokenOf(issued.url);

    const result = await submitConsent(
      {
        signingTokens: deps.signingTokens,
        portalTokens: deps.portalTokens,
        snapshots: deps.snapshots,
        renderParams: deps.renderParams,
        now,
      },
      { token: signingToken, bits: { record: false, transcript: false, ai_analysis: false, attribution: false } },
    );

    expect(result.portalToken.tokenId).toMatch(/^ptk-/);
  });

  it("门户令牌：受访者自助重发不改有效期、研究员单条撤销后失效且幂等", async () => {
    const deps = makeDeps(now);
    const issued = await issueSigningToken(
      { repo: deps.signingTokens, renderParams: deps.renderParams, now },
      { interviewId: INTERVIEW, subjectId: SUBJECT },
    );
    const signingToken = tokenOf(issued.url);
    const submitted = await submitConsent(
      {
        signingTokens: deps.signingTokens,
        portalTokens: deps.portalTokens,
        snapshots: deps.snapshots,
        renderParams: deps.renderParams,
        now,
      },
      { token: signingToken, bits: { record: true, transcript: true, ai_analysis: true, attribution: true } },
    );

    const portalTokenValue = tokenOf(submitted.portalToken.url);

    const resent = await resendPortalToken({ repo: deps.portalTokens, now }, { portalToken: portalTokenValue });
    expect(resent.tokenId).toBe(submitted.portalToken.tokenId);
    expect(resent.expiresAt).toBe(submitted.portalToken.expiresAt); // 同一枚令牌，有效期不变

    const revoked1 = await revokePortalToken({ repo: deps.portalTokens, now }, { tokenId: submitted.portalToken.tokenId });
    expect(revoked1.revoked).toBe(true);

    // 撤销后不能再被重发/使用。
    await expect(
      resendPortalToken({ repo: deps.portalTokens, now }, { portalToken: portalTokenValue }),
    ).rejects.toBeInstanceOf(TokenInvalidError);

    // 幂等重放：再撤一次不是错误，只是「本次未新撤销任何东西」。
    const revoked2 = await revokePortalToken({ repo: deps.portalTokens, now }, { tokenId: submitted.portalToken.tokenId });
    expect(revoked2.revoked).toBe(false);
  });

  it("反证：不存在任何把两种令牌算成同一个 24 小时有效期的路径", () => {
    const issuedAt = now();
    const signingExpiry = signingTokenExpiresAt(issuedAt);
    const portalExpiry = portalTokenExpiresAt(issuedAt, COMPLETE_PARAMS.retentionDays);

    const HOUR_MS = 60 * 60 * 1000;
    expect(signingExpiry.getTime() - issuedAt.getTime()).not.toBe(24 * HOUR_MS);
    expect(portalExpiry.getTime() - issuedAt.getTime()).not.toBe(24 * HOUR_MS);
    // 两者本身也不相等——两种令牌的有效期语义不共享同一个计算。
    expect(signingExpiry.getTime()).not.toBe(portalExpiry.getTime());
  });
});
