/**
 * 组织大脑图的节点 kind / 边 relation —— 单一事实源（backlog D12，设计依据
 * `docs/research/super-instance-design.md` §2 / §2.1 / §2.2）。
 *
 * `ontology_edges` 的 `src_kind` / `dst_kind` 由 CHECK 约束写死（迁移 0009 起），
 * 本文件的 `OntologyNodeKind` 必须与迁移
 * `apps/api/migrations/20260924160000_d12_ontology_dev_process_projection.sql` 的 CHECK 列表
 * 逐字一致——由 `apps/api/tests/retrieval/ontology-projection-mapping.test.ts` 机械核对。
 *
 * ## 六跳路径需要的节点
 *
 * 客户实例 ─running→ 版本/发布 ←caused_by─ 缺陷 ←fixes─ PR ─decided_by→ 决策 … 证据（verified_by）
 *
 * ## 投影（人类决策 D17，读法 B）
 *
 * 开发过程那一半（发布 / PR / 缺陷 / feature / 证据）**权威仍是仓库文件**，产品侧只存
 * 可重建的投影：`ontology_edges.projection_source = 'repo'` 的行对产品只读（触发器拒绝），
 * 只有同步脚本 `apps/api/scripts/sync-dev-process-projection.ts` 能写。
 * `customer_instance` 只支持 kind，实例来自 D9/D10 遥测，本仓库**不捏造**任何实例。
 */
import { z } from "zod";

/** 迁移 0009 就有的产品域节点。 */
export const PRODUCT_NODE_KINDS = ["person", "project", "decision", "requirement", "research", "segment"] as const;

/** D12 新增：六跳路径所需节点。 */
export const DEV_PROCESS_NODE_KINDS = [
  "customer_instance",
  "release",
  "defect",
  "pull_request",
  "feature",
  "evidence",
] as const;

export const OntologyNodeKind = z.enum([...PRODUCT_NODE_KINDS, ...DEV_PROCESS_NODE_KINDS]);
export type OntologyNodeKind = z.infer<typeof OntologyNodeKind>;

/**
 * 六跳路径的边。`ontology_edges.relation` 仍是自由文本（产品侧其它边不受限），
 * 但投影边只允许这些 relation。
 */
export const DevProcessRelation = z.enum([
  "running", // customer_instance → release（D9/D10 遥测）
  "raised", // customer_instance → defect（D9/D10 遥测）
  "caused_by", // defect → release
  "contains", // release → pull_request
  "fixes", // pull_request → defect
  "decided_by", // pull_request → decision
  "verified_by", // feature / pull_request → evidence
]);
export type DevProcessRelation = z.infer<typeof DevProcessRelation>;

/** 投影来源。目前只有仓库一个权威源。 */
export const ProjectionSource = z.enum(["repo"]);
export type ProjectionSource = z.infer<typeof ProjectionSource>;

export const OntologyNodeRef = z.object({ kind: OntologyNodeKind, id: z.string().min(1) }).strict();
export type OntologyNodeRef = z.infer<typeof OntologyNodeRef>;

export const ProjectionEdge = z
  .object({
    id: z.string().min(1),
    src: OntologyNodeRef,
    dst: OntologyNodeRef,
    relation: DevProcessRelation,
    projectionSource: ProjectionSource,
  })
  .strict();
export type ProjectionEdge = z.infer<typeof ProjectionEdge>;
