/**
 * F107 — 画布回流知识图谱（uc-7-4）：节点三态 + 来源链不断 + 只有组长确认才写回大脑。
 *
 * 依据 domain.md I-28 ~ I-31（本文件只管**回流侧**这几条可断言的性质，存储模型本身
 * 属 09-kg / 14-brain，本束不重造）：
 *
 *   · **I-28 来源链不断**：每个进入图谱的节点至少有一条 `claim_evidence` 指向可定位的
 *     Segment + anchor；断链的节点不得存在于图谱中 —— `confirmNode` 与
 *     `batchConfirmAndWriteBackToBrain` 在写入前都要用 `isProvenanceChainUnbroken` 校验，
 *     链断即拒绝（`SOURCE_CHAIN_BROKEN`），不产生"看似成功"的记录。
 *   · **I-29 只有组长确认过的节点才写回组织大脑**：判定在服务端，不是前端按钮禁用——
 *     `batchConfirmAndWriteBackToBrain` 对每条 claim 独立校验 `status === "accepted"`，
 *     不是靠"界面不显示未确认节点"来保证。
 *   · **I-30 互斥结论 contested 下支持与反驳边并存**：`mergeIntoPlenaryGraph` 检测互斥后
 *     把两条 claim 都标 `contested`，且**两条边都保留**，不自动择一、不删除任一侧。
 *   · **I-31 回流只搬结构与来源，不搬坐标**：本文件的输入输出形状里没有任何坐标字段，
 *     `GraphNodeProjection` 只含 `nodeRef` / `edges`，不含 x/y。
 *
 * 节点三态 → `claims.status` 映射（domain.md `GraphNodeProjection`）：
 *   `已确认` → `accepted` ・ `冲突` → `contested` ・ `待确认` → `proposed`。
 *
 * 跨分片依赖说明（feature_list.json notes 已标注"待确认"）：09-kg 的
 * `ontology_objects` / `ontology_edges` 与 14-brain 的组织大脑写回，在本仓截至本次
 * 实现时**没有落地的存储层代码**（grep 不到对应 repository/表），因此本文件只提供
 * **纯函数判定层**（对应 application 层将来接的端口），不新造一份影子存储去冒充
 * 这两个分片已经就绪——这是诚实反映依赖缺口，而不是假装写通了。
 */
import { canvas as C } from "@repo/contracts";
import type { z } from "zod";

export type NodeConfirmStatusT = z.infer<typeof C.NodeConfirmStatus>;
export type ClaimStatusT = z.infer<typeof C.ClaimStatus>;
export type NodeProvenanceT = z.infer<typeof C.NodeProvenance>;
export type CanvasErrorT = z.infer<typeof C.CanvasError>;

/** 节点三态 → `claims.status`（domain.md `GraphNodeProjection` 表，唯一事实源） */
const NODE_STATUS_TO_CLAIM_STATUS: Readonly<Record<NodeConfirmStatusT, ClaimStatusT>> = {
  已确认: "accepted",
  冲突: "contested",
  待确认: "proposed",
};

export function mapNodeStatusToClaimStatus(status: NodeConfirmStatusT): ClaimStatusT {
  return NODE_STATUS_TO_CLAIM_STATUS[status];
}

/**
 * I-28：来源链是否完整。`NodeProvenance` 六个字段（groupId / sourceStickyId / quote /
 * segmentId / anchor / transcriptFileRef）任一为空即整条视为断链——与 F106 留白规则②
 * "三件套任一为空即整体视为无引述"同一判据，这里多了 `groupId` 与
 * `transcriptFileRef` 两项（图谱侧要求能反查到具体的组与具体的文件，不只是引述本身）。
 */
export function isProvenanceChainUnbroken(provenance: NodeProvenanceT | null | undefined): boolean {
  if (!provenance) return false;
  return (
    provenance.groupId.length > 0 &&
    provenance.sourceStickyId.length > 0 &&
    provenance.quote.length > 0 &&
    provenance.segmentId.length > 0 &&
    provenance.anchor.length > 0 &&
    provenance.transcriptFileRef.length > 0
  );
}

/* ─────────────────────────── confirmNode（组长确认） ─────────────────────────── */

export type ConfirmNodeFailureReason = "SOURCE_CHAIN_BROKEN" | "VERSION_CHANGED";

export type ConfirmNodeResult =
  | {
      readonly ok: true;
      readonly claimId: string;
      readonly status: ClaimStatusT;
      readonly provenance: NodeProvenanceT;
    }
  | { readonly ok: false; readonly reason: ConfirmNodeFailureReason };

/**
 * `confirmNode` 的纯判定部分。调用方（application 层）负责鉴权（`ROLE_INSUFFICIENT`）、
 * 取出节点当前来源链与版本，本函数只管两条服务端闸门：
 *   ① 来源链断 ⟹ 拒绝，不产生 claim（I-28）。
 *   ② 版本已变化（乐观并发）⟹ 拒绝，不静默覆盖。
 * 顺序是刻意的：先查版本一致性——已经变化的节点上再判来源链没有意义，调用方应该先
 * 拿到最新状态重试，而不是被一个基于陈旧数据算出的来源链结论误导。
 */
export function confirmNode(params: {
  readonly makeClaimId: () => string;
  readonly nodeStatus: NodeConfirmStatusT;
  readonly provenance: NodeProvenanceT | null;
  readonly expectedVersionId: string;
  readonly currentVersionId: string;
}): ConfirmNodeResult {
  if (params.expectedVersionId !== params.currentVersionId) {
    return { ok: false, reason: "VERSION_CHANGED" };
  }
  if (!isProvenanceChainUnbroken(params.provenance)) {
    return { ok: false, reason: "SOURCE_CHAIN_BROKEN" };
  }
  return {
    ok: true,
    claimId: params.makeClaimId(),
    status: mapNodeStatusToClaimStatus(params.nodeStatus),
    provenance: params.provenance as NodeProvenanceT,
  };
}

/* ─────────────────────────── mergeIntoPlenaryGraph（汇入全场图谱） ─────────────────────────── */

/** 一条 claim 及其支持/反驳边的最小视图——只搬结构与来源，不含坐标（I-31）。 */
export interface ClaimRecord {
  readonly claimId: string;
  readonly status: ClaimStatusT;
  readonly provenance: NodeProvenanceT;
  /** 与本 claim 互斥的另一条 claim（同一命题的对立结论）。无互斥关系时为 `null`。 */
  readonly mutuallyExclusiveWith: string | null;
}

export interface MergeIntoPlenaryGraphResult {
  readonly merged: number;
  readonly contested: readonly string[];
  /** 汇入后的 claim 视图——contested 的两侧都在，供调用方持久化时校验"没有一侧被丢弃"。 */
  readonly claims: readonly ClaimRecord[];
}

/**
 * I-30：互斥结论自动标 `contested` 且不自动择一。
 *
 * 输入的 `claims` 里若两条 `mutuallyExclusiveWith` 互相指向对方，无论各自原先是什么
 * 状态，两条都被改写为 `contested` 并保留在输出里——**两侧的边都不删除**，本函数不提供
 * "系统择一"的出口（出口只能是人工的 `[上台讨论]` / `[标为不确定]`，属界面/应用层）。
 * 未互斥、且来源链完整、状态为 `accepted` 的 claim 计入 `merged`。
 */
export function mergeIntoPlenaryGraph(claimIds: readonly string[], allClaims: readonly ClaimRecord[]): MergeIntoPlenaryGraphResult {
  const byId = new Map(allClaims.map((c) => [c.claimId, c] as const));
  const targeted = claimIds.map((id) => byId.get(id)).filter((c): c is ClaimRecord => c !== undefined);

  const contestedIds = new Set<string>();
  for (const claim of targeted) {
    if (claim.mutuallyExclusiveWith === null) continue;
    const other = byId.get(claim.mutuallyExclusiveWith);
    // 互斥关系必须是双向确认的一对，孤立的单侧指向不构成"互斥"判定。
    if (other && other.mutuallyExclusiveWith === claim.claimId) {
      contestedIds.add(claim.claimId);
      contestedIds.add(other.claimId);
    }
  }

  const resultClaims: ClaimRecord[] = allClaims.map((c) =>
    contestedIds.has(c.claimId) ? { ...c, status: "contested" as ClaimStatusT } : c,
  );

  let merged = 0;
  for (const claim of targeted) {
    if (contestedIds.has(claim.claimId)) continue;
    if (claim.status === "accepted" && isProvenanceChainUnbroken(claim.provenance)) merged += 1;
  }

  return { merged, contested: [...contestedIds], claims: resultClaims };
}

/* ─────────────────────────── batchConfirmAndWriteBackToBrain（批量确认写回） ─────────────────────────── */

export type BatchWriteBackRejectReason = "NODE_NOT_CONFIRMED" | "SOURCE_CHAIN_BROKEN" | "VERSION_CHANGED";

export interface BatchWriteBackResult {
  readonly written: readonly string[];
  readonly rejected: readonly { readonly claimId: string; readonly reason: BatchWriteBackRejectReason }[];
}

/**
 * `batchConfirmAndWriteBackToBrain` 的纯判定部分（I-29 服务端闸门 + 部分成功常态）。
 *
 * ⚠ 并发（V9）：`expectedRevision !== currentRevision` 时**整批**拒绝 `VERSION_CHANGED`
 *   —— 批量确认动作本身是一次原子的乐观并发提交，版本不对时不做任何部分写入，
 *   调用方应刷新后重新提交（不是"整批失败"与"部分成功"混用同一个判据）。
 * ⚠ 版本一致时，**逐条**独立判定 NODE_NOT_CONFIRMED / SOURCE_CHAIN_BROKEN——
 *   一批里一条被拒不影响其余条目写入（"部分成功是这里的常态"，usecases.md 明文）。
 *   判定顺序：先查是否已由组长确认（`status === "accepted"`），再查来源链——
 *   未确认的节点即使来源链完整也必须先被 NODE_NOT_CONFIRMED 挡住，这是 I-29
 *   "服务端闸门"的字面意思：不是"来源链够就能写回"。
 */
export function batchConfirmAndWriteBackToBrain(params: {
  readonly claimIds: readonly string[];
  readonly allClaims: readonly ClaimRecord[];
  readonly expectedRevision: number;
  readonly currentRevision: number;
}): BatchWriteBackResult {
  if (params.expectedRevision !== params.currentRevision) {
    return {
      written: [],
      rejected: params.claimIds.map((claimId) => ({ claimId, reason: "VERSION_CHANGED" as const })),
    };
  }

  const byId = new Map(params.allClaims.map((c) => [c.claimId, c] as const));
  const written: string[] = [];
  const rejected: { claimId: string; reason: BatchWriteBackRejectReason }[] = [];

  for (const claimId of params.claimIds) {
    const claim = byId.get(claimId);
    if (!claim || claim.status !== "accepted") {
      rejected.push({ claimId, reason: "NODE_NOT_CONFIRMED" });
      continue;
    }
    if (!isProvenanceChainUnbroken(claim.provenance)) {
      rejected.push({ claimId, reason: "SOURCE_CHAIN_BROKEN" });
      continue;
    }
    written.push(claimId);
  }

  return { written, rejected };
}

/* ─────────────────────────── getNodeProvenance（来源链反查） ─────────────────────────── */

/**
 * 来源链反查的纯校验部分。链断时不返回可用的 provenance（对应契约
 * `getNodeProvenance` 的 `SOURCE_CHAIN_BROKEN` 错误码），调用方（application 层）
 * 负责观察者视角的脱敏聚合，本函数只管"链是否完整、能不能给出这四项"。
 */
export function getNodeProvenance(
  claimId: string,
  allClaims: readonly ClaimRecord[],
): { readonly ok: true; readonly provenance: NodeProvenanceT } | { readonly ok: false; readonly reason: "SOURCE_CHAIN_BROKEN" } {
  const claim = allClaims.find((c) => c.claimId === claimId);
  if (!claim || !isProvenanceChainUnbroken(claim.provenance)) {
    return { ok: false, reason: "SOURCE_CHAIN_BROKEN" };
  }
  return { ok: true, provenance: claim.provenance };
}
