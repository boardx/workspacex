/**
 * Phase 18 F10 —— `HumanActionPort` 的 Postgres 实现：只调 `kg_apply_human_action`，把它抛出的
 * `KG_*` 翻成契约错误码。其余错误原样抛出，不伪装成「被拒」。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import {
  KgHumanActionError, type HumanActionPort, type KgHumanAction, type KgHumanActionErrorCode,
} from "../../application/knowledge-graph/ports";
import type { OrgId } from "../../domain/org-id";

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
      return await this.db.withTenant(orgId, async (s) => {
        await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        const r = await s.query<{ r: { revision: number; action_id: string } }>(
          "SELECT kg_apply_human_action($1::jsonb) AS r",
          [JSON.stringify({ action_id: input.actionId, thread_id: input.threadId, based_on_revision: input.basedOnRevision, action: input.action })],
        );
        return { revision: Number(r.rows[0]!.r.revision), actionId: r.rows[0]!.r.action_id };
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const code = CODES.find((c) => message.startsWith(c));
      if (code !== undefined) throw new KgHumanActionError(code, message);
      throw e;
    }
  }
}
