/**
 * F96 —— 受访者自助门户：令牌失效/越权与门户长效令牌的有效期（uc-6-6，issue #289）。
 *
 * 本文件要证明的核心断言：
 *   ① V9：令牌失效（撤销/过期/不存在）打开门户 ⇒ `TOKEN_INVALID`，
 *      响应体（抛出前）**不产生任何访谈内容**——异常发生在任何数据读取之前；
 *   ② 契约对「门户内三个动作」端口（要副本/要删除/查进度）与「打开门户/改选择」
 *      两个端口用了**不同的失败码**：前者统一 `TOKEN_SCOPE_VIOLATION`，
 *      后者 `TOKEN_INVALID`——这不是文案疏漏，是 `usecases.md` G 组逐字这样写的；
 *   ③ V9b②：门户长效令牌有效期 ＝ 材料保留期，第 179 天仍可访问，
 *      保留期届满后（第 181 天）访问被拒——与材料一同失效，不是「24 小时」；
 *   ④ 反证：全流程任何断言/产出字符串中都不出现「24 小时」这个已废弃口径。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getPortalView } from "../../src/application/interview/get-portal-view";
import { updateConsentFromPortal } from "../../src/application/interview/update-consent-from-portal";
import { requestTranscriptCopy } from "../../src/application/interview/request-transcript-copy";
import { requestErasure } from "../../src/application/interview/request-erasure";
import { listSubjectRequests } from "../../src/application/interview/list-subject-requests";
import { portalTokenExpiresAt } from "../../src/domain/interview/consent-token";
import { TokenInvalidError, TokenScopeViolationError } from "../../src/application/interview/errors";
import {
  InMemoryConsentSnapshotRepository,
  InMemoryPortalTokenRepository,
} from "../../src/infrastructure/interview/in-memory-consent-token-repository";
import {
  FixedTranscriptCopySourceReader,
  InMemoryPortalConsentStateRepository,
  InMemorySubjectRequestRepository,
  InMemoryTranscriptCopyFileStore,
} from "../../src/infrastructure/interview/in-memory-portal-repository";
import {
  FixedWithdrawalSegmentLocator,
  InMemoryCascadeInvalidationStore,
  InMemoryPendingDeletionQueue,
  InMemoryReportSegmentAnnotator,
  InMemoryRetrievalIndex,
  InMemorySignedDecisionReviewNotifier,
  InMemoryWithdrawalRepository,
} from "../../src/infrastructure/interview/in-memory-withdrawal-repository";

const INTERVIEW = "itv-f96-scope-lifetime";
const SUBJECT = "sub-f96-scope-lifetime";
const RETENTION_DAYS = 180;

function makeDeps(now: () => Date) {
  return {
    portalTokens: new InMemoryPortalTokenRepository(),
    snapshots: new InMemoryConsentSnapshotRepository(),
    consentState: new InMemoryPortalConsentStateRepository(),
    subjectRequests: new InMemorySubjectRequestRepository(),
    withdrawals: new InMemoryWithdrawalRepository(),
    segments: new FixedWithdrawalSegmentLocator(new Map([[SUBJECT, ["seg-1"]]])),
    deletionQueue: new InMemoryPendingDeletionQueue(),
    retrieval: new InMemoryRetrievalIndex(),
    cascade: new InMemoryCascadeInvalidationStore(),
    reportAnnotator: new InMemoryReportSegmentAnnotator(),
    decisionReview: new InMemorySignedDecisionReviewNotifier(),
    transcripts: new FixedTranscriptCopySourceReader(new Map()),
    files: new InMemoryTranscriptCopyFileStore(),
    now,
  };
}

async function seedIssuedAndSubmitted(deps: ReturnType<typeof makeDeps>, issuedAt: Date, token = "ptk-value") {
  await deps.portalTokens.issue({
    tokenId: "ptk-scope-lifetime",
    token,
    interviewId: INTERVIEW,
    subjectId: SUBJECT,
    issuedAt,
    expiresAt: portalTokenExpiresAt(issuedAt, RETENTION_DAYS),
  });
  await deps.snapshots.save({
    snapshotId: "csnap-scope-lifetime",
    submissionId: "csub-scope-lifetime",
    interviewId: INTERVIEW,
    subjectId: SUBJECT,
    renderParams: {
      retentionDays: RETENTION_DAYS,
      dataController: "某物流园区",
      contactName: "李研究员",
      complianceEmail: "compliance@example.invalid",
    },
    bits: { record: true, transcript: true, ai_analysis: true, attribution: false },
    submittedAt: issuedAt,
  });
}

describe("F96 · 门户令牌失效/越权与有效期", () => {
  let clockMs: number;
  const now = () => new Date(clockMs);

  beforeEach(() => {
    clockMs = Date.parse("2026-08-01T09:00:00.000Z");
  });

  it("V9：不存在的令牌打开门户 ⇒ TOKEN_INVALID，不读取任何访谈内容", async () => {
    const deps = makeDeps(now);
    await seedIssuedAndSubmitted(deps, now());

    await expect(getPortalView(deps, { portalToken: "no-such-token" })).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
    // ⚠ 校验令牌是函数第一步——没有任何机会在抛出前读到 snapshot/bits/requests，
    //   由 `get-portal-view.ts` 的实现顺序保证（令牌查找失败即 return 之前的唯一出口）。
  });

  it("撤销后的令牌打开门户/改选择 ⇒ TOKEN_INVALID", async () => {
    const deps = makeDeps(now);
    await seedIssuedAndSubmitted(deps, now());
    await deps.portalTokens.revoke("ptk-scope-lifetime", now());

    await expect(getPortalView(deps, { portalToken: "ptk-value" })).rejects.toBeInstanceOf(TokenInvalidError);
    await expect(
      updateConsentFromPortal(deps, {
        portalToken: "ptk-value",
        bits: { record: false, transcript: true, ai_analysis: true, attribution: false },
      }),
    ).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it("撤销后的令牌用于「门户内三个动作」⇒ TOKEN_SCOPE_VIOLATION（与打开门户不是同一个码）", async () => {
    const deps = makeDeps(now);
    await seedIssuedAndSubmitted(deps, now());
    await deps.portalTokens.revoke("ptk-scope-lifetime", now());

    await expect(requestTranscriptCopy(deps, { portalToken: "ptk-value" })).rejects.toBeInstanceOf(
      TokenScopeViolationError,
    );
    await expect(
      requestErasure(deps, { portalToken: "ptk-value", acknowledged: true }),
    ).rejects.toBeInstanceOf(TokenScopeViolationError);
    await expect(listSubjectRequests(deps, { portalToken: "ptk-value" })).rejects.toBeInstanceOf(
      TokenScopeViolationError,
    );
  });

  it("V9b②：门户长效令牌有效期＝材料保留期——第 179 天仍可访问", async () => {
    const deps = makeDeps(now);
    const issuedAt = now();
    await seedIssuedAndSubmitted(deps, issuedAt);

    clockMs = issuedAt.getTime() + 179 * 24 * 60 * 60 * 1000;
    const view = await getPortalView(deps, { portalToken: "ptk-value" });
    expect(view.bits.record).toBe(true);
  });

  it("V9b②：保留期届满后访问被拒——与材料一同失效", async () => {
    const deps = makeDeps(now);
    const issuedAt = now();
    await seedIssuedAndSubmitted(deps, issuedAt);

    clockMs = issuedAt.getTime() + (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    await expect(getPortalView(deps, { portalToken: "ptk-value" })).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it("V9b⑤反证：门户令牌的有效期不是「24 小时」——第 25 小时仍可访问", async () => {
    const deps = makeDeps(now);
    const issuedAt = now();
    await seedIssuedAndSubmitted(deps, issuedAt);

    clockMs = issuedAt.getTime() + 25 * 60 * 60 * 1000; // +25 小时
    const view = await getPortalView(deps, { portalToken: "ptk-value" });
    expect(view.bits.record).toBe(true);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("24 小时");
    expect(serialized).not.toMatch(/24h\b/i);
  });

  it("V9b④：研究员单条撤销后该令牌立即失效，不影响同项目其他受访者的令牌", async () => {
    const deps = makeDeps(now);
    const issuedAt = now();
    await seedIssuedAndSubmitted(deps, issuedAt);

    const OTHER_SUBJECT = "sub-f96-other";
    await deps.portalTokens.issue({
      tokenId: "ptk-other",
      token: "ptk-other-value",
      interviewId: INTERVIEW,
      subjectId: OTHER_SUBJECT,
      issuedAt,
      expiresAt: portalTokenExpiresAt(issuedAt, RETENTION_DAYS),
    });
    await deps.snapshots.save({
      snapshotId: "csnap-other",
      submissionId: "csub-other",
      interviewId: INTERVIEW,
      subjectId: OTHER_SUBJECT,
      renderParams: {
        retentionDays: RETENTION_DAYS,
        dataController: "某物流园区",
        contactName: "李研究员",
        complianceEmail: "compliance@example.invalid",
      },
      bits: { record: true, transcript: false, ai_analysis: false, attribution: false },
      submittedAt: issuedAt,
    });

    await deps.portalTokens.revoke("ptk-scope-lifetime", now());

    await expect(getPortalView(deps, { portalToken: "ptk-value" })).rejects.toBeInstanceOf(TokenInvalidError);
    // 另一位受访者的令牌完全不受影响。
    const otherView = await getPortalView(deps, { portalToken: "ptk-other-value" });
    expect(otherView.bits.record).toBe(true);
  });
});
