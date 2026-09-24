/**
 * Phase 18 F03 —— ontology_actions 执行器（I-3：模型不直接写图）。
 *
 * 抽取 Agent（F06）和人工动作（F10 / F11）都经这里写本体：
 *   校验 → 不通过：记一条 rejected 动作，返回拒绝码
 *        → 通过：交给数据库的唯一写入口，同一事务里落表 + 记 accepted 动作
 * 数据库那一侧再判一遍同样的不变量；那一遍的拒绝同样留痕。
 */
import type { OrgId } from "../../domain/org-id";
import { validateOntologyBatch, type OntologyBatch } from "../../domain/knowledge-graph/ontology-batch";
import type { AppliedBatch, OntologyStorePort, RejectedBatch } from "./ports";

export type ApplyOntologyBatchResult =
  | { readonly outcome: "accepted"; readonly applied: AppliedBatch }
  | { readonly outcome: "rejected"; readonly rejected: RejectedBatch };

export async function applyOntologyBatch(
  store: OntologyStorePort,
  orgId: OrgId,
  currentUserId: string | null,
  batch: OntologyBatch,
): Promise<ApplyOntologyBatchResult> {
  const verdict = validateOntologyBatch(batch, currentUserId);
  if (!verdict.ok) {
    const rejected = { code: verdict.code, reason: verdict.reason };
    await store.recordRejected(orgId, currentUserId, batch, rejected);
    return { outcome: "rejected", rejected };
  }
  const result = await store.apply(orgId, currentUserId, batch);
  if ("rejected" in result) {
    await store.recordRejected(orgId, currentUserId, batch, result.rejected);
    return { outcome: "rejected", rejected: result.rejected };
  }
  return { outcome: "accepted", applied: result.applied };
}
