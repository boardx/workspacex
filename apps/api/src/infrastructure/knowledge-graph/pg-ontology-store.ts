/**
 * Phase 18 F03 —— `OntologyStorePort` 的 Postgres 实现。
 *
 * 这里没有一条 INSERT：写入全部经 `kg_apply_batch`（SECURITY DEFINER，迁移 20260924190000），
 * 被拒动作经 `kg_record_rejected`。本类只负责把领域对象序列化成函数认的 jsonb，
 * 并把函数抛出的 `KG_*` 错误翻回拒绝码。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AppliedBatch, OntologyStorePort, RejectedBatch } from "../../application/knowledge-graph/ports";
import type { OntologyBatch, OntologyRejectCode } from "../../domain/knowledge-graph/ontology-batch";
import type { OrgId } from "../../domain/org-id";

const DB_REJECT_CODES: readonly OntologyRejectCode[] = [
  "KG_SCOPE_NOT_ENABLED", "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN", "KG_EVIDENCE_REQUIRED", "KG_EVIDENCE_NOT_FOUND",
];

export function toBatchPayload(batch: OntologyBatch): Record<string, unknown> {
  return {
    action_id: batch.actionId,
    scope_kind: batch.scope.kind,
    scope_id: batch.scope.id,
    actor_kind: batch.actor.kind,
    actor_id: batch.actor.id,
    action_type: batch.actionType,
    source_ref: batch.sourceRef,
    pipeline_version: batch.pipelineVersion,
    objects: batch.objects.map((o) => ({ id: o.id, object_kind: o.objectKind, name: o.name, aliases: o.aliases })),
    claims: batch.claims.map((c) => ({
      id: c.id, claim_kind: c.claimKind, statement: c.statement, status: c.status, confidence: c.confidence,
      evidence: c.evidence.map((e) => ({ segment_id: e.segmentId, stance: e.stance })),
    })),
    edges: batch.edges.map((e) => ({
      id: e.id, src_kind: e.srcKind, src_id: e.srcId, dst_kind: e.dstKind, dst_id: e.dstId, relation: e.relation,
    })),
  };
}

/** 数据库拒绝 ⇒ 拒绝码；其它错误（连接断了、bug）原样抛出，不伪装成「被拒」。 */
export function rejectionFromDbError(e: unknown): RejectedBatch | null {
  const err = e as { message?: unknown; code?: unknown };
  const message = typeof err.message === "string" ? err.message : "";
  const known = DB_REJECT_CODES.find((c) => message.startsWith(c));
  if (known !== undefined) return { code: known, reason: message };
  // 23xxx 完整性约束：枚举 / 取值范围不合格的抽取产物
  if (typeof err.code === "string" && err.code.startsWith("23")) return { code: "KG_INVALID_BATCH", reason: message };
  return null;
}

export class PgOntologyStore implements OntologyStorePort {
  constructor(private readonly db: DatabasePort) {}

  private inTenant<T>(orgId: OrgId, userId: string | null, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withTenant(orgId, async (s) => {
      if (userId !== null) await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      return fn(s);
    });
  }

  async apply(orgId: OrgId, currentUserId: string | null, batch: OntologyBatch) {
    try {
      const out = await this.inTenant(orgId, currentUserId, (s) =>
        s.query<{ r: Record<string, unknown> }>("SELECT kg_apply_batch($1::jsonb) AS r", [JSON.stringify(toBatchPayload(batch))]));
      const r = out.rows[0]!.r;
      const applied: AppliedBatch = {
        actionId: String(r.action_id),
        deduplicated: r.deduplicated === true,
        objects: Number(r.objects),
        claims: Number(r.claims),
        edges: Number(r.edges),
      };
      return { applied };
    } catch (e) {
      const rejected = rejectionFromDbError(e);
      if (rejected === null) throw e;
      return { rejected };
    }
  }

  async recordRejected(orgId: OrgId, currentUserId: string | null, batch: OntologyBatch, rejected: RejectedBatch) {
    const payload = toBatchPayload(batch);
    await this.inTenant(orgId, currentUserId, (s) => s.query("SELECT kg_record_rejected($1::jsonb)", [JSON.stringify({
      action_id: batch.actionId, scope_kind: batch.scope.kind, scope_id: batch.scope.id,
      actor_kind: batch.actor.kind, actor_id: batch.actor.id, action_type: batch.actionType,
      source_ref: batch.sourceRef, pipeline_version: batch.pipelineVersion,
      payload, reject_code: rejected.code, reject_reason: rejected.reason,
    })]));
  }
}
