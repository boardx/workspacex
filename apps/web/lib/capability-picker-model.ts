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
import { workflowLabel, workflowLabelsOf } from "./workflow-catalog-title-copy";

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

/**
 * 不可用原因 → 客户端中文文案（短句 + 完整一句）。服务端原文可能带端点 URL、技术 id 或英文，
 * 一律不直接上屏：按已知口径归类，认不出的走中性兜底。
 */
const REASON_COPY: readonly { readonly match: RegExp; readonly short: string; readonly full: string }[] = [
  { match: /已发布版本|no published|unpublished/i, short: "尚未发布", full: "这位数字人还没有可用的发布版本，请联系管理员发布后再选。" },
  { match: /本地组织|不在本机|local/i, short: "本地组织不可用", full: "本地组织只使用本机上的服务，这一项在云端，所以无法选用。" },
  { match: /停用|disabled/i, short: "已被停用", full: "组织管理员已停用这一项，如需使用请联系管理员。" },
  { match: /权限|forbidden|permission/i, short: "无使用权限", full: "你当前没有使用它的权限，可以联系管理员开通。" },
];

export function reasonCopy(reason: string | null | undefined): { readonly short: string; readonly full: string } {
  const t = (reason ?? "").trim();
  const hit = t ? REASON_COPY.find((r) => r.match.test(t)) : undefined;
  return hit ?? { short: "暂不可用", full: "这位数字人暂时无法选用，请稍后再试或联系管理员。" };
}

export function shortReason(reason: string | null | undefined): string {
  return reasonCopy(reason).short;
}

/**
 * 预览栏「适合这样问」：由可发起流程 / 标签派生的示例说法（最多 3 条），填预览下半部，不留空白。
 */
export function examplePromptsFor(card: AgentDirectoryCard | undefined): string[] {
  const flows = workflowLabelsOf(card);
  if (flows.length > 0) return flows.slice(0, 3).map((w) => `帮我走一遍「${w}」`);
  const tags = agentTagsOf(card);
  if (tags.length > 0) return tags.slice(0, 2).map((t) => `关于${t}，帮我梳理一下思路`).concat("先听听你的建议");
  return ["帮我整理一下这件事的要点", "先听听你的建议"];
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


export { workflowLabel, workflowLabelsOf };

/** 按条目边界截断：「A、B、C 等 5 个」——不在某个名字中间切断。 */
export function joinWithOverflow(items: readonly string[], max: number): string {
  if (items.length <= max) return items.join("、");
  return `${items.slice(0, max).join("、")} 等 ${items.length} 个`;
}

/** 待启用官方数字人的可发起流程：只列内置工作流的中文名（未知 stableId 不上屏，只计数）。 */
export function pendingWorkflowLabels(role: Pick<PendingOfficialRole, "workflowAllowlist">): { labels: string[]; unknown: number } {
  const labels: string[] = [];
  let unknown = 0;
  for (const id of role.workflowAllowlist) {
    const w = findBuiltinWorkflow(id);
    if (w) labels.push(w.name);
    else unknown += 1;
  }
  return { labels: [...new Set(labels)], unknown };
}

/** 自动匹配预览「适合这样问」：取候选数字人的第一条示例说法，最多 3 条；没有候选给通用说法。 */
export function autoExamplePrompts(suggestions: readonly PickerEntry[]): string[] {
  const out = [...new Set(suggestions.map((e) => examplePromptsFor(e.card)[0]).filter((q): q is string => Boolean(q)))].slice(0, 3);
  return out.length > 0 ? out : ["帮我整理一下这件事的要点", "先听听你的建议"];
}
