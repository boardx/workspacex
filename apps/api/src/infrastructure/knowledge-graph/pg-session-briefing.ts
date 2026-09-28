/**
 * issue #4362 —— `SessionBriefingPort` 的 Postgres 实现。
 *
 * 读（`sources`）只读**查看者本人**的个人空间，结果包在本人个人空间的 guard 里（与 getPersonalKnowledge 同一个 ref）：
 *   - 长期记忆（`claims.scope_kind = 'personal' AND scope_id = 本人`）里的目标 / 决定 / 待办，以及每条出自本人哪个个人对话；
 *   - 本人个人对话（`chat_threads.project_id IS NULL AND created_by = 本人 AND NOT archived`）里记下、还没进过长期记忆的待办；
 *   - 同样只在本人个人对话里、还开着的矛盾 / 可能改口卡（`kg_conflict_prompts.status = 'open'`，两条都还活着）；
 *   - 本人空间里活的 `serves_goal` 挂接。
 * 以上结论一律只取「还算数」的（S6：没过期、待办仍是 open；见 STILL_OPEN）——做完 / 不做了 / 过期的不是「未了事项」。
 * 项目会话、别人的个人对话一概不读（SQL 条件 + RLS：个人空间行只放给 app.current_user_id，I-14）。
 * 读之前设 `statement_timeout`：简报是开场的一眼，查慢了宁可这次不显示（调用方的界面不等它），也不拖住页面。
 *
 * 写（偏好 / 埋点）只碰两张本人私有的表（RLS：user_id = app.current_user_id），参数里的 userId 恒为登录用户（控制器取自会话）。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { SessionBriefingPort } from "../../application/knowledge-graph/profile-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { BriefingCard, BriefingClaim, BriefingSources, BriefingThreadTodo } from "../../domain/knowledge-graph/briefing";
import type { OrgId } from "../../domain/org-id";
import { personalSpaceRef } from "./pg-knowledge-read";

/** 简报查询的超时（毫秒）：超时即这次不显示简报（调用方把失败当作「没有简报」），不阻塞输入框。 */
export const BRIEFING_STATEMENT_TIMEOUT_MS = 2000;
/**
 * S6（#4363）× #4494 review B1：简报里只出「这一轮还算数」的——没过期（valid_to 还没到）、待办还开着（done / dropped 不算
 * 「未了事项」）。与召回的 recallable 同一个口径，外加 done（简报说的是还没做完的事）。claim_kind 可能为空 ⇒ IS DISTINCT FROM。
 */
const STILL_OPEN = (a: string) =>
  `(${a}.valid_to IS NULL OR ${a}.valid_to > now()) AND (${a}.claim_kind IS DISTINCT FROM 'todo' OR ${a}.todo_state = 'open')`;
const LIVE = `c.revoked_at IS NULL AND c.status <> 'superseded' AND ${STILL_OPEN("c")}`;
const OWN_PERSONAL_THREAD = "t.project_id IS NULL AND t.created_by = $2 AND NOT t.archived";
const SAID_AT = `(SELECT min(m.created_at) FROM claim_message_evidence e JOIN chat_messages m ON m.id = e.message_id AND m.org_id = e.org_id
    WHERE e.claim_id = c.id AND e.org_id = c.org_id AND e.stance = 'supporting') AS said_at`;

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const tri = (status: string) => KG.claimTriState(status as Parameters<typeof KG.claimTriState>[0]);

export class PgSessionBriefing implements SessionBriefingPort {
  constructor(private readonly db: DatabasePort) {}

  private asUser<T>(orgId: OrgId, userId: string, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      return fn(s);
    });
  }

  async sources(orgId: OrgId, userId: string): Promise<Guarded<BriefingSources>> {
    const data = await this.asUser(orgId, userId, async (s): Promise<BriefingSources> => {
      await s.query("SELECT set_config('statement_timeout', $1, true)", [String(BRIEFING_STATEMENT_TIMEOUT_MS)]);
      const scope = [orgId, userId];
      const personal = await s.query<{
        id: string; claim_kind: KG.KgClaimKind | null; statement: string; status: string; created_at: Date; said_at: Date | null; thread_id: string | null;
      }>(
        `SELECT c.id, c.claim_kind, c.statement, c.status, c.created_at, ${SAID_AT},
                (SELECT t.id FROM ontology_edges d
                   JOIN claims src ON src.id = d.dst_id AND src.org_id = d.org_id
                   JOIN chat_threads t ON t.org_id = src.org_id AND t.id = src.scope_id
                  WHERE d.org_id = c.org_id AND d.src_kind = 'claim' AND d.src_id = c.id AND d.relation = 'derived_from'
                    AND d.dst_kind = 'claim' AND d.status = 'active' AND src.scope_kind = 'chat_session' AND ${OWN_PERSONAL_THREAD}
                  ORDER BY d.created_at, d.id LIMIT 1) AS thread_id
           FROM claims c
          WHERE c.org_id = $1 AND c.scope_kind = 'personal' AND c.scope_id = $2 AND ${LIVE}
            AND c.claim_kind IN ('goal', 'decision', 'todo')
          ORDER BY c.created_at DESC, c.id LIMIT 50`, scope,
      );
      const todos = await s.query<{ id: string; statement: string; status: string; created_at: Date; said_at: Date | null; thread_id: string }>(
        `SELECT c.id, c.statement, c.status, c.created_at, ${SAID_AT}, t.id AS thread_id
           FROM claims c JOIN chat_threads t ON t.org_id = c.org_id AND t.id = c.scope_id
          WHERE c.org_id = $1 AND c.scope_kind = 'chat_session' AND ${LIVE} AND c.claim_kind = 'todo' AND ${OWN_PERSONAL_THREAD}
            AND NOT EXISTS (SELECT 1 FROM ontology_edges d JOIN claims p ON p.id = d.src_id AND p.org_id = d.org_id
                             WHERE d.org_id = c.org_id AND d.relation = 'derived_from' AND d.dst_kind = 'claim' AND d.dst_id = c.id
                               AND p.scope_kind = 'personal' AND p.scope_id = $2)
          ORDER BY c.created_at DESC, c.id LIMIT 20`, scope,
      );
      const cards = await s.query<{
        id: string; kind: KG.KgConflictPromptKind; thread_id: string; created_at: Date;
        newer_id: string; newer_statement: string; newer_kind: KG.KgClaimKind | null;
        older_id: string; older_statement: string;
      }>(
        `SELECT p.id, p.kind, p.thread_id, p.created_at,
                n.id AS newer_id, n.statement AS newer_statement, n.claim_kind AS newer_kind,
                o.id AS older_id, o.statement AS older_statement
           FROM kg_conflict_prompts p
           JOIN chat_threads t ON t.org_id = p.org_id AND t.id = p.thread_id
           JOIN claims n ON n.id = p.newer_claim_id AND n.org_id = p.org_id
           JOIN claims o ON o.id = p.older_claim_id AND o.org_id = p.org_id
          WHERE p.org_id = $1 AND p.status = 'open' AND ${OWN_PERSONAL_THREAD}
            AND n.scope_kind = 'chat_session' AND n.scope_id = p.thread_id AND n.revoked_at IS NULL AND n.status <> 'superseded'
            AND o.revoked_at IS NULL AND o.status <> 'superseded'
            AND ${STILL_OPEN("n")} AND ${STILL_OPEN("o")}
            AND ((o.scope_kind = 'chat_session' AND o.scope_id = p.thread_id) OR (o.scope_kind = 'personal' AND o.scope_id = $2))
          ORDER BY p.created_at DESC, p.id LIMIT 5`, scope,
      );
      const links = await s.query<{ src_id: string; dst_id: string }>(
        `SELECT src_id, dst_id FROM ontology_edges
          WHERE org_id = $1 AND scope_kind = 'personal' AND scope_id = $2 AND relation = 'serves_goal' AND status = 'active'
            AND src_kind = 'claim' AND dst_kind = 'claim'`, scope,
      );
      return {
        personal: personal.rows.flatMap((r): BriefingClaim[] => {
          const t = tri(r.status);
          return t === null ? [] : [{
            id: r.id, kind: r.claim_kind ?? "fact", statement: r.statement, triState: t,
            saidAt: iso(r.said_at), createdAt: r.created_at.toISOString(), threadId: r.thread_id,
          }];
        }),
        threadTodos: todos.rows.flatMap((r): BriefingThreadTodo[] => {
          const t = tri(r.status);
          return t === null ? [] : [{ id: r.id, statement: r.statement, triState: t, saidAt: iso(r.said_at), createdAt: r.created_at.toISOString(), threadId: r.thread_id }];
        }),
        cards: cards.rows.map((r): BriefingCard => ({
          promptId: r.id, kind: r.kind, threadId: r.thread_id, createdAt: r.created_at.toISOString(),
          newer: { id: r.newer_id, statement: r.newer_statement, kind: r.newer_kind ?? "fact", scope: "chat_session" },
          older: { id: r.older_id, statement: r.older_statement },
        })),
        goalOf: new Map(links.rows.map((l) => [l.src_id, l.dst_id])),
      };
    });
    return guard(personalSpaceRef(userId), data);
  }

  async dismissed(orgId: OrgId, userId: string): Promise<boolean> {
    return this.asUser(orgId, userId, async (s) => {
      const r = await s.query<{ dismissed: boolean }>(
        "SELECT dismissed FROM kg_briefing_preferences WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
      return r.rows[0]?.dismissed ?? false;
    });
  }

  async setDismissed(orgId: OrgId, userId: string, dismissed: boolean): Promise<boolean> {
    return this.asUser(orgId, userId, async (s) => {
      const r = await s.query<{ dismissed: boolean }>(
        `INSERT INTO kg_briefing_preferences (org_id, user_id, dismissed, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (org_id, user_id) DO UPDATE SET dismissed = EXCLUDED.dismissed, updated_at = EXCLUDED.updated_at
         RETURNING dismissed`, [orgId, userId, dismissed]);
      const row = r.rows[0];
      if (row === undefined) throw new Error("kg_briefing_preferences upsert returned no row");
      return row.dismissed;
    });
  }

  async recordEvent(orgId: OrgId, userId: string, event: KG.KgBriefingEvent, itemIds: readonly string[]): Promise<void> {
    await this.asUser(orgId, userId, (s) => s.query(
      "INSERT INTO kg_briefing_events (org_id, user_id, event, item_ids) VALUES ($1, $2, $3, $4::jsonb)",
      [orgId, userId, event, JSON.stringify(itemIds)]));
  }
}
