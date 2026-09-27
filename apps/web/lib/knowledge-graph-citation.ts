/**
 * S7（#4364）—— 回答下的引用 chip：「依据你 9/20 的决定」、展开、跳回原消息。
 *
 * - 哪几条出 chip 由服务端对账（`getTurnMemory.cited`：本轮召回集合里、回答真的用到了的）；这里**不补、不猜**，
 *   `cited` 之外的一概不画。老的服务端不给 `cited` ⇒ 按 `recalled` 全部（S7 之前的样子）。
 * - 跳回原消息复用 R6 / F15 的同一条路：来源抽屉「跳到原消息」背后的 `threadOfClaimSource` + `highlightChatMessage`
 *   / `focusMessageHref`，不另写一份跳转。
 */
import type { KgRecalledMemory } from "@repo/contracts/chat-knowledge-graph";
import { fetchClaimSources } from "@/lib/knowledge-graph-api";
import { focusMessageHref, highlightChatMessage } from "@/lib/chat-message-focus";
import { threadOfClaimSource } from "@/components/chat/knowledge/thread-knowledge-tab";

/** 服务端对账后的引用（按召回名次）；`cited` 省略 ⇒ 全部 `recalled`。 */
export function citedMemories(recalled: readonly KgRecalledMemory[], cited: readonly string[] | undefined): KgRecalledMemory[] {
  if (cited === undefined) return [...recalled];
  const keep = new Set(cited);
  return recalled.filter((m) => keep.has(m.claimId));
}

function monthDay(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

/**
 * chip 上「依据你 9/20 的」那半句（后面紧跟类型：决定 / 目标 …）。长期记忆里的条目日期已经在「来自你 {M/D} 的对话」
 * 徽标上，这里不重复日期；没有时间 ⇒「依据你的」。
 */
export function citationBasisPrefix(m: Pick<KgRecalledMemory, "scope" | "saidAt">): string {
  const day = m.scope === "personal" ? null : monthDay(m.saidAt);
  return day === null ? "依据你的" : `依据你 ${day} 的`;
}

/**
 * 跳到这条记忆的原话（第一条支持它的对话消息）。就在当前对话、界面上已有它 ⇒ 就地滚动并高亮；否则打开那个对话再高亮。
 * 找不到能跳的原话（只剩附件片段 / 原对话已不可见）⇒ false，调用方如实提示。
 */
export async function jumpToCitationSource(claimId: string, currentThreadId: string): Promise<boolean> {
  const sources = await fetchClaimSources(claimId);
  const ev = sources.evidence.find((e) => e.sourceKind === "chat_message" && e.stance === "supporting")
    ?? sources.evidence.find((e) => e.sourceKind === "chat_message");
  if (ev === undefined) return false;
  const threadId = (await threadOfClaimSource(sources.claim)) ?? currentThreadId;
  if (threadId === currentThreadId && highlightChatMessage(ev.sourceRef)) return true;
  const projectId = threadId === currentThreadId ? new URLSearchParams(window.location.search).get("projectId") : null;
  window.location.assign(focusMessageHref({ threadId, messageId: ev.sourceRef, projectId }));
  return true;
}
