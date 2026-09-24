/**
 * Phase 18 F17 —— `MemoryCardPort` 的 Postgres 实现：只调三个数据库函数，不写一行表名 SQL。
 *
 * 开卡的复核在 `kg_open_memory_card`，人的决定在 `kg_act_on_memory_card`（迁移 20260924300000）；
 * 这里只把它抛出的 `KG_*` 翻成契约错误码，其余错误原样抛出，不伪装成「被拒」。
 * 卡片内容给用户看走 getTurnMemory 的守卫读路径（pg-knowledge-read.ts）。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import {
  KgHumanActionError, type KgHumanActionErrorCode, type MemoryCardOpenOutcome, type MemoryCardPort,
} from "../../application/knowledge-graph/ports";
import type { OrgId } from "../../domain/org-id";
import { isDeadlock, retryOnceOnDeadlock } from "./kg-deadlock-retry";

const CODES: readonly KgHumanActionErrorCode[] = [
  "KG_CARD_NOT_FOUND", "KG_CARD_STALE", "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN", "KG_CONTESTED_NEEDS_RESOLUTION",
  "KG_INVALID_REQUEST",
];
const OUTCOMES: readonly MemoryCardOpenOutcome[] = ["opened", "not_owner", "not_from_message", "not_personal", "no_items"];

export class PgMemoryCard implements MemoryCardPort {
  constructor(private readonly db: DatabasePort) {}

  async open(orgId: OrgId, input: Parameters<MemoryCardPort["open"]>[1]) {
    const r = await this.db.withTenant(orgId, (s) => s.query<{ r: { outcome?: string; card_id?: string } }>(
      "SELECT kg_open_memory_card($1::jsonb) AS r", [JSON.stringify({
        card_id: input.cardId, thread_id: input.threadId, run_id: input.runId, message_id: input.messageId,
        requester: input.requesterUserId, kind: input.kind,
        statement: input.statement ?? null, target: input.target ?? null, claim_ids: input.claimIds ?? [],
      })],
    ));
    const out = r.rows[0]?.r ?? {};
    const outcome = OUTCOMES.find((o) => o === out.outcome);
    if (outcome === undefined) throw new Error(`kg_open_memory_card returned an unknown outcome: ${String(out.outcome)}`);
    return { outcome, cardId: typeof out.card_id === "string" ? out.card_id : null };
  }

  async cardThread(orgId: OrgId, userId: string, cardId: string): Promise<string | null> {
    const r = await this.db.withTenant(orgId, async (s) => {
      await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      return s.query<{ t: string | null }>("SELECT kg_memory_card_thread($1) AS t", [cardId]);
    });
    return r.rows[0]?.t ?? null;
  }

  async act(orgId: OrgId, userId: string, input: Parameters<MemoryCardPort["act"]>[2]) {
    try {
      // F16 同一条纵深防御：死锁（40P01）时整个事务重来一次。
      return await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
        await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        const r = await s.query<{ r: { card: unknown; action_ids: string[] } }>("SELECT kg_act_on_memory_card($1::jsonb) AS r", [JSON.stringify({
          action_id: input.actionId, card_id: input.cardId, decision: input.decision, actor_kind: input.actorKind,
          ...(input.claimIds !== undefined ? { claim_ids: input.claimIds } : {}),
          ...(input.editedStatement !== undefined ? { edited_statement: input.editedStatement } : {}),
        })]);
        const row = r.rows[0]!.r;
        // 形状只有契约一份：数据库回来的卡片过一遍 KgMemoryCard，对不上就是实现错了，照样抛。
        return { card: KG.KgMemoryCard.parse(row.card), actionIds: row.action_ids };
      }));
    } catch (e) {
      // 重来一次仍死锁：翻成 KG_CARD_STALE（契约 actOnMemoryCard.err 里唯一「重读再点」的码）——界面据此重读这一轮、
      // 显示「内容已经变了，已为你刷新，请看最新的再决定」，卡还开着就能再点；不把 500 甩给用户。
      if (isDeadlock(e)) throw new KgHumanActionError("KG_CARD_STALE", "deadlock detected twice");
      const message = e instanceof Error ? e.message : "";
      const code = CODES.find((c) => message.startsWith(c));
      if (code !== undefined) throw new KgHumanActionError(code, message);
      throw e;
    }
  }
}
