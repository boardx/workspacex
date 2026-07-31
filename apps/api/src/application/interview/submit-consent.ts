/**
 * `submitConsent`（F86 / uc-6-3 R3 步骤 4）—— 提交（含 `[全部拒绝]`）。
 *
 * 做：① 条件核销签署令牌（一次性，见 `consent-token-ports.ts` 的理由）
 *     ② 保存同意书渲染快照（当时告知了什么，事后不可回溯改写）
 *     ③ **另行签发**门户长效令牌：有效期 = 该场材料保留期，**是一枚新令牌**，
 *       不是把签署令牌延期——这正是本 feature 要证明「不存在单一 24 小时令牌路径」的地方。
 *
 * 不做：四位同意的**分发**（服务端过滤录音/转写/AI 分析/署名四条链路）——那是 F87
 * 「四项同意位服务端模型与分发」的范围。这里只保证 bits 被**受访者本人**在提交那一刻
 * 原样落进快照，不做任何下游过滤编排。
 *
 * ⚠ 四位全 false（`[全部拒绝]`）是**合法完整结果**，本函数不对 bits 的取值做任何校验——
 *   校验会把「全部拒绝」变成一个特殊分支，而契约明说它不是。
 */
import {
  newConsentSubmissionId,
  newPortalToken,
  newPortalTokenId,
  portalTokenExpiresAt,
} from "../../domain/interview/consent-token";
import { hasCompleteRenderParams } from "../../domain/interview/consent-token";
import { ConsentWriteFailedError, TokenInvalidError } from "./errors";
import type {
  ConsentBitsValue,
  ConsentRenderParamsProvider,
  ConsentSnapshotRepository,
  PortalTokenRepository,
  SigningTokenRepository,
} from "./consent-token-ports";

export interface SubmitConsentDeps {
  readonly signingTokens: SigningTokenRepository;
  readonly portalTokens: PortalTokenRepository;
  readonly snapshots: ConsentSnapshotRepository;
  readonly renderParams: ConsentRenderParamsProvider;
  readonly now?: () => Date;
  readonly baseUrl?: string;
}

export interface SubmitConsentInput {
  readonly token: string;
  readonly bits: ConsentBitsValue;
}

export interface SubmitConsentOutput {
  readonly submissionId: string;
  readonly submittedAt: string;
  readonly snapshotId: string;
  readonly portalToken: {
    readonly tokenId: string;
    readonly url: string;
    readonly expiresAt: string;
  };
}

export const DEFAULT_PORTAL_BASE_URL = "https://workspacex.invalid";

export async function submitConsent(
  deps: SubmitConsentDeps,
  input: SubmitConsentInput,
): Promise<SubmitConsentOutput> {
  const now = (deps.now ?? (() => new Date()))();

  // 条件核销：受影响的是且仅是「此刻仍有效」的那一枚。并发下第二次提交（同一令牌）
  // 会拿到 `ok: false`（reason: "consumed"），从而不会签发第二枚门户令牌。
  const consumed = await deps.signingTokens.consume({ token: input.token, now });
  if (!consumed.ok) throw new TokenInvalidError();

  const params = await deps.renderParams.get(consumed.row.interviewId);
  if (!hasCompleteRenderParams(params)) {
    // ⚠ 走到这一步渲染变量却缺失是极端情形（签发/打开时都校验过），仍需显式失败而不是
    // 静默用一个兜底天数——「绝不能显示成功」（R6）覆盖这一步。
    throw new ConsentWriteFailedError();
  }

  let snapshot;
  try {
    snapshot = await deps.snapshots.save({
      snapshotId: `csnap-${consumed.row.tokenId}`,
      submissionId: newConsentSubmissionId(),
      interviewId: consumed.row.interviewId,
      subjectId: consumed.row.subjectId,
      renderParams: params,
      bits: input.bits,
      submittedAt: now,
    });
  } catch {
    // 写入失败必须对受访者显式可见（`CONSENT_WRITE_FAILED`），且保留选择——调用方
    // （interface 层）收到这个错误时不得把它渲染成成功页。
    throw new ConsentWriteFailedError();
  }

  const portalToken = newPortalToken();
  const portalExpiresAt = portalTokenExpiresAt(now, params.retentionDays);
  const issuedPortal = await deps.portalTokens.issue({
    tokenId: newPortalTokenId(),
    token: portalToken,
    interviewId: consumed.row.interviewId,
    subjectId: consumed.row.subjectId,
    issuedAt: now,
    expiresAt: portalExpiresAt,
  });

  const base = deps.baseUrl ?? DEFAULT_PORTAL_BASE_URL;
  return {
    submissionId: snapshot.submissionId,
    submittedAt: now.toISOString(),
    snapshotId: snapshot.snapshotId,
    portalToken: {
      tokenId: issuedPortal.tokenId,
      url: `${base}/portal/${issuedPortal.token}`,
      expiresAt: issuedPortal.expiresAt.toISOString(),
    },
  };
}
