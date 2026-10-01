/**
 * S7（#4364）—— 引用纠正的 Postgres 实现。
 *
 * - 写：只调 `kg_correct_citation`（迁移 20260928190000）；所有者 / 提问人 / 召回集合 / 结论现状都在数据库里复核，
 *   这里只把它抛出的 `KG_*` 翻成契约错误码，其余错误原样抛出，不伪装成「被拒」。
 * - `expireClaim`（「已过时」）：整家 `valid_to = now()`（S6 #4363 的有效期，不撤；迁移 20260928220000，F4）。
 * - 读（纠正率的原料）：本人提问的回答（`kg_turn_recalls.requester_user_id = 本人`）的正文 + 那一轮召回到的结论原文，
 *   以及本人的纠正次数。结论原文**不按现在是否有效过滤**：纠正之后那条已经失效，但它当时被引用过，分母里要算上。
 *   整份挂在本人个人空间的 guard ref 上（只给本人）；RLS 也只放本人的个人空间与本人的纠正记录（I-14）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  CitationCorrectionPort, CitationMetricsSource, CitationTarget, ClaimExpiryPort,
} from "../../application/knowledge-graph/citation-ports";
import { KgHumanActionError, type KgHumanActionErrorCode } from "../../application/knowledge-graph/ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import { retryOnceOnDeadlock } from "./kg-deadlock-retry";
import { personalSpaceRef } from "./pg-knowledge-read";

const CODES: readonly KgHumanActionErrorCode[] = ["KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN", "KG_CLAIM_NOT_FOUND", "KG_INVALID_REQUEST"];
/** 一次最多复算这么多条回答（时间窗内最近的）：指标是质量信号，不为它扫全表。 */
const METRICS_MAX_TURNS = 2000;

export class PgCitationCorrection implements CitationCorrectionPort, ClaimExpiryPort {
  constructor(private readonly db: DatabasePort) {}

  private async correct(orgId: OrgId, userId: string, target: CitationTarget, kind: "wrong" | "expired", replacement: string | null) {
    try {
      return await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
        await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        const r = await s.query<{ r: { outcome: "forgotten" | "superseded" | "expired"; new_claim_id: string | null } }>(
          "SELECT kg_correct_citation($1::jsonb) AS r",
          [JSON.stringify({
            action_id: target.actionId, thread_id: target.threadId, message_id: target.messageId, claim_id: target.claimId,
            kind, ...(replacement !== null ? { replacement } : {}),
          })],
        );
        const out = r.rows[0]!.r;
        return { outcome: out.outcome, newClaimId: out.new_claim_id ?? null };
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const code = CODES.find((c) => message.startsWith(c));
      if (code !== undefined) throw new KgHumanActionError(code, message);
      throw e;
    }
  }

  retract(orgId: OrgId, userId: string, target: CitationTarget, replacement: string | null) {
    return this.correct(orgId, userId, target, "wrong", replacement);
  }

  /** 整家 valid_to = now()（不撤回），并记一条纠正事件（迁移 20260928220000）。 */
  async expireClaim(orgId: OrgId, userId: string, target: CitationTarget): Promise<void> {
    await this.correct(orgId, userId, target, "expired", null);
  }

  async metricsSource(orgId: OrgId, userId: string, windowDays: number): Promise<Guarded<CitationMetricsSource>> {
    const data = await this.db.withTenant(orgId, async (s): Promise<CitationMetricsSource> => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const turns = await s.query<{ body: string; claim_ids: string[] }>(
        `SELECT m.body, ARRAY(SELECT i->>'claimId' FROM jsonb_array_elements(r.items) WITH ORDINALITY AS a(i, n) ORDER BY n) AS claim_ids
           FROM kg_turn_recalls r
           JOIN chat_messages m ON m.org_id = r.org_id AND m.agent_run_id = r.run_id AND m.thread_id = r.thread_id
          WHERE r.org_id = $1 AND r.requester_user_id = $2 AND r.created_at >= now() - make_interval(days => $3::int)
            AND jsonb_array_length(r.items) > 0
          ORDER BY r.created_at DESC LIMIT ${METRICS_MAX_TURNS}`,
        [orgId, userId, windowDays],
      );
      const ids = [...new Set(turns.rows.flatMap((t) => t.claim_ids))];
      const claims = ids.length === 0 ? { rows: [] as { id: string; statement: string }[] } : await s.query<{ id: string; statement: string }>(
        "SELECT c.id, c.statement FROM claims c WHERE c.org_id = $1 AND c.id = ANY($2::text[])", [orgId, ids],
      );
      const statement = new Map(claims.rows.map((c) => [c.id, c.statement]));
      const corrections = await s.query<{ kind: "wrong" | "expired"; n: string }>(
        `SELECT kind, count(*) AS n FROM kg_citation_corrections
          WHERE org_id = $1 AND user_id = $2 AND created_at >= now() - make_interval(days => $3::int) GROUP BY kind`,
        [orgId, userId, windowDays],
      );
      const count = (k: "wrong" | "expired") => Number(corrections.rows.find((r) => r.kind === k)?.n ?? 0);
      return {
        turns: turns.rows.map((t) => ({
          answer: t.body,
          recalled: t.claim_ids.flatMap((id) => {
            const st = statement.get(id);
            return st === undefined ? [] : [{ claimId: id, statement: st }];
          }),
        })),
        corrections: { wrong: count("wrong"), expired: count("expired") },
      };
    });
    return guard(personalSpaceRef(userId), data);
  }
}
