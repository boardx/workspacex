/**
 * `getPortalView`（F96 / uc-6-6 R3 步骤 1）—— 受访者自助门户主视图。
 *
 * ⚠ 默认是**只读展示 + 三个显式动作入口**，本函数本身不做任何写入（A3）。
 * ⚠ 令牌无效时在校验令牌那一步就抛出，**响应体不含任何访谈内容**（V9）——
 *   下面所有读取（原始快照/当前 bits/请求列表）都排在令牌校验之后。
 * ⚠ `snapshot.renderedText` 用的是**原始**快照里冻结的 `renderParams`/`bits`，
 *   不是当下的项目参数——材料保留期之后被改，这段文本不会跟着变（AC5）。
 * ⚠ `bits` 展示的是**当前**值（可能已被门户改过），与 `snapshot` 是两件不同的事：
 *   一个回答「我现在同意什么」，一个回答「当初告诉过我什么」。
 */
import { renderConsentSnapshotText } from "../../domain/interview/consent-token";
import { TokenInvalidError } from "./errors";
import type { ConsentSnapshotRepository, PortalTokenRepository } from "./consent-token-ports";
import type { PortalConsentStateRepository, SubjectRequestRepository } from "./portal-ports";
import { resolveSubjectRequestView } from "./subject-request-view";
import type { WithdrawalRepository } from "./withdrawal-ports";

export interface GetPortalViewDeps {
  readonly portalTokens: PortalTokenRepository;
  readonly snapshots: ConsentSnapshotRepository;
  readonly consentState: PortalConsentStateRepository;
  readonly subjectRequests: SubjectRequestRepository;
  readonly withdrawals: WithdrawalRepository;
  readonly now?: () => Date;
}

export interface GetPortalViewInput {
  readonly portalToken: string;
}

export interface GetPortalViewOutput {
  readonly bits: {
    readonly record: boolean;
    readonly transcript: boolean;
    readonly ai_analysis: boolean;
    readonly attribution: boolean;
  };
  readonly submittedAt: string;
  readonly snapshot: {
    readonly snapshotId: string;
    readonly renderedText: string;
  };
  readonly requests: readonly {
    readonly requestId: string;
    readonly kind: string;
    readonly status: string;
    readonly etaAt: string | null;
  }[];
  readonly controller: {
    readonly org: string;
    readonly contactName: string;
    readonly complianceEmail: string;
  };
}

export async function getPortalView(
  deps: GetPortalViewDeps,
  input: GetPortalViewInput,
): Promise<GetPortalViewOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const lookup = await deps.portalTokens.findActive(input.portalToken, now);
  if (!lookup.ok) throw new TokenInvalidError();
  const { subjectId, interviewId } = lookup.row;

  const snapshotRow = await deps.snapshots.findBySubject(interviewId, subjectId);
  if (snapshotRow === null) {
    // 令牌存在即说明 submitConsent 跑完过，原始快照理应恒存在；查不到属数据完整性问题，
    // 但契约没有专门码表达它——与 `getWithdrawalStatus` 的契约缺口同一处理，不新造码。
    throw new TokenInvalidError();
  }

  const current = await deps.consentState.getCurrentBits(subjectId);
  const bits = current?.bits ?? snapshotRow.bits;
  const submittedAt = (current?.changedAt ?? snapshotRow.submittedAt).toISOString();

  const rows = await deps.subjectRequests.listBySubject(subjectId);
  const requests = await Promise.all(rows.map((row) => resolveSubjectRequestView(deps, row)));

  return {
    bits,
    submittedAt,
    snapshot: {
      snapshotId: snapshotRow.snapshotId,
      renderedText: renderConsentSnapshotText(snapshotRow.renderParams, snapshotRow.bits),
    },
    requests,
    controller: {
      org: snapshotRow.renderParams.dataController,
      contactName: snapshotRow.renderParams.contactName,
      complianceEmail: snapshotRow.renderParams.complianceEmail,
    },
  };
}
