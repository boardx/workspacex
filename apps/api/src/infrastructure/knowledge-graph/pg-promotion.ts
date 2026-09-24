/**
 * Phase 18 F11 —— `PromotionPort` 的 Postgres 实现。
 *
 * 读方法把结果包进 `guard()`（与知识读接口同一个 ref），调用方交出会话可见性判定才拿得到；
 * 写只经 `kg_promote_claim`。读的时候设 app.current_user_id：个人空间的行只放给本人（I-14）。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import {
  KgHumanActionError, type KgHumanActionErrorCode, type KnowledgeThreadRef, type PromotionPort,
} from "../../application/knowledge-graph/ports";
import { guard } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";

const threadRef = (t: KnowledgeThreadRef) => ({ kind: "project" as const, id: t.projectId ?? `personal:${t.threadId}` });
const LIVE = "c.revoked_at IS NULL AND c.status <> 'superseded'";
const CODES: readonly KgHumanActionErrorCode[] = [
  "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN", "KG_SCOPE_NOT_PERSONAL", "KG_CLAIM_NOT_FOUND",
  "KG_CONTESTED_NEEDS_RESOLUTION", "KG_EVIDENCE_REVOKED",
];

export class PgPromotion implements PromotionPort {
  constructor(private readonly db: DatabasePort) {}

  private asUser<T>(orgId: OrgId, userId: string, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      return fn(s);
    });
  }

  async personalClaims(orgId: OrgId, userId: string, thread: KnowledgeThreadRef) {
    const rows = await this.asUser(orgId, userId, (s) => s.query<{ id: string; statement: string }>(
      `SELECT c.id, c.statement FROM claims c
        WHERE c.org_id = $1 AND c.scope_kind = 'personal' AND c.scope_id = $2 AND ${LIVE} ORDER BY c.created_at, c.id`,
      [orgId, userId],
    ));
    return guard(threadRef(thread), rows.rows);
  }

  async threadClaims(orgId: OrgId, userId: string, thread: KnowledgeThreadRef, claimIds: readonly string[]) {
    const rows = await this.asUser(orgId, userId, (s) => s.query<{ id: string; statement: string }>(
      `SELECT c.id, c.statement FROM claims c
        WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id = $2 AND c.id = ANY($3::text[]) AND ${LIVE}`,
      [orgId, thread.threadId, claimIds],
    ));
    return guard(threadRef(thread), rows.rows);
  }

  async nominationCandidates(orgId: OrgId, userId: string, thread: KnowledgeThreadRef) {
    // 还没晋升过（没有本人的 L1 结论 derived_from 它）、不冲突、还有支持证据的结论。
    const rows = await this.asUser(orgId, userId, (s) => s.query<{ id: string; kind: string; status: string; statement: string }>(
      `SELECT c.id, coalesce(c.claim_kind, 'fact') AS kind, c.status, c.statement FROM claims c
        WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id = $2 AND ${LIVE} AND c.status <> 'contested'
          AND (EXISTS (SELECT 1 FROM claim_message_evidence e WHERE e.claim_id = c.id AND e.stance = 'supporting')
            OR EXISTS (SELECT 1 FROM claim_segments g WHERE g.claim_id = c.id AND g.stance = 'supporting'))
          AND NOT EXISTS (SELECT 1 FROM ontology_edges d JOIN claims p ON p.id = d.src_id AND p.org_id = d.org_id
                           WHERE d.org_id = c.org_id AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = c.id
                             AND d.status = 'active' AND p.scope_kind = 'personal' AND p.scope_id = $3)`,
      [orgId, thread.threadId, userId],
    ));
    return guard(threadRef(thread), rows.rows);
  }

  async promote(orgId: OrgId, userId: string, input: {
    readonly actionId: string; readonly threadId: string; readonly claimId: string; readonly mode: "new" | "merge"; readonly targetClaimId?: string;
  }): Promise<string> {
    try {
      return await this.asUser(orgId, userId, async (s) => {
        const r = await s.query<{ id: string }>("SELECT kg_promote_claim($1::jsonb) AS id", [JSON.stringify({
          action_id: input.actionId, thread_id: input.threadId, claim_id: input.claimId, mode: input.mode,
          target_claim_id: input.targetClaimId ?? null,
        })]);
        return r.rows[0]!.id;
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const code = CODES.find((c) => message.startsWith(c));
      if (code !== undefined) throw new KgHumanActionError(code, message);
      throw e;
    }
  }
}
