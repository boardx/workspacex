/**
 * issue #4283 —— `KgAutoCopyPort` 的 Postgres 实现：只调三个数据库函数（迁移 20260926131000），不写一行表名 SQL。
 *
 * - `candidates` / `copy`：系统身份，**不**声明 app.current_user_id——目标空间由数据库从证据消息的作者推出，
 *   本文件既不读也不传「写进谁的空间」。
 * - `undo`：人的动作，声明 app.current_user_id = 登录用户，数据库只在这个人自己的空间里找。
 * 数据库的拒绝码翻成结构化错误（复制：`KgAutoCopyRejected`；撤销：`KgHumanActionError`）；其余错误原样抛出。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import {
  KgAutoCopyRejected, KgHumanActionError, type KgAutoCopyPort, type KgAutoCopyRejectCode, type KgHumanActionErrorCode,
} from "../../application/knowledge-graph/ports";
import type { OrgId } from "../../domain/org-id";
import { retryOnceOnDeadlock } from "./kg-deadlock-retry";

const COPY_CODES: readonly KgAutoCopyRejectCode[] = [
  "KG_NOT_AUTHOR", "KG_NOT_OWNER", "KG_CLAIM_NOT_FOUND", "KG_CONTESTED_NEEDS_RESOLUTION", "KG_EVIDENCE_REVOKED", "KG_SCOPE_NOT_ENABLED",
];
const UNDO_CODES: readonly KgHumanActionErrorCode[] = ["KG_ACTOR_NOT_HUMAN", "KG_CLAIM_NOT_FOUND"];

type Row = { id?: unknown; statement?: unknown };
const pairs = (v: unknown): { id: string; statement: string }[] =>
  (Array.isArray(v) ? (v as Row[]) : [])
    .filter((x) => typeof x.id === "string" && typeof x.statement === "string")
    .map((x) => ({ id: x.id as string, statement: x.statement as string }));

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : "");

export class PgKgAutoCopy implements KgAutoCopyPort {
  constructor(private readonly db: DatabasePort) {}

  async candidates(orgId: OrgId, threadId: string, messageId: string) {
    const r = await this.db.withTenant(orgId, (s) =>
      s.query<{ c: { author?: unknown; fresh?: unknown; personal?: unknown } }>("SELECT kg_auto_copy_candidates($1, $2) AS c", [threadId, messageId]));
    const out = r.rows[0]?.c ?? {};
    const author = typeof out.author === "string" && out.author !== "" ? out.author : null;
    return author === null ? { author, fresh: [], personal: [] } : { author, fresh: pairs(out.fresh), personal: pairs(out.personal) };
  }

  async copy(orgId: OrgId, input: {
    readonly actionId: string; readonly threadId: string; readonly messageId: string; readonly claimId: string;
    readonly mode: "new" | "merge"; readonly targetClaimId?: string;
  }): Promise<string> {
    try {
      const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, (s) => s.query<{ id: string }>(
        "SELECT kg_auto_copy_decision($1::jsonb) AS id",
        [JSON.stringify({
          action_id: input.actionId, thread_id: input.threadId, message_id: input.messageId, claim_id: input.claimId,
          mode: input.mode, target_claim_id: input.targetClaimId ?? null,
        })],
      )));
      return r.rows[0]!.id;
    } catch (e) {
      const code = COPY_CODES.find((c) => messageOf(e).startsWith(c));
      if (code !== undefined) throw new KgAutoCopyRejected(code, messageOf(e));
      throw e;
    }
  }

  async undo(orgId: OrgId, userId: string, input: { readonly actionId: string; readonly threadId: string; readonly claimId: string }) {
    try {
      const r = await this.db.withTenant(orgId, async (s) => {
        await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        return s.query<{ r: { personal_claim_id: string; outcome: "revoked" | "detached" } }>(
          "SELECT kg_undo_auto_copy($1::jsonb) AS r",
          [JSON.stringify({ action_id: input.actionId, thread_id: input.threadId, claim_id: input.claimId })],
        );
      });
      const out = r.rows[0]!.r;
      return { personalClaimId: out.personal_claim_id, outcome: out.outcome };
    } catch (e) {
      const code = UNDO_CODES.find((c) => messageOf(e).startsWith(c));
      if (code !== undefined) throw new KgHumanActionError(code, messageOf(e));
      throw e;
    }
  }
}
