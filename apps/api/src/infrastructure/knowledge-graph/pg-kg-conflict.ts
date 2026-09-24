/**
 * Phase 18 F16 —— `KgConflictPort` 的 Postgres 实现：只调两个数据库函数，不写一行表名 SQL。
 *
 * 读哪些行（这条消息刚抽出的结论；本会话、以及个人线程里所有者本人个人空间的「你确认过」）完全由
 * `kg_conflict_candidates` 决定，写入前的复核在 `kg_open_conflicts`（迁移 20260924290000）。
 * 读出的正文只交给判定规则（domain/knowledge-graph/conflict.ts），不回任何请求方——与 F06 抽取流水线同一性质：
 * 系统替这个会话做派生，不跨容器搬运。用户看到的提醒卡走 getTurnMemory 的守卫读路径（pg-knowledge-read.ts）。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { DatabasePort } from "../../application/ports/database.port";
import type { KgConflictPort } from "../../application/knowledge-graph/ports";
import type { ConfirmedClaim, ConflictPair, FreshClaim } from "../../domain/knowledge-graph/conflict";
import type { OrgId } from "../../domain/org-id";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const kind = (v: unknown): FreshClaim["kind"] | null => {
  const k = KG.KgClaimKind.safeParse(v);
  return k.success ? k.data : null;
};

export class PgKgConflict implements KgConflictPort {
  constructor(private readonly db: DatabasePort) {}

  async candidates(orgId: OrgId, threadId: string, messageId: string) {
    const r = await this.db.withTenant(orgId, (s) => s.query<{ c: { fresh?: Row[]; confirmed?: Row[] } }>(
      "SELECT kg_conflict_candidates($1, $2) AS c", [threadId, messageId],
    ));
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
    const r = await this.db.withTenant(orgId, (s) => s.query<{ n: number }>("SELECT kg_open_conflicts($1::jsonb) AS n", [JSON.stringify({
      action_id: input.actionId, thread_id: input.threadId, message_id: input.messageId,
      pairs: input.pairs.map((p) => ({ newer: p.newerClaimId, older: p.olderClaimId })),
    })]));
    return Number(r.rows[0]?.n ?? 0);
  }
}
