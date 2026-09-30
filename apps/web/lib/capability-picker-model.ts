/**
 * 聊天「选数字人」浮层的纯数据模型（2026-09-30 人类反馈重设计）：分组、排序、筛选、副标题去重。
 *
 * 组件（`chat-task-workbench-capability-picker.tsx`）只负责渲染；这里是「哪张卡落在哪一组、
 * 以什么顺序、副标题显示什么」的唯一实现，便于单测，不在组件里散落第二份判断。
 *
 * 分组（自上而下）：
 *   1. 数字人      —— 可用、且目录卡片是官方角色或带数字人肖像（`dh-*`）的 Agent；官方在前，其余保持服务端顺序（稳定排序）。
 *   2. 待启用      —— 本组织尚未导入的官方数字人（`getOfficialRolePackOffer().pending`），不可选。
 *   3. 其他 Agent  —— 可用、非数字人。
 *   4. 不可用（n） —— `isCapabilityReady=false` 的全部 Agent，折叠在底部，给一句短原因。
 */
import { identity } from "@repo/contracts";
import type { CapabilityListing } from "./live-capabilities";
import { ROLE_CATEGORY_LABEL, type AgentDirectoryCard, type PendingOfficialRole } from "./agent-directory";

export type PickerDirectory = ReadonlyMap<string, AgentDirectoryCard>;
export type PickerFilter = { readonly kind: "tag"; readonly value: string } | null;

export interface PickerEntry {
  readonly listing: CapabilityListing;
  readonly card: AgentDirectoryCard | undefined;
  /** 名字下面那一行；与名字相同（忽略大小写/空白）时为 null，不重复显示。 */
  readonly subtitle: string | null;
  readonly tags: readonly string[];
}

export interface PickerGroups {
  readonly digitalHumans: readonly PickerEntry[];
  readonly pending: readonly PendingOfficialRole[];
  readonly others: readonly PickerEntry[];
  readonly unavailable: readonly PickerEntry[];
  /** 标签筛选 chip：当前数据里出现过的标签并集（数字人在前）。 */
  readonly tagOptions: readonly string[];
  /** 未经搜索/筛选时是否一个 Agent 都没有（空态判据）。 */
  readonly isEmpty: boolean;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** 数字人的标签：真实 `tags` 优先；一个都没有时回退为 `roleCategory` 分类名。 */
export function agentTagsOf(card: AgentDirectoryCard | undefined): readonly string[] {
  if (card === undefined) return [];
  if (card.tags.length > 0) return card.tags;
  return card.roleCategory ? [ROLE_CATEGORY_LABEL[card.roleCategory]] : [];
}

/** 副标题：roleLabel → duty；与名字相同则不显示（截图里「DT Agent / DT Agent」）。 */
export function subtitleFor(name: string, card: AgentDirectoryCard | undefined, duty: string | null | undefined): string | null {
  for (const candidate of [card?.roleLabel ?? "", duty ?? ""]) {
    const t = candidate.trim();
    if (t && norm(t) !== norm(name)) return t;
  }
  return null;
}

export function isDigitalHuman(card: AgentDirectoryCard | undefined): boolean {
  if (card === undefined) return false;
  return card.catalogSource === "official" || (card.avatar?.key ?? "").startsWith("dh-");
}

/** 不可用的一句短原因：取服务端 `disabledReason` 的第一小句（完整原文放 title）。 */
export function shortReason(reason: string | null | undefined): string {
  const t = (reason ?? "").trim();
  if (!t) return "暂不可用";
  return t.split(/[，。,;；]/)[0]!.replace(/^该\s*Agent\s*/, "") || t;
}

function haystack(parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function buildPickerGroups(input: {
  readonly listings: readonly CapabilityListing[];
  readonly directory: PickerDirectory;
  readonly pending?: readonly PendingOfficialRole[];
  readonly query?: string;
  readonly filter?: PickerFilter;
}): PickerGroups {
  const { listings, directory, pending = [], filter = null } = input;
  const q = norm(input.query ?? "");
  const entries: PickerEntry[] = listings.map((listing) => {
    const card = directory.get(listing.id);
    return { listing, card, subtitle: subtitleFor(listing.name, card, listing.duty), tags: agentTagsOf(card) };
  });

  const dhTags = entries.filter((e) => isDigitalHuman(e.card)).flatMap((e) => e.tags);
  const tagOptions = [...new Set([...dhTags, ...pending.flatMap((p) => p.tags), ...entries.flatMap((e) => e.tags)])];

  const entryMatches = (e: PickerEntry): boolean => {
    if (filter?.kind === "tag" && !e.tags.includes(filter.value)) return false;
    if (!q) return true;
    return haystack([e.listing.name, e.listing.duty, e.card?.roleLabel, ...e.tags, ...(e.card?.workflows.map((w) => w.name) ?? [])]).includes(q);
  };
  const pendingMatches = (p: PendingOfficialRole): boolean => {
    if (filter?.kind === "tag" && !p.tags.includes(filter.value)) return false;
    return !q || haystack([p.name, p.roleLabel, ...p.tags]).includes(q);
  };

  const visible = entries.filter(entryMatches);
  const ready = visible.filter((e) => identity.isCapabilityReady(e.listing));
  const official = (e: PickerEntry) => (e.card?.catalogSource === "official" ? 0 : 1);
  const digitalHumans = ready
    .filter((e) => isDigitalHuman(e.card))
    .sort((a, b) => official(a) - official(b));

  return {
    digitalHumans,
    pending: pending.filter(pendingMatches),
    others: ready.filter((e) => !isDigitalHuman(e.card)),
    unavailable: visible.filter((e) => !identity.isCapabilityReady(e.listing)),
    tagOptions,
    isEmpty: listings.length === 0 && pending.length === 0,
  };
}
