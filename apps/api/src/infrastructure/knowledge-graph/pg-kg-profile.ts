/**
 * issue #4360 —— `GoalLinkPort` 的 Postgres 实现：只调三个数据库函数（迁移 20260927130000），不写一行表名 SQL。
 *
 * - `candidates` / 系统身份的 `set`：**不**声明 app.current_user_id——作者由数据库从证据消息推出（同 #4283 的自动记入）。
 * - 人身份的 `set` / `revise`：声明 app.current_user_id = 登录用户，数据库只在这个人自己的空间里找。
 * 数据库的拒绝码翻成 `KgHumanActionError`；其余错误原样抛出。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import { KgHumanActionError, type KgHumanActionErrorCode } from "../../application/knowledge-graph/ports";
import type { GoalLinkPort } from "../../application/knowledge-graph/profile-ports";
import type { OrgId } from "../../domain/org-id";
import { retryOnceOnDeadlock } from "./kg-deadlock-retry";

const CODES: readonly KgHumanActionErrorCode[] = [
  "KG_ACTOR_NOT_HUMAN", "KG_CLAIM_NOT_FOUND", "KG_CONTESTED_NEEDS_RESOLUTION", "KG_NOT_OWNER",
];
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : "");
function translate(e: unknown): never {
  const m = messageOf(e);
  const code = CODES.find((c) => m.startsWith(c));
  if (code !== undefined) throw new KgHumanActionError(code, m);
  // 系统身份的作者判定失败（消息不是本人说的）：对调用方就是「这一条挂不上」。
  if (m.startsWith("KG_NOT_AUTHOR")) throw new KgHumanActionError("KG_CLAIM_NOT_FOUND", m);
  throw e;
}

type Row = { id?: unknown; statement?: unknown; kind?: unknown };

export class PgKgProfile implements GoalLinkPort {
  constructor(private readonly db: DatabasePort) {}

  async candidates(orgId: OrgId, threadId: string, messageId: string) {
    const r = await this.db.withTenant(orgId, (s) =>
      s.query<{ c: { author?: unknown; items?: unknown; goals?: unknown } }>("SELECT kg_goal_link_candidates($1, $2) AS c", [threadId, messageId]));
    const out = r.rows[0]?.c ?? {};
    const author = typeof out.author === "string" && out.author !== "" ? out.author : null;
    if (author === null) return { author, items: [], goals: [] };
    const items = (Array.isArray(out.items) ? (out.items as Row[]) : []).flatMap((x) => {
      const kind = KG.KgClaimKind.safeParse(x.kind);
      return typeof x.id === "string" && typeof x.statement === "string" && kind.success ? [{ id: x.id, statement: x.statement, kind: kind.data }] : [];
    });
    const goals = (Array.isArray(out.goals) ? (out.goals as Row[]) : []).flatMap((x) =>
      typeof x.id === "string" && typeof x.statement === "string" ? [{ id: x.id, statement: x.statement }] : []);
    return { author, items, goals };
  }

  async set(
    orgId: OrgId,
    actor: { readonly kind: "system"; readonly threadId: string; readonly messageId: string } | { readonly kind: "human"; readonly userId: string },
    input: { readonly actionId: string; readonly claimId: string; readonly goalClaimId: string | null; readonly confidence?: number },
  ) {
    const payload = {
      action_id: input.actionId, claim_id: input.claimId, goal_claim_id: input.goalClaimId, confidence: input.confidence ?? null,
      ...(actor.kind === "system" ? { thread_id: actor.threadId, message_id: actor.messageId } : {}),
    };
    try {
      const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
        if (actor.kind === "human") await s.query("SELECT set_config('app.current_user_id', $1, true)", [actor.userId]);
        return s.query<{ r: { claim_id: string; goal_claim_id: string | null; outcome: "linked" | "unlinked" | "unchanged" } }>(
          "SELECT kg_set_goal_link($1::jsonb) AS r", [JSON.stringify(payload)]);
      }));
      const out = r.rows[0]!.r;
      return { claimId: out.claim_id, goalClaimId: out.goal_claim_id, outcome: out.outcome };
    } catch (e) {
      return translate(e);
    }
  }

  async revise(orgId: OrgId, userId: string, input: { readonly actionId: string; readonly claimId: string; readonly statement: string }) {
    try {
      const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
        await s.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
        return s.query<{ id: string }>("SELECT kg_revise_personal_claim($1::jsonb) AS id",
          [JSON.stringify({ action_id: input.actionId, claim_id: input.claimId, statement: input.statement })]);
      }));
      return r.rows[0]!.id;
    } catch (e) {
      return translate(e);
    }
  }
}
