/**
 * `updateConsentFromPortal`（F96 / uc-6-6 R3 步骤 2）—— 受访者在门户改选择。
 *
 * ⚠ **收紧**（true → false）→ 即时生效 + 对被收紧的键**触发撤回**（复用 F89 的
 *   `requestWithdrawal`，这里不重新实现五步流水线——本用例只是它的第二个触发入口，
 *   见 `request-withdrawal.ts` 文件头）。
 * ⚠ **放宽**（false → true）→ 即时生效，但**不追溯**：本函数对放宽的键不做任何
 *   下游动作——不重新转写已删除的音频，不补跑任何归纳（R7）。
 * ⚠ 每次变更**追加一条历史版本，不覆盖**（I-16）——`consentState.appendChange` 是
 *   一个纯追加操作，没有「改写第几条」这种入参。
 * ⚠ 若被收紧的范围与一个在途撤回重叠，`requestWithdrawal` 会抛
 *   `WithdrawalInProgressError`——本函数让它原样往上抛（契约 `err` 里就是这么声明的），
 *   同一次调用里**不写**新的 bits 历史：宁可让受访者重试，也不让「同意位已更新」
 *   与「撤回没真的发生」这两件事在同一次响应里互相矛盾。
 */
import { newConsentSubmissionId } from "../../domain/interview/consent-token";
import { diffConsentBits } from "../../domain/interview/portal-request";
import type { ConsentBits } from "../../domain/interview/portal-request";
import { TokenInvalidError } from "./errors";
import type { ConsentSnapshotRepository, PortalTokenRepository } from "./consent-token-ports";
import type { PortalConsentStateRepository, SubjectRequestRepository } from "./portal-ports";
import { requestWithdrawal } from "./request-withdrawal";
import type { RequestWithdrawalDeps } from "./request-withdrawal";

export interface UpdateConsentFromPortalDeps extends RequestWithdrawalDeps {
  readonly portalTokens: PortalTokenRepository;
  readonly snapshots: ConsentSnapshotRepository;
  readonly consentState: PortalConsentStateRepository;
  readonly subjectRequests: SubjectRequestRepository;
  readonly newRequestId?: () => string;
}

export interface UpdateConsentFromPortalInput {
  readonly portalToken: string;
  readonly bits: ConsentBits;
}

export interface UpdateConsentFromPortalOutput {
  readonly submissionId: string;
  readonly submittedAt: string;
  readonly triggeredWithdrawalId: string | null;
}

export async function updateConsentFromPortal(
  deps: UpdateConsentFromPortalDeps,
  input: UpdateConsentFromPortalInput,
): Promise<UpdateConsentFromPortalOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const lookup = await deps.portalTokens.findActive(input.portalToken, now);
  if (!lookup.ok) throw new TokenInvalidError();
  const { subjectId, interviewId } = lookup.row;

  const current = await deps.consentState.getCurrentBits(subjectId);
  const previousBits = current?.bits ?? (await deps.snapshots.findBySubject(interviewId, subjectId))?.bits;
  // 数据完整性兜底：既没有历史变更、原始快照也查不到 —— 视作「此前全部拒绝」，
  // 这样至少不会把一次合法的收紧误判成放宽（全 false 是最保守的起点）。
  const baseline: ConsentBits = previousBits ?? {
    record: false,
    transcript: false,
    ai_analysis: false,
    attribution: false,
  };

  const { tightened } = diffConsentBits(baseline, input.bits);

  let triggeredWithdrawalId: string | null = null;
  if (tightened.length > 0) {
    // ⚠ 这一步可能抛 `WithdrawalInProgressError`——让它原样往上抛，不吞掉、
    //   也不在抛出之前写任何 bits 历史（见文件头）。
    const withdrawal = await requestWithdrawal(deps, {
      subjectId,
      scope: tightened,
      reason: `受访者通过自助门户收紧同意位：${tightened.join(",")}`,
      origin: "portal",
    });
    triggeredWithdrawalId = withdrawal.withdrawalId;
  }

  const submissionId = newConsentSubmissionId();
  await deps.consentState.appendChange({
    submissionId,
    subjectId,
    bits: input.bits,
    changedAt: now,
  });

  const requestId = (deps.newRequestId ?? (() => `sreq-${newConsentSubmissionId()}`))();
  await deps.subjectRequests.create({
    requestId,
    subjectId,
    kind: "consent-change",
    createdAt: now,
    withdrawalId: triggeredWithdrawalId,
    fixedStatus: triggeredWithdrawalId === null ? "变更已完成" : null,
    fixedEtaAt: null,
  });

  return {
    submissionId,
    submittedAt: now.toISOString(),
    triggeredWithdrawalId,
  };
}
