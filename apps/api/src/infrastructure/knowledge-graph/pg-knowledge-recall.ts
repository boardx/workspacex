/**
 * Phase 18 F08 —— `KnowledgeRecallPort` 的 Postgres 实现。
 *
 * 候选集只读**这一轮所在会话**的活结论与实体（执行器已经是以发起人身份在这个会话里跑），
 * 读的时候设置 app.current_user_id：将来 F12 加进本人个人空间的行，也只放给本人（I-14）。
 * 图路只拿 id（kg_graph_neighbors），回到候选集求交，图里别的会话 / 别人的 id 不会漏出来。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type { KnowledgeRecallPort } from "../../application/knowledge-graph/ports";
import type { GraphHit, GraphHop, RecallClaim, RecallObject } from "../../domain/knowledge-graph/recall";
import type { OrgId } from "../../domain/org-id";

const stripKind = (key: string) => key.slice(key.indexOf(":") + 1);

export class PgKnowledgeRecall implements KnowledgeRecallPort {
  constructor(private readonly db: DatabasePort) {}

  async candidates(orgId: OrgId, userId: string, threadId: string) {
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const claims = await s.query<{ id: string; statement: string; status: string; claim_kind: RecallClaim["kind"] | null; said_at: Date | null }>(
        `SELECT c.id, c.statement, c.status, c.claim_kind,
                (SELECT min(m.created_at) FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
                  WHERE e.claim_id = c.id AND e.stance = 'supporting') AS said_at
           FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND c.scope_id = $2
            AND c.revoked_at IS NULL AND c.status <> 'superseded'`,
        [orgId, threadId],
      );
      const objects = await s.query<{ id: string; name: string; aliases: string[] }>(
        `SELECT id, name, aliases FROM ontology_objects
          WHERE org_id = $1 AND scope_kind = 'chat_session' AND scope_id = $2 AND merged_into IS NULL`,
        [orgId, threadId],
      );
      const out: { claims: RecallClaim[]; objects: RecallObject[] } = {
        claims: claims.rows.flatMap((c) => {
          const tri = KG.claimTriState(c.status as Parameters<typeof KG.claimTriState>[0]);
          return tri === null ? [] : [{ id: c.id, statement: c.statement, kind: c.claim_kind ?? "fact" as const, triState: tri, saidAt: c.said_at?.toISOString() ?? null, scope: "chat_session" as const }];
        }),
        objects: objects.rows.map((o) => ({ id: o.id, name: o.name, aliases: o.aliases })),
      };
      return out;
    });
  }

  async graphNeighbors(orgId: OrgId, seedKeys: readonly string[]): Promise<readonly GraphHit[]> {
    const r = await this.db.withTenant(orgId, (s) => s.query<{
      seed_key: string; rel1: string; mid1_key: string | null; rel2: string | null; mid2_key: string | null; rel3: string | null; claim_key: string;
    }>("SELECT * FROM kg_graph_neighbors($1::text[])", [seedKeys]));
    return r.rows.map((row) => {
      const nodes = [row.seed_key, row.mid1_key, row.mid2_key, row.claim_key].filter((x): x is string => x !== null);
      const rels = [row.rel1, row.rel2, row.rel3].filter((x): x is string => x !== null);
      const path: GraphHop[] = rels.map((relation, i) => ({ src: nodes[i]!, relation, dst: nodes[i + 1]! }));
      return { claimId: stripKind(row.claim_key), path };
    });
  }
}
