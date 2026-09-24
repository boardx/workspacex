/**
 * 组织大脑图的节点 kind / 边 relation —— 单一事实源（backlog D12，设计依据
 * `docs/research/super-instance-design.md` §2 / §2.1 / §2.2）。
 *
 * `ontology_edges` 的 `src_kind` / `dst_kind` 由 CHECK 约束写死（迁移 0009 起），
 * 本文件的 `OntologyNodeKind` 必须与迁移
 * `apps/api/migrations/20260924220000_d12_ontology_dev_process_projection.sql` 的 CHECK 列表
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

/** D4：仓库里的方法论文档（`.harness/instructions`）与模块经验（`mod-*` SKILL.md 踩坑段）。
 *  ADR 用已有的 `decision` kind。 */
export const KNOWLEDGE_NODE_KINDS = ["methodology", "lesson"] as const;

export const OntologyNodeKind = z.enum([...PRODUCT_NODE_KINDS, ...DEV_PROCESS_NODE_KINDS, ...KNOWLEDGE_NODE_KINDS]);
export type OntologyNodeKind = z.infer<typeof OntologyNodeKind>;

/** Phase 18 规范本体（kg_f02，ADR-114）的边端点类型；节点本身住在 `ontology_objects` / `claims`，不进 `ontology_nodes`。 */
export const CANONICAL_KG_ENDPOINT_KINDS = ["object", "claim", "chat_message"] as const;

/** `ontology_edges` 两端允许的全部类型——迁移里 src/dst 两条 CHECK 与它逐项对账。 */
export const EdgeEndpointKind = z.enum([...OntologyNodeKind.options, ...CANONICAL_KG_ENDPOINT_KINDS]);
export type EdgeEndpointKind = z.infer<typeof EdgeEndpointKind>;

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

/** 投影来源：仓库（D12 开发过程 + D4 知识）与车队遥测（D11 客户实例，权威在 D10 边缘投影）。 */
export const ProjectionSource = z.enum(["repo", "telemetry"]);
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

/**
 * D4 / D11 —— `ontology_nodes` 投影行（迁移 20260924240000）。`key` 是图里的节点 id（边的
 * src_id/dst_id 引用它，如 `ADR-012`、64 位实例哈希）；`id` 是由 (org, kind, key) 内容哈希得到
 * 的行主键；`contentHash` 是正文哈希，重跑时据此判断是否需要更新。
 */
export const ProjectionNode = z
  .object({
    id: z.string().min(1),
    kind: OntologyNodeKind,
    key: z.string().min(1),
    title: z.string().min(1),
    body: z.string(),
    sourcePath: z.string().nullable(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    projectionSource: ProjectionSource,
  })
  .strict();
export type ProjectionNode = z.infer<typeof ProjectionNode>;

/**
 * D11 —— 六跳路径检索结果：客户实例 → 发布 → PR → 缺陷 → 决策 → 证据。
 * 前四跳沿 running / contains / fixes 走；决策与证据挂在同一个 PR 上（decided_by / verified_by）。
 * 缺的跳是 null（诚实地说图里还没有），不是省略。
 */
export const SixHopPath = z
  .object({
    customerInstance: z.string(),
    release: z.string(),
    pullRequest: z.string(),
    defect: z.string().nullable(),
    decision: z.string().nullable(),
    evidence: z.string().nullable(),
  })
  .strict();
export type SixHopPath = z.infer<typeof SixHopPath>;
