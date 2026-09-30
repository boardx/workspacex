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
import { findBuiltinWorkflow } from "./workflow-display-copy";

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

/**
 * 预览栏「擅长」：不再回显名字（复审：擅长写着「Design Thinking Expert」= 什么都没说）。
 * 顺序：与名字/头衔不同的 `duty` → 标签（无标签时 `agentTagsOf` 已回退为角色分类）→ 可发起流程名（前 3 个）。
 * 都没有 → null（调用方给中性兜底）。
 */
export function strengthsFor(listing: Pick<CapabilityListing, "name" | "duty">, card: AgentDirectoryCard | undefined): string | null {
  const duty = (listing.duty ?? "").trim();
  const echoes = [listing.name, card?.roleLabel ?? "", card?.name ?? ""].map(norm);
  if (duty && !echoes.includes(norm(duty))) return duty;
  const tags = agentTagsOf(card);
  if (tags.length > 0) return tags.join("、");
  const flows = workflowLabelsOf(card);
  if (flows.length > 0) return joinWithOverflow(flows, 3);
  return null;
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
    return haystack([e.listing.name, e.listing.duty, e.card?.roleLabel, ...e.tags, ...workflowLabelsOf(e.card), ...(e.card?.workflows.map((w) => w.name) ?? [])]).includes(q);
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

/**
 * 流程的中文显示名：内置工作流走 `workflow-display-copy`（单源）；非内置取目录名，
 * 并去掉「（…）」补充说明——绝不把 `W028` / `research-to-insight` 这类技术 id 上屏。
 */
export function workflowLabel(w: { readonly stableId: string; readonly name: string }): string {
  const head = (w.name.split(/[（(]/)[0] ?? "").trim();
  const builtin = findBuiltinWorkflow(w.stableId) ?? findBuiltinWorkflow(head.replace(/\s+/g, "-"));
  if (builtin) return builtin.name;
  return head || "未命名流程";
}

export function workflowLabelsOf(card: AgentDirectoryCard | undefined): string[] {
  return [...new Set((card?.workflows ?? []).map(workflowLabel))];
}

/** 按条目边界截断：「A、B、C 等 5 个」——不在某个名字中间切断。 */
export function joinWithOverflow(items: readonly string[], max: number): string {
  if (items.length <= max) return items.join("、");
  return `${items.slice(0, max).join("、")} 等 ${items.length} 个`;
}
