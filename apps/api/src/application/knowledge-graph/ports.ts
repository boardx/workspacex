/**
 * Phase 18 知识图谱的端口。应用层定义、基础设施实现（依赖倒置）。
 */
import type { OrgId } from "../../domain/org-id";
import type { OntologyBatch, OntologyRejectCode } from "../../domain/knowledge-graph/ontology-batch";

export interface AppliedBatch {
  readonly actionId: string;
  /** 同一 `(sourceRef, pipelineVersion, actionType)` 已成功处理过 ⇒ true，本次什么都没写（I-7）。 */
  readonly deduplicated: boolean;
  readonly objects: number;
  readonly claims: number;
  readonly edges: number;
}

export interface RejectedBatch {
  readonly code: OntologyRejectCode;
  readonly reason: string;
}

/**
 * 本体的唯一写入口（I-3）。实现只允许经数据库里的 `kg_apply_batch` 落表，
 * 不许在实现里直接 INSERT —— 数据库那一侧也会拒（`kg_scoped_write_guard`）。
 */
export interface OntologyStorePort {
  /** 数据库复核不变量失败时，返回 `{ rejected }` 而不是抛出。 */
  apply(
    orgId: OrgId,
    currentUserId: string | null,
    batch: OntologyBatch,
  ): Promise<{ readonly applied: AppliedBatch } | { readonly rejected: RejectedBatch }>;
  /** 被拒的动作也留痕（uc-18-1 E2）。 */
  recordRejected(orgId: OrgId, currentUserId: string | null, batch: OntologyBatch, rejected: RejectedBatch): Promise<void>;
}

export const ONTOLOGY_STORE_PORT = Symbol("OntologyStorePort");
