/**
 * Phase 18 F10 —— `HumanActionPort` 的 Postgres 实现：只调 `kg_apply_human_action`，把它抛出的
 * `KG_*` 翻成契约错误码。其余错误原样抛出，不伪装成「被拒」。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import {
  KgHumanActionError, type HumanActionPort, type KgHumanAction, type KgHumanActionErrorCode,
} from "../../application/knowledge-graph/ports";
import type { OrgId } from "../../domain/org-id";
import { isDeadlock, retryOnceOnDeadlock } from "./kg-deadlock-retry";

const CODES: readonly KgHumanActionErrorCode[] = [
  "KG_NOT_OWNER", "KG_ACTOR_NOT_HUMAN", "KG_REVISION_CHANGED", "KG_CLAIM_NOT_FOUND",
  "KG_OBJECT_NOT_FOUND", "KG_CONTESTED_NEEDS_RESOLUTION", "KG_PROMPT_NOT_FOUND",
];

export class PgHumanAction implements HumanActionPort {
  constructor(private readonly db: DatabasePort) {}

  async apply(orgId: OrgId, userId: string, input: {
    readonly actionId: string; readonly threadId: string; readonly basedOnRevision: number; readonly action: KgHumanAction;
  }) {
    try {
      return await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
        await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        const r = await s.query<{ r: { revision: number; action_id: string } }>(
          // F16：矛盾提醒的出口单独一个函数（同样的所有者 / 会话锁 / revision 前置），见迁移 20260924290000。
          input.action.type === "resolveConflict" ? "SELECT kg_resolve_conflict($1::jsonb) AS r" : "SELECT kg_apply_human_action($1::jsonb) AS r",
          [JSON.stringify({ action_id: input.actionId, thread_id: input.threadId, based_on_revision: input.basedOnRevision, action: input.action })],
        );
        // F16：一个动作可能连带结束冲突（kg_conflict_close_on_change 各记一条动作），版本号按落表后重数。
        const rev = await s.query<{ n: string }>("SELECT kg_thread_revision($1) AS n", [input.threadId]);
        return { revision: Number(rev.rows[0]!.n), actionId: r.rows[0]!.r.action_id };
      }));
    } catch (e) {
      // 重来一次仍死锁：对用户就是「刚才有别的改动撞上了」——同「内容已变化，请再操作一次」，不是 500。
      if (isDeadlock(e)) throw new KgHumanActionError("KG_REVISION_CHANGED", "deadlock detected twice");
      const message = e instanceof Error ? e.message : "";
      const code = CODES.find((c) => message.startsWith(c));
      if (code !== undefined) throw new KgHumanActionError(code, message);
      throw e;
    }
  }
}
