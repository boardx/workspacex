/**
 * 大脑页（/brain）的纯投影函数——只从真实读模型（`getPersonalKnowledge` / `getBrainOverview`）算，
 * 不带任何示例数字。2026-09-24 人类指令「取消所有的 mockup 的数据」。
 *
 * 用词守 `requirements/06-user-experience.md` R5（`KG_BANNED_USER_FACING_WORDS`）：
 * 界面说「长期记忆 / 记下的一条 / 人和事」，不说内部术语。
 */
import { KG_SCOPES_ENABLED_PHASE_18, type KgClaimKind, type KgScopeKind } from "@repo/contracts/chat-knowledge-graph";
import type { BrainOverview, PersonalKnowledge } from "@/lib/knowledge-graph-api";
import { KG_CLAIM_KIND_ORDER } from "@/lib/knowledge-graph-view";

type Claim = PersonalKnowledge["claims"][number];
export type PersonalClaimOrigin = BrainOverview["personalOrigins"][number];
export type PersonalReplaced = PersonalKnowledge["replaced"][number];

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

/** issue #4302：每条活着的长期记忆 → 它取代掉的旧记忆（折叠显示「取代了：…」）。 */
export function replacedByClaim(replaced: readonly PersonalReplaced[]): Map<string, PersonalReplaced[]> {
  const out = new Map<string, PersonalReplaced[]>();
  for (const r of replaced) out.set(r.byClaimId, [...(out.get(r.byClaimId) ?? []), r]);
  // issue #4363（S6）：链式取代历史按离活记忆的步数排（step 省略 = 1）：从新到旧，211 → 985 → 清华 显示为「985、211」。
  for (const list of out.values()) list.sort((a, b) => (a.step ?? 1) - (b.step ?? 1));
  return out;
}

/** issue #4302：一条长期记忆最早是哪天说的（多个来源取最早）；没有时间为 null。界面文案走 `personalOriginLabel`。 */
export function earliestSaidAt(origins: readonly PersonalClaimOrigin[]): string | null {
  let best: string | null = null;
  for (const o of origins) {
    if (o.saidAt === null || Number.isNaN(Date.parse(o.saidAt))) continue;
    if (best === null || Date.parse(o.saidAt) < Date.parse(best)) best = o.saidAt;
  }
  return best;
}

/**
 * issue #4302「忘掉这条」——只复用既有动作，不加新的后端语义。一条长期记忆的每个来源各走一步：
 *   - 这条仍是「AI 记下的」、且这个来源是系统自动记下的（#4283）⇒ `undoAutoPersonalCopy`：
 *     只拿掉长期记忆里的那份（副本只剩这一个来源 ⇒ 失效；还有别的来源 ⇒ 只摘掉这一个），对话里那条不动；
 *   - 其余（你确认过的、你点「记到我的长期记忆」记下的）⇒ 在来源对话里 `revokeClaim` 那条原话记下的：
 *     与对话「记忆」页签的「忘掉这条」同一个动作，F07 级联让长期记忆里那份在所有**活来源**都忘掉后一起失效
 *     （活来源 = 活的 derived_from 边 + 来源结论未失效，即 `personalOrigins` 列出的那些；被撤销自动记入摘掉的来源
 *     不再撑着它——20260927100000_kg_f07_active_sources_only.sql，#4302 review）。
 * 没有来源（出自的对话已不在）⇒ null：没有既有动作能忘掉它，界面不给按钮（不去动任何对话里的结论）。
 * 顺序：不碰对话结论的 `undoAutoCopy` 在前，会忘掉对话里那条的 `revokeSource` 在后——中途失败时，
 * 对话里的结论尽量还没被动过。
 * 个人空间里的那条本身没有可直接撤回的既有动作（applyHumanAction 只作用于对话；F17 忘掉卡只在对话回答下出现），
 * 所以只能走来源；做完后调用方重读核对，仍活着就如实说（BRAIN_FORGET_STILL_LIVE_ZH）。
 */
export type ForgetStep =
  | { readonly kind: "undoAutoCopy"; readonly threadId: string; readonly sourceClaimId: string }
  | { readonly kind: "revokeSource"; readonly threadId: string; readonly sourceClaimId: string };

export function forgetPlan(claim: Pick<Claim, "triState">, origins: readonly PersonalClaimOrigin[]): ForgetStep[] | null {
  if (origins.length === 0) return null;
  const steps = origins.map((o): ForgetStep => ({
    kind: o.autoCopied && claim.triState === "pending" ? "undoAutoCopy" : "revokeSource",
    threadId: o.threadId,
    sourceClaimId: o.sourceClaimId,
  }));
  return [...steps.filter((s) => s.kind === "undoAutoCopy"), ...steps.filter((s) => s.kind === "revokeSource")];
}

/** 按类型计数（只列有的类型，顺序同会话记忆面板）。 */
export function countByKind(claims: readonly Claim[]): { kind: KgClaimKind; count: number }[] {
  return KG_CLAIM_KIND_ORDER.map((kind) => ({ kind, count: claims.filter((c) => c.kind === kind).length })).filter((x) => x.count > 0);
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
