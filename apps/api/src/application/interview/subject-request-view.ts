/**
 * `resolveSubjectRequestView`（F96）—— 共享的「请求行 → 对外可见状态」翻译。
 *
 * `getPortalView` 与 `listSubjectRequests` 都要把 `SubjectRequestRow` 变成
 * `{ requestId, kind, status, etaAt }`，且都必须遵守同一条规则：有关联撤回单据的
 * （`erasure` / 触发了撤回的 `consent-change`）要**现读**那张单据的最新五步快照，
 * 不能各自查一遍再各写一套翻译逻辑——那正是「两处投影分叉」的形状（同
 * `subject-projections.ts`/`deriveConsentStatus` 单一实现的立场）。
 */
import {
  deriveConsentChangeRequestView,
  deriveErasureRequestView,
} from "../../domain/interview/portal-request";
import type { SubjectRequestRow } from "./portal-ports";
import type { WithdrawalRepository } from "./withdrawal-ports";

export interface SubjectRequestView {
  readonly requestId: string;
  readonly kind: string;
  readonly status: string;
  readonly etaAt: string | null;
}

export async function resolveSubjectRequestView(
  deps: { readonly withdrawals: WithdrawalRepository },
  row: SubjectRequestRow,
): Promise<SubjectRequestView> {
  if (row.withdrawalId === null) {
    return {
      requestId: row.requestId,
      kind: row.kind,
      status: row.fixedStatus ?? "已完成",
      etaAt: row.fixedEtaAt,
    };
  }

  const withdrawal = await deps.withdrawals.findById(row.withdrawalId);
  const steps = withdrawal?.steps ?? [];
  const view =
    row.kind === "erasure" ? deriveErasureRequestView(steps) : deriveConsentChangeRequestView(steps);

  return { requestId: row.requestId, kind: row.kind, status: view.status, etaAt: view.etaAt };
}
