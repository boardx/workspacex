"use client";
import { identity } from "@repo/contracts";

import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";
import type { CapabilityListing } from "@/lib/live-capabilities";
import { CapabilityEditionNote } from "@/components/chat/capability-edition-note";
import {
  ROLE_CATEGORY_LABEL,
  listAgentDirectory,
  type AgentDirectoryCard,
} from "@/lib/agent-directory";

/**
 * issue #2130（TW-P0-2，回指 #2068）—— 「选择能力」的六项披露卡片列表 + 承载它的浮层。
 *
 * ## 2026-09-02 composer 重设计：三件套
 *
 * `CapabilityCardList`（纯列表，六项披露的唯一实现）、`CapabilityPopover`（挂在互斥槽
 * `chat-capability-picker` 上的浮层壳：定位 + outside-click / Escape）、`CapabilityPicker`
 * （卡片上方右对齐的低调触发器——「选择能力」已移出输入区）。卡片 testid / data 属性
 * 逐字不动。
 *
 * ## 为什么是新组件，不是原地改 `AgentPicker`
 *
 * `AgentPicker`（`chat-composer-pickers.tsx`）是一个**裸下拉**，被
 * `personal-chat-screen.tsx`/`chat-read-screen.tsx`/`chat-skill-mount-panel.tsx`
 * 等多处复用，形状是"选项只有名字"。TW-P0-2 要求的是完全不同的交互（默认自动匹配、
 * 每项展开成六件披露的卡片），原地改会改变那几个无关调用方的行为。这里独立写一份，
 * 数据源仍是同一条 `listCapabilities(orgId, "agent")`（由调用方 `copilotkit-v2-panel.tsx`
 * 读取后把原始 `CapabilityListing[]` 传进来，不在这里重新发请求）。
 *
 * ## 六项披露的范围裁决（issue #2130 已在开工前逐项 grep 确认，写在这里作为唯一事实源）
 *
 * - 「擅长什么」—— `CapabilityListing.duty`，真实字段，非空（DB CHECK
 *   `capability_listings_agent_needs_abbr_duty` 强制）。
 * - 「可用工具与技能」「能读哪些材料」「是否写文件/调外部服务」—— **后端契约
 *   （`packages/contracts/src/identity.ts` 的 `CapabilityListing`）与
 *   `apps/deep-agent-service` 均无对应字段**（issue #2130 开工前 grep 零命中）。
 *   如实标注「暂缺该项披露」，不编造数据——这是本仓反伪造条款的直接要求。
 * - 「记忆范围」—— 全仓当前**没有**跨线程/长期记忆机制（同样已 grep 确认），
 *   因此对全部能力恒为「仅本对话」：这是一个架构级事实，不是编的组织配置，
 *   日后接上跨线程记忆时需要回来改这里的常量。
 * - 「当前状态」—— 真实可计算：`enabled=false` → "failed"（原因取
 *   `disabledReason`，真实字段）；是当前选中且正在对话的那个 agent → 用真实
 *   `agent.isRunning`/`isReady` 派生；其余 → "ready"（这句话本身是真的：
 *   已启用且运行时可用的能力才可以被选中使用）。
 *
 * ## 2026-09-29 数字人选择器（人类指令：「点出来的列表应该是看到数字人的列表，可以通过
 *    tags、search 来搜索合适的数字人」）
 *
 * 列表仍以 `CapabilityListing[]` 为准（选得中/选不中的唯一判据 `isCapabilityReady`），
 * 另外按 id 合并成员 Agent 目录 `GET /agents/directory`（`listAgentDirectory`，与
 * `/agent` 目录页同一数据源；`agents.id === capability_listings.id`，见
 * `pg-capability-repository.ts` 的 JOIN）取真人像 `avatar.key`（dh-*）、`roleLabel`、
 * `roleCategory`、`tags` 与已授权 `workflows`。标签筛选用数字人的真实 `tags`（管理员在
 * 角色区块编辑，发布后生效）：筛选 chip = 列表里出现过的标签并集；没打标签的数字人回退为
 * 其 `roleCategory` 分类名（`agentTagsOf`，唯一实现）。
 * 目录读失败（无权限/离线）时静默退回首字母头像，选择器本身不受影响。
 */

export type CapabilityCardStatus = "ready" | "running" | "awaiting-approval" | "failed";

export interface CapabilityCardActingState {
  readonly agentId: string;
  readonly status: CapabilityCardStatus;
}

/**
 * 见文件头「记忆范围」一节的裁决理由，唯一事实源在这里，不在别处重复声明。
 * `_SHORT` 是卡片压缩排版里实际显示的文案；完整解释放进该 span 的 `title`
 * （鼠标悬停可见），不再常驻占一整行。
 */
const MEMORY_SCOPE_SHORT_LABEL = "仅本对话";
const MEMORY_SCOPE_FULL_LABEL = "记忆范围：仅本对话（本仓当前无跨线程记忆机制）";

function statusLabel(status: CapabilityCardStatus): string {
  switch (status) {
    case "ready": return "随时可用";
    case "running": return "正在工作";
    case "awaiting-approval": return "等你确认";
    case "failed": return "暂不可用";
    default: return status;
  }
}

function abbrFor(listing: CapabilityListing): string {
  const trimmed = (listing.abbr ?? "").trim();
  if (trimmed) return trimmed.slice(0, 2).toUpperCase();
  const name = listing.name.trim() || listing.id;
  return name.slice(0, 2).toUpperCase();
}

export type DigitalHumanDirectory = ReadonlyMap<string, AgentDirectoryCard>;

/** 目录读一次、按 id 建索引；失败 → 空表（退回首字母头像），不把错误抛给聊天。 */
export function useDigitalHumanDirectory(
  enabled: boolean,
  fetchDirectory: () => Promise<readonly AgentDirectoryCard[]> = listAgentDirectory,
): DigitalHumanDirectory {
  const [map, setMap] = React.useState<DigitalHumanDirectory>(() => new Map());
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchDirectory().then(
      (cards) => { if (alive) setMap(new Map(cards.map((c) => [c.agentId, c]))); },
      () => { /* 目录不可读：保持空表，卡片退回首字母头像与 duty 文案 */ },
    );
    return () => { alive = false; };
  }, [enabled, fetchDirectory]);
  return map;
}

function DigitalHumanAvatar({ listing, card, size }: { listing: CapabilityListing; card: AgentDirectoryCard | undefined; size: "xs" | "sm" | "md" }): JSX.Element {
  return <Avatar initials={card?.initials || abbrFor(listing)} avatarKey={card?.avatar?.key ?? null} tone="ai" size={size} />;
}

/** 数字人的标签：真实 `tags` 优先；一个都没有时回退为 `roleCategory` 分类名。 */
export function agentTagsOf(card: AgentDirectoryCard | undefined): readonly string[] {
  if (card === undefined) return [];
  if (card.tags.length > 0) return card.tags;
  return card.roleCategory ? [ROLE_CATEGORY_LABEL[card.roleCategory]] : [];
}

function searchableText(listing: CapabilityListing, card: AgentDirectoryCard | undefined): string {
  return [listing.name, listing.duty ?? "", card?.roleLabel ?? "", ...agentTagsOf(card), ...(card?.workflows.map((w) => w.name) ?? [])].join(" ").toLowerCase();
}

export interface CapabilityCardListProps {
  readonly listings: readonly CapabilityListing[];
  /** `null` = 未手选（默认自动匹配服务端配置的默认 agent，见判据 TW-P0-2①）。 */
  readonly selectedAgentId: string | null;
  /** `null` = 选回「自动匹配」。 */
  readonly onSelect: (agentId: string | null) => void;
  /** 当前实际在对话的那个 agent 的真实运行态；只在它等于某张卡片时用于覆盖 "ready"。 */
  readonly acting?: CapabilityCardActingState | null;
  /** 成员目录（按 agentId）；缺省空表 = 只用 `CapabilityListing` 自身字段。 */
  readonly directory?: DigitalHumanDirectory;
  /** 打开时把焦点放进搜索框。 */
  readonly autoFocusSearch?: boolean;
}

const EMPTY_DIRECTORY: DigitalHumanDirectory = new Map();
type TagFilter = { kind: "tag"; value: string } | { kind: "ready" } | null;

/** 数字人选择列表：搜索 + 标签筛选 + 「自动匹配」首项 + 数字人卡片（`role="listbox"`）。 */
export function CapabilityCardList({
  listings, selectedAgentId, onSelect, acting = null, directory = EMPTY_DIRECTORY, autoFocusSearch = false,
}: CapabilityCardListProps): JSX.Element {
  const [query, setQuery] = React.useState("");
  const [tag, setTag] = React.useState<TagFilter>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const searchId = React.useId();

  const tagOptions = [...new Set(listings.flatMap((l) => agentTagsOf(directory.get(l.id))))];
  const q = query.trim().toLowerCase();
  const visible = listings.filter((l) => {
    const card = directory.get(l.id);
    if (q && !searchableText(l, card).includes(q)) return false;
    if (tag?.kind === "tag" && !agentTagsOf(card).includes(tag.value)) return false;
    if (tag?.kind === "ready" && !identity.isCapabilityReady(l)) return false;
    return true;
  });
  const filtering = q !== "" || tag !== null;

  function focusOption(delta: 1 | -1 | "first") {
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
    if (opts.length === 0) return;
    const at = opts.indexOf(document.activeElement as HTMLButtonElement);
    const next = delta === "first" ? 0 : Math.min(opts.length - 1, Math.max(0, at + delta));
    opts[next]?.focus();
  }
  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); focusOption(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusOption(-1); }
  }

  const chip = (active: boolean) => [
    "shrink-0 rounded-pill border px-2 py-0.5 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-card-foreground",
  ].join(" ");

  return (
    <div className="flex w-[min(22rem,calc(100vw-2rem))] flex-col">
      <div className="flex flex-col gap-1.5 border-b border-border p-2">
        <label htmlFor={searchId} className="sr-only">搜索数字人</label>
        <input
          id={searchId}
          type="search"
          data-testid="chat-task-workbench-capability-search"
          value={query}
          autoFocus={autoFocusSearch}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); focusOption("first"); } }}
          placeholder="搜索数字人：名字、角色、标签、擅长的事"
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-12 text-background-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div role="group" aria-label="按标签筛选" data-testid="chat-task-workbench-capability-tags" className="flex flex-wrap gap-1">
          <button type="button" aria-pressed={tag === null} className={chip(tag === null)} onClick={() => setTag(null)}>全部</button>
          <button type="button" aria-pressed={tag?.kind === "ready"} className={chip(tag?.kind === "ready")} onClick={() => setTag(tag?.kind === "ready" ? null : { kind: "ready" })}>可用</button>
          {tagOptions.map((t) => {
            const active = tag?.kind === "tag" && tag.value === t;
            return (
              <button key={t} type="button" aria-pressed={active} data-tag={t} className={chip(active)} onClick={() => setTag(active ? null : { kind: "tag", value: t })}>
                {t}
              </button>
            );
          })}
        </div>
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="选择数字人"
        /* issue #2130 —— 保留既有 e2e（`copilotkit-v2-agent-switch.spec.ts`，
           issue #2023）依赖的下拉容器锚点名，这里只是同一个下拉换了皮肤。 */
        data-testid="chat-agent-select-listbox"
        onKeyDown={onListKeyDown}
        className="flex max-h-[min(24rem,60vh)] flex-col gap-1 overflow-y-auto p-1.5"
      >
        {!filtering ? (
          <button
            type="button"
            role="option"
            aria-selected={selectedAgentId === null}
            data-testid="chat-task-workbench-capability-auto"
            onClick={() => onSelect(null)}
            className={[
              "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selectedAgentId === null ? "border-primary/60" : "border-transparent",
            ].join(" ")}
          >
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-14 text-primary">✦</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-12 font-medium text-card-foreground">自动匹配</span>
              <span className="truncate text-11 text-muted-foreground">按你的任务自动挑选合适的数字人</span>
            </span>
          </button>
        ) : null}
        {listings.length === 0 ? (
          <p className="px-2 py-2 text-11 text-muted-foreground">这个组织还没有可用的数字人。</p>
        ) : null}
        {listings.length > 0 && visible.length === 0 ? (
          <div data-testid="chat-task-workbench-capability-empty" className="flex flex-col items-center gap-1 px-2 py-6 text-center">
            <p className="text-12 text-card-foreground">没有找到匹配的数字人</p>
            <button type="button" className="text-11 text-primary underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setQuery(""); setTag(null); }}>
              清除搜索与筛选
            </button>
          </div>
        ) : null}
        {visible.map((listing) => (
          <DigitalHumanCard
            key={listing.id}
            listing={listing}
            card={directory.get(listing.id)}
            isSelected={listing.id === selectedAgentId}
            acting={acting}
            onSelect={onSelect}
          />
        ))}
      </div>
      <div className="border-t border-border px-1.5 py-1 empty:hidden">
        {/* 「这个版次做不到什么」仍说在选择的地方，只是收成页脚一行、点开才展开。 */}
        <CapabilityEditionNote compact />
      </div>
    </div>
  );
}

function DigitalHumanCard({
  listing, card, isSelected, acting, onSelect,
}: {
  listing: CapabilityListing;
  card: AgentDirectoryCard | undefined;
  isSelected: boolean;
  acting: CapabilityCardActingState | null;
  onSelect: (agentId: string) => void;
}): JSX.Element {
  const ready = identity.isCapabilityReady(listing);
  const cardStatus: CapabilityCardStatus = !ready ? "failed" : (acting && acting.agentId === listing.id ? acting.status : "ready");
  const strengths = (card?.roleLabel ?? "").trim() || (listing.duty ?? "").trim() || "该数字人尚未填写擅长领域说明";
  const tags = [...new Set([...agentTagsOf(card), ...(card?.workflows.map((w) => w.name) ?? [])])].slice(0, 3);
  return (
    <button
      type="button"
      role="option"
      disabled={!ready}
      aria-selected={isSelected}
      data-testid="chat-task-workbench-capability-card"
      /* issue #2130 —— 全部卡片共用同一个 testid；`data-agent-id` 供 e2e 精确点中某一张。 */
      data-agent-id={listing.id}
      onClick={() => onSelect(listing.id)}
      className={[
        "flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
        isSelected ? "border-primary/60 bg-muted/60" : "border-transparent",
      ].join(" ")}
    >
      <DigitalHumanAvatar listing={listing} card={card} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-12 font-medium text-card-foreground">{listing.name}</span>
          <span
            data-testid="chat-task-workbench-capability-facet-status"
            data-status={cardStatus}
            className={[
              "ml-auto shrink-0 rounded-pill px-1.5 text-10",
              cardStatus === "failed" ? "bg-muted text-muted-foreground" : "bg-success/10 text-success",
            ].join(" ")}
          >
            {statusLabel(cardStatus)}
          </span>
        </span>
        <span className="truncate text-11 text-muted-foreground" title={strengths} data-testid="chat-task-workbench-capability-facet-strengths">
          {strengths}
        </span>
        {!ready && listing.disabledReason ? (
          <span className="text-10 leading-snug text-muted-foreground">{listing.disabledReason}</span>
        ) : null}
        <span className="flex flex-wrap items-center gap-1 text-10 text-muted-foreground">
          <span data-testid="chat-task-workbench-capability-facet-tools" className="flex flex-wrap gap-1">
            {tags.length > 0
              ? tags.map((t) => <span key={t} className="rounded-sm bg-muted px-1 py-px text-card-foreground">{t}</span>)
              : <span>能力未登记</span>}
          </span>
          {/* 契约暂无「可读材料 / 写权限」披露字段（见文件头），如实标注，悬停可见完整说明。 */}
          <span data-testid="chat-task-workbench-capability-facet-materials" title="能读哪些材料：暂缺该项披露">材料</span>
          <span aria-hidden>/</span>
          <span data-testid="chat-task-workbench-capability-facet-writes" title="是否写文件或调外部服务：暂缺该项披露">写权限未披露</span>
          <span aria-hidden>·</span>
          <span data-testid="chat-task-workbench-capability-facet-memory" data-memory-scope="thread" title={MEMORY_SCOPE_FULL_LABEL}>
            记忆{MEMORY_SCOPE_SHORT_LABEL}
          </span>
        </span>
      </span>
    </button>
  );
}

/** 与 composer「+」菜单共用的开合口：菜单项点它，浮层就接过 `activeId`。 */
export function useCapabilityPopoverSlot(): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  return useChatPopoverSlot("chat-capability-picker");
}

interface PopoverProps {
  readonly align?: "left" | "right";
  readonly listings: readonly CapabilityListing[] | null;
  readonly status: "loading" | "error" | "ready";
  readonly selectedAgentId: string | null;
  readonly onSelect: (agentId: string | null) => void;
  readonly acting?: CapabilityCardActingState | null;
  readonly directory?: DigitalHumanDirectory;
}

/**
 * 数字人列表的浮层壳。`absolute` 贴着最近的定位祖先向上开；outside-click / Escape 关闭。
 */
export function CapabilityPopover({ listings, status, selectedAgentId, onSelect, acting = null, align = "left", directory }: PopoverProps): JSX.Element | null {
  const [open, setOpen] = useCapabilityPopoverSlot();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const ownDirectory = useDigitalHumanDirectory(open && directory === undefined);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  if (!open || status !== "ready" || listings === null) return null;
  return (
    <div
      ref={containerRef}
      data-testid="chat-task-workbench-capability-popover"
      className={`absolute bottom-full z-20 mb-1.5 rounded-lg border border-border bg-popover shadow-md ${align === "right" ? "right-0" : "left-0"}`}
    >
      <CapabilityCardList
        listings={listings}
        selectedAgentId={selectedAgentId}
        acting={acting}
        directory={directory ?? ownDirectory}
        autoFocusSearch
        onSelect={(agentId) => { onSelect(agentId); setOpen(false); }}
      />
    </div>
  );
}

/**
 * composer 工具行里的「数字人」触发器：默认显示「能力：自动匹配」；选中后显示真人像 + 名字，
 * 并在下方给一行「能做什么」（该数字人已授权的 workflows）。
 * testid `chat-task-workbench-capability-picker` + `data-auto-match` 逐字沿用（TW-P0-2①）。
 */
export function CapabilityPicker({
  listings,
  status,
  selectedAgentId,
  onSelect,
  disabled,
  acting = null,
}: {
  readonly listings: readonly CapabilityListing[] | null;
  readonly status: "loading" | "error" | "ready";
  readonly selectedAgentId: string | null;
  readonly onSelect: (agentId: string | null) => void;
  readonly disabled: boolean;
  readonly acting?: CapabilityCardActingState | null;
}): JSX.Element {
  const [open, setOpen] = useCapabilityPopoverSlot();
  const directory = useDigitalHumanDirectory(status === "ready" && (open || selectedAgentId !== null));
  const selected = listings?.find((l) => l.id === selectedAgentId) ?? null;
  const selectedCard = selected ? directory.get(selected.id) : undefined;
  const abilities = selectedCard?.workflows.map((w) => w.name) ?? [];
  const abilityHint = abilities.length > 0 ? `能做：${abilities.join("、")}` : null;
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        data-testid="chat-task-workbench-capability-picker"
        data-auto-match={selectedAgentId === null ? "true" : "false"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `当前数字人：${selected.name}，点击更换` : "选择数字人（当前自动匹配）"}
        title={selected ? [`当前数字人：${selected.name}`, abilityHint].filter(Boolean).join("\n") : "未指定时按任务自动匹配数字人，点击手选"}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 max-w-64 items-center gap-1.5 rounded-pill px-2.5 text-12 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-disabled-foreground"
      >
        {selected ? <DigitalHumanAvatar listing={selected} card={selectedCard} size="xs" /> : null}
        <span className="truncate">{selected ? selected.name : "能力：自动匹配"}</span>
        {selected && abilities.length > 0 ? (
          <span data-testid="chat-task-workbench-capability-abilities" className="hidden truncate text-11 text-muted-foreground sm:inline">
            · {abilities.slice(0, 2).join("、")}{abilities.length > 2 ? ` 等 ${abilities.length} 项` : ""}
          </span>
        ) : null}
        <span aria-hidden className="text-9">▾</span>
      </button>
      <CapabilityPopover listings={listings} status={status} selectedAgentId={selectedAgentId} onSelect={onSelect} acting={acting} directory={directory} align="right" />
    </div>
  );
}
