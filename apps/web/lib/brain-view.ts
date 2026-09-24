/**
 * 大脑页（/brain）的纯投影函数——只从真实读模型（`getPersonalKnowledge` / `getBrainOverview`）算，
 * 不带任何示例数字。2026-09-24 人类指令「取消所有的 mockup 的数据」。
 *
 * 用词守 `requirements/06-user-experience.md` R5（`KG_BANNED_USER_FACING_WORDS`）：
 * 界面说「长期记忆 / 记下的一条 / 人和事」，不说内部术语。
 */
import { KG_SCOPES_ENABLED_PHASE_18, type KgClaimKind, type KgScopeKind } from "@repo/contracts/chat-knowledge-graph";
import type { BrainOverview, PersonalKnowledge } from "@/lib/knowledge-graph-api";

type Claim = PersonalKnowledge["claims"][number];
export type PersonalClaimOrigin = BrainOverview["personalOrigins"][number];

/** 长期记忆的筛选：关键字（按原文包含，忽略大小写与首尾空白）+ 类型（null = 全部）。 */
export function filterPersonalClaims(claims: readonly Claim[], query: string, kind: KgClaimKind | null): Claim[] {
  const q = query.trim().toLowerCase();
  return claims.filter((c) => (kind === null || c.kind === kind) && (q === "" || c.statement.toLowerCase().includes(q)));
}

/** 每条长期记忆 → 它来自的对话（可能合并自多个对话）。 */
export function originsByClaim(origins: readonly PersonalClaimOrigin[]): Map<string, PersonalClaimOrigin[]> {
  const out = new Map<string, PersonalClaimOrigin[]>();
  for (const o of origins) out.set(o.personalClaimId, [...(out.get(o.personalClaimId) ?? []), o]);
  return out;
}

/** 按类型计数（只列有的类型，顺序同会话记忆面板）。 */
export function countByKind(claims: readonly Claim[]): { kind: KgClaimKind; count: number }[] {
  const order: KgClaimKind[] = ["decision", "fact", "todo", "risk", "hypothesis"];
  return order.map((kind) => ({ kind, count: claims.filter((c) => c.kind === kind).length })).filter((x) => x.count > 0);
}

/** 这一层记忆现在开放了没有——唯一依据是契约的 `KG_SCOPES_ENABLED_PHASE_18`，界面不另写一份。 */
export function isScopeOpen(scope: KgScopeKind): boolean {
  return (KG_SCOPES_ENABLED_PHASE_18 as readonly KgScopeKind[]).includes(scope);
}

/** 对话记忆的合计（页头与页签角标用）。 */
export function sessionTotals(threads: BrainOverview["threads"]): { threads: number; items: number; pending: number; conflict: number } {
  return threads.reduce(
    (acc, t) => ({ threads: acc.threads + 1, items: acc.items + t.claims, pending: acc.pending + t.pending, conflict: acc.conflict + t.conflict }),
    { threads: 0, items: 0, pending: 0, conflict: 0 },
  );
}
