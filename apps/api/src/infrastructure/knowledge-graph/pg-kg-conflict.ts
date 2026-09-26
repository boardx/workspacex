/**
 * Phase 18 F16 —— `KgConflictPort` 的 Postgres 实现：只调两个数据库函数，不写一行表名 SQL。
 *
 * 读哪些行（这条消息刚抽出的结论；本会话、以及个人线程里所有者本人个人空间的「你确认过」）完全由
 * `kg_conflict_candidates` 决定，写入前的复核在 `kg_open_conflicts`（迁移 20260924290000）。
 * 读出的正文只交给判定规则（domain/knowledge-graph/conflict.ts），不回任何请求方——与 F06 抽取流水线同一性质：
 * 系统替这个会话做派生，不跨容器搬运。用户看到的提醒卡走 getTurnMemory 的守卫读路径（pg-knowledge-read.ts）。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { KgConflictPort } from "../../application/knowledge-graph/ports";
import type { ConfirmedClaim, ConflictPair, FreshClaim } from "../../domain/knowledge-graph/conflict";
import type { LiveDecision, SupersedeFresh } from "../../domain/knowledge-graph/decision-supersede";
import { toOrgId, type OrgId } from "../../domain/org-id";
import { retryOnceOnDeadlock } from "./kg-deadlock-retry";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const kind = (v: unknown): FreshClaim["kind"] | null => {
  const k = KG.KgClaimKind.safeParse(v);
  return k.success ? k.data : null;
};

/**
 * 以会话所有者身份声明 `app.current_user_id`：数据库函数只在声明了、且声明的就是所有者时才拿所有者的个人空间来比
 * （I-14 默认关——忘了声明就只比本会话，不会读到任何人的个人空间）。所有者 id 由 `kg_thread_owner` 给，本文件不读表。
 */
async function asThreadOwner(s: TenantSession, threadId: string): Promise<void> {
  await s.query("SELECT set_config('app.current_user_id', coalesce(kg_thread_owner($1), ''), true)", [threadId]);
}

export class PgKgConflict implements KgConflictPort {
  constructor(private readonly db: DatabasePort) {}

  async candidates(orgId: OrgId, threadId: string, messageId: string) {
    const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
      await asThreadOwner(s, threadId);
      return s.query<{ c: { fresh?: Row[]; confirmed?: Row[] } }>("SELECT kg_conflict_candidates($1, $2) AS c", [threadId, messageId]);
    }));
    const out = r.rows[0]?.c ?? {};
    const fresh: FreshClaim[] = [];
    for (const x of out.fresh ?? []) {
      const k = kind(x.kind);
      if (k === null) continue;
      fresh.push({ id: str(x.id), kind: k, statement: str(x.statement), confidence: Number(x.confidence) || 0, about: names(x.about) });
    }
    const confirmed: ConfirmedClaim[] = [];
    for (const x of out.confirmed ?? []) {
      const k = kind(x.kind);
      if (k === null || (x.scope !== "chat_session" && x.scope !== "personal")) continue;
      confirmed.push({ id: str(x.id), kind: k, statement: str(x.statement), about: names(x.about), scope: x.scope, confirmedAt: str(x.confirmedAt) });
    }
    return { fresh, confirmed };
  }

  async open(orgId: OrgId, input: {
    readonly actionId: string; readonly threadId: string; readonly messageId: string; readonly pairs: readonly ConflictPair[];
  }): Promise<number> {
    const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
      await asThreadOwner(s, input.threadId);
      return s.query<{ n: number }>("SELECT kg_open_conflicts($1::jsonb) AS n", [JSON.stringify({
        action_id: input.actionId, thread_id: input.threadId, message_id: input.messageId,
        pairs: input.pairs.map((p) => ({ newer: p.newerClaimId, older: p.olderClaimId })),
      })]);
    }));
    return Number(r.rows[0]?.n ?? 0);
  }

  async supersedeCandidates(orgId: OrgId, threadId: string, messageId: string) {
    // #4290：同 candidates——以所有者身份声明，数据库函数才拿所有者本人的个人空间来比（迁移 20260926140000）。
    const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
      await asThreadOwner(s, threadId);
      return s.query<{ c: { fresh?: Row[]; live?: Row[] } }>("SELECT kg_supersede_candidates($1, $2) AS c", [threadId, messageId]);
    }));
    const out = r.rows[0]?.c ?? {};
    const fresh: SupersedeFresh[] = [];
    for (const x of out.fresh ?? []) {
      const k = kind(x.kind);
      if (k === null) continue;
      fresh.push({ id: str(x.id), kind: k, statement: str(x.statement), authorId: strOrNull(x.authorId) });
    }
    const live: LiveDecision[] = [];
    for (const x of out.live ?? []) {
      const k = kind(x.kind);
      if (k === null || (x.scope !== "chat_session" && x.scope !== "personal")) continue;
      live.push({ id: str(x.id), kind: k, statement: str(x.statement), authorId: strOrNull(x.authorId), scope: x.scope });
    }
    return { fresh, live };
  }

  async applySupersedes(orgId: OrgId, input: {
    readonly actionId: string; readonly threadId: string; readonly messageId: string;
    readonly supersedes: readonly { readonly newer: string; readonly olders: readonly string[] }[];
    readonly prompts: readonly { readonly newer: string; readonly older: string }[];
  }): Promise<number> {
    const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, async (s) => {
      await asThreadOwner(s, input.threadId);
      return s.query<{ n: number }>("SELECT kg_apply_supersedes($1::jsonb) AS n", [JSON.stringify({
        action_id: input.actionId, thread_id: input.threadId, message_id: input.messageId, supersedes: input.supersedes,
        prompts: input.prompts,
      })]);
    }));
    return Number(r.rows[0]?.n ?? 0);
  }

  async pendingCloseOrgs(): Promise<readonly OrgId[]> {
    // 只回 org id（队列表的 org_id 列），不回任何内容：同 F06 kg_extraction_pending_orgs。
    const r = await this.db.withoutTenant((s) => s.query<{ org: string }>("SELECT kg_conflict_close_pending_orgs() AS org"));
    return r.rows.map((x) => toOrgId(x.org));
  }

  async drainCloseOne(orgId: OrgId): Promise<boolean> {
    // 一次一张卡、一张卡一个事务（见迁移里 kg_conflict_close_drain 的注释）
    const r = await retryOnceOnDeadlock(() => this.db.withTenant(orgId, (s) => s.query<{ done: boolean }>("SELECT kg_conflict_close_drain() AS done")));
    return r.rows[0]?.done === true;
  }
}
