"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { identity } from "@repo/contracts";
import { Avatar } from "@/components/ui/avatar";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";
import type { CapabilityListing } from "@/lib/live-capabilities";
import { CapabilityEditionNote } from "@/components/chat/capability-edition-note";
import {
  enableOfficialRolePack,
  getOfficialRolePackOffer,
  listAgentDirectory,
  type AgentDirectoryCard,
  type OfficialRolePackOffer,
  type PendingOfficialRole,
} from "@/lib/agent-directory";
import { buildPickerGroups, shortReason, type PickerEntry, type PickerFilter } from "@/lib/capability-picker-model";

export { agentTagsOf } from "@/lib/capability-picker-model";

/**
 * issue #2130（TW-P0-2）起的「选择能力」浮层；2026-09-30 按人类反馈整体重设计
 * （「这个界面要改 UIUX 的体验，这里也看不到你新增的数字人」）。
 *
 * ## 结构（两栏）
 * 左栏：搜索 + 标签 chip + 分组列表（自动匹配 → 数字人 → 待启用的官方数字人 → 其他 Agent →
 * 折叠的「不可用（n）」）。分组/排序/副标题去重的唯一实现在 `lib/capability-picker-model.ts`。
 * 右栏（≥sm）：当前高亮项的预览——角色、擅长、标签、可发起的流程，以及 TW-P0-2② 的六项披露
 * （`chat-task-workbench-capability-facet-*`）。六项披露从每张卡片上移到这里：卡片上常驻一行
 * 「能力未登记 材料 / 写权限未披露 · 记忆仅本对话」是截图里最大的噪音，而信息本身没有丢。
 *
 * ## 六项披露的范围裁决（issue #2130，仍是唯一事实源）
 * - 「擅长什么」= roleLabel / `CapabilityListing.duty`（真实字段）。
 * - 「可用工具与技能」= 目录卡片的已授权 workflows（没有则如实写「未登记」）。
 * - 「能读哪些材料」「是否写文件/调外部服务」—— 契约无对应字段，如实标注「暂缺该项披露」。
 * - 「记忆范围」—— 全仓无跨线程记忆机制，恒为「仅本对话」。
 * - 「当前状态」—— `isCapabilityReady=false` → failed；当前对话 agent 用真实运行态；其余 ready。
 *
 * ## 官方数字人为什么会「看不到」
 * 官方角色包只能由管理员导入（UC-3），Web 端此前没有入口，所以组织里一个都没有。浮层现在读
 * `getOfficialRolePackOffer()`：未导入的官方数字人以「待启用」分组出现，管理员一键启用走既有导入。
 *
 * ## 定位
 * 浮层 portal 到 body、`position: fixed`，按触发器位置向上开（上方放不下才向下），高度贴合可用
 * 空间、左右夹在 16px 边距内——此前 `absolute right-0` 在窄屏会溢出左侧、在矮屏顶进粘性页头。
 */

export type CapabilityCardStatus = "ready" | "running" | "awaiting-approval" | "failed";

export interface CapabilityCardActingState {
  readonly agentId: string;
  readonly status: CapabilityCardStatus;
}

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
  return (listing.name.trim() || listing.id).slice(0, 2).toUpperCase();
}

export type DigitalHumanDirectory = ReadonlyMap<string, AgentDirectoryCard>;

/** 目录读一次、按 id 建索引；失败 → 空表（退回首字母头像），不把错误抛给聊天。`refreshKey` 变化时重读。 */
export function useDigitalHumanDirectory(
  enabled: boolean,
  fetchDirectory: () => Promise<readonly AgentDirectoryCard[]> = listAgentDirectory,
  refreshKey = 0,
): DigitalHumanDirectory {
  const [map, setMap] = React.useState<DigitalHumanDirectory>(() => new Map());
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchDirectory().then(
      (cards) => { if (alive) setMap(new Map(cards.map((c) => [c.agentId, c]))); },
      () => { /* 目录不可读：保持空表 */ },
    );
    return () => { alive = false; };
  }, [enabled, fetchDirectory, refreshKey]);
  return map;
}

export interface OfficialOfferState {
  readonly offer: OfficialRolePackOffer | null;
  readonly enabling: boolean;
  readonly error: string | null;
  readonly enable: () => void;
}

/** 官方数字人待启用要约 + 管理员一键启用。读失败 → 不显示该分组（不打扰聊天）。 */
export function useOfficialRoleOffer(enabled: boolean, onEnabled?: () => void): OfficialOfferState {
  const [offer, setOffer] = React.useState<OfficialRolePackOffer | null>(null);
  const [enabling, setEnabling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getOfficialRolePackOffer().then((o) => { if (alive) setOffer(o); }, () => { if (alive) setOffer(null); });
    return () => { alive = false; };
  }, [enabled, tick]);
  const enable = React.useCallback(() => {
    if (!offer || enabling) return;
    setEnabling(true);
    setError(null);
    enableOfficialRolePack(offer).then(
      () => { setTick((t) => t + 1); onEnabled?.(); },
      () => setError("启用没有成功，请稍后重试；若持续失败请到管理后台查看导入记录。"),
    ).finally(() => setEnabling(false));
  }, [offer, enabling, onEnabled]);
  return { offer, enabling, error, enable };
}

type ActiveKey = { kind: "auto" } | { kind: "agent"; id: string } | { kind: "pending"; roleRef: string };

export interface CapabilityCardListProps {
  readonly listings: readonly CapabilityListing[];
  /** `null` = 未手选（默认自动匹配）。 */
  readonly selectedAgentId: string | null;
  /** `null` = 选回「自动匹配」。 */
  readonly onSelect: (agentId: string | null) => void;
  readonly acting?: CapabilityCardActingState | null;
  readonly directory?: DigitalHumanDirectory;
  readonly autoFocusSearch?: boolean;
  /** 官方数字人待启用要约（缺省 = 不显示该分组）。 */
  readonly official?: OfficialOfferState;
  /** 父容器给的列表最大高度（px）；缺省 24rem。 */
  readonly maxListHeight?: number;
}

const EMPTY_DIRECTORY: DigitalHumanDirectory = new Map();

const chipClass = (active: boolean) => [
  "shrink-0 rounded-pill border px-2 py-0.5 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-card-foreground",
].join(" ");

function GroupHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-2 pb-1 pt-2.5">
      <span className="text-10 font-medium tracking-wide text-muted-foreground">{children}</span>
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}

function TagChips({ tags, max = 3 }: { tags: readonly string[]; max?: number }): JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, max).map((t) => (
        <span key={t} className="rounded-sm bg-muted px-1.5 py-px text-10 text-card-foreground">{t}</span>
      ))}
    </span>
  );
}

/** 数字人选择列表 + 预览：`role="listbox"`，可选项 `role="option"`。 */
export function CapabilityCardList({
  listings, selectedAgentId, onSelect, acting = null, directory = EMPTY_DIRECTORY, autoFocusSearch = false, official, maxListHeight,
}: CapabilityCardListProps): JSX.Element {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<PickerFilter>(null);
  const [active, setActive] = React.useState<ActiveKey>(selectedAgentId ? { kind: "agent", id: selectedAgentId } : { kind: "auto" });
  const listRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const searchId = React.useId();

  const groups = buildPickerGroups({ listings, directory, pending: official?.offer?.pending ?? [], query, filter });
  const filtering = query.trim() !== "" || filter !== null;
  const nothingVisible = groups.digitalHumans.length + groups.pending.length + groups.others.length + groups.unavailable.length === 0;

  function focusOption(delta: 1 | -1 | "first" | "last") {
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
    if (opts.length === 0) return;
    const at = opts.indexOf(document.activeElement as HTMLButtonElement);
    if (delta === -1 && at <= 0) { searchRef.current?.focus(); return; }
    const next = delta === "first" ? 0 : delta === "last" ? opts.length - 1 : Math.min(opts.length - 1, Math.max(0, at + delta));
    opts[next]?.focus();
    opts[next]?.scrollIntoView?.({ block: "nearest" });
  }
  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); focusOption(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusOption(-1); }
    else if (e.key === "Home") { e.preventDefault(); focusOption("first"); }
    else if (e.key === "End") { e.preventDefault(); focusOption("last"); }
  }

  const activeEntry = active.kind === "agent" ? [...groups.digitalHumans, ...groups.others, ...groups.unavailable].find((x) => x.listing.id === active.id) : undefined;
  const activePending = active.kind === "pending" ? groups.pending.find((p) => p.roleRef === active.roleRef) : undefined;
  const entryProps = (entry: PickerEntry) => ({
    entry,
    isSelected: entry.listing.id === selectedAgentId,
    acting,
    onSelect,
    onActivate: () => setActive({ kind: "agent", id: entry.listing.id }),
  });

  return (
    <div className="flex w-[min(40rem,calc(100vw-2rem))] min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col sm:max-w-[22rem] sm:border-r sm:border-border">
          <div className="flex flex-col gap-1.5 border-b border-border p-2">
            <label htmlFor={searchId} className="sr-only">搜索数字人</label>
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              data-testid="chat-task-workbench-capability-search"
              value={query}
              autoFocus={autoFocusSearch}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); focusOption("first"); } }}
              placeholder="搜索名字、角色、标签或擅长的事"
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-12 text-background-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {groups.tagOptions.length > 0 ? (
              <div role="group" aria-label="按标签筛选" data-testid="chat-task-workbench-capability-tags" className="flex gap-1 overflow-x-auto pb-0.5">
                <button type="button" aria-pressed={filter === null} className={chipClass(filter === null)} onClick={() => setFilter(null)}>全部</button>
                {groups.tagOptions.map((t) => {
                  const on = filter?.value === t;
                  return (
                    <button key={t} type="button" aria-pressed={on} data-tag={t} className={chipClass(on)} onClick={() => setFilter(on ? null : { kind: "tag", value: t })}>
                      {t}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div
            ref={listRef}
            role="listbox"
            aria-label="选择数字人"
            /* issue #2130 —— 保留既有 e2e（copilotkit-v2-agent-switch.spec.ts）依赖的容器锚点名。 */
            data-testid="chat-agent-select-listbox"
            onKeyDown={onListKeyDown}
            style={maxListHeight ? { maxHeight: maxListHeight } : undefined}
            className="flex max-h-[min(24rem,60vh)] min-h-0 flex-col overflow-y-auto overscroll-contain p-1.5"
          >
            {!filtering ? (
              <button
                type="button"
                role="option"
                aria-selected={selectedAgentId === null}
                data-testid="chat-task-workbench-capability-auto"
                onClick={() => onSelect(null)}
                onMouseEnter={() => setActive({ kind: "auto" })}
                onFocus={() => setActive({ kind: "auto" })}
                className={optionClass(selectedAgentId === null)}
              >
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-14 text-primary">✦</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-12 font-medium text-card-foreground">自动匹配</span>
                  <span className="truncate text-11 text-muted-foreground">按你的任务挑选最合适的数字人</span>
                </span>
                <SelectedMark on={selectedAgentId === null} />
              </button>
            ) : null}

            {groups.isEmpty ? (
              <p data-testid="chat-task-workbench-capability-none" className="px-2 py-4 text-center text-11 text-muted-foreground">这个组织还没有可用的数字人，请联系管理员添加。</p>
            ) : null}
            {!groups.isEmpty && nothingVisible ? (
              <div data-testid="chat-task-workbench-capability-empty" className="flex flex-col items-center gap-1 px-2 py-6 text-center">
                <p className="text-12 text-card-foreground">没有找到匹配的数字人</p>
                <button type="button" className="text-11 text-primary underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setQuery(""); setFilter(null); }}>
                  清除搜索与筛选
                </button>
              </div>
            ) : null}

            {groups.digitalHumans.length > 0 ? (
              <section aria-label="数字人" data-testid="chat-task-workbench-capability-group-dh">
                <GroupHeading>数字人</GroupHeading>
                {groups.digitalHumans.map((e) => <AgentOption key={e.listing.id} {...entryProps(e)} />)}
              </section>
            ) : null}

            {groups.pending.length > 0 && official?.offer ? (
              <section aria-label="待启用的官方数字人" data-testid="chat-task-workbench-capability-group-pending">
                <GroupHeading
                  action={official.offer.canEnable ? (
                    <button
                      type="button"
                      data-testid="chat-task-workbench-capability-enable-official"
                      disabled={official.enabling}
                      onClick={official.enable}
                      className="rounded-pill bg-primary px-2.5 py-0.5 text-11 font-medium text-primary-foreground transition-colors duration-fast hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
                    >
                      {official.enabling ? "启用中…" : `一键启用 ${official.offer.pending.length} 位`}
                    </button>
                  ) : <span className="text-10 text-muted-foreground">需管理员启用</span>}
                >
                  官方数字人 · 待启用
                </GroupHeading>
                {official.error ? <p role="alert" className="px-2 pb-1 text-11 text-destructive">{official.error}</p> : null}
                {groups.pending.map((p) => (
                  <PendingRow key={p.roleRef} role={p} onActivate={() => setActive({ kind: "pending", roleRef: p.roleRef })} />
                ))}
              </section>
            ) : null}

            {groups.others.length > 0 ? (
              <section aria-label="其他 Agent" data-testid="chat-task-workbench-capability-group-others">
                <GroupHeading>其他 Agent</GroupHeading>
                {groups.others.map((e) => <AgentOption key={e.listing.id} {...entryProps(e)} />)}
              </section>
            ) : null}

            {groups.unavailable.length > 0 ? (
              <details data-testid="chat-task-workbench-capability-group-unavailable" className="group mt-1 border-t border-border pt-1" open={filtering || undefined}>
                <summary className="flex cursor-pointer select-none items-center gap-1 rounded-sm px-2 py-1.5 text-10 font-medium tracking-wide text-muted-foreground transition-colors duration-fast hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span aria-hidden className="transition-transform duration-fast group-open:rotate-90">›</span>
                  不可用（{groups.unavailable.length}）
                </summary>
                {groups.unavailable.map((e) => <UnavailableOption key={e.listing.id} entry={e} onActivate={() => setActive({ kind: "agent", id: e.listing.id })} />)}
              </details>
            ) : null}
          </div>
        </div>
        <PreviewPane active={active} entry={activeEntry} pending={activePending} acting={acting} />
      </div>
      <div className="flex items-center gap-3 border-t border-border px-2.5 py-1 text-10 text-muted-foreground">
        <div className="min-w-0 flex-1"><CapabilityEditionNote compact /></div>
        <span aria-hidden className="hidden shrink-0 sm:inline">↑↓ 选择 · Enter 确认 · Esc 关闭</span>
      </div>
    </div>
  );
}

function optionClass(selected: boolean): string {
  return [
    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected ? "bg-primary/5" : "",
  ].join(" ");
}

function SelectedMark({ on }: { on: boolean }): JSX.Element | null {
  return on ? <span aria-hidden className="shrink-0 text-12 text-primary">✓</span> : null;
}

function AgentOption({
  entry, isSelected, acting, onSelect, onActivate,
}: {
  entry: PickerEntry;
  isSelected: boolean;
  acting: CapabilityCardActingState | null;
  onSelect: (agentId: string) => void;
  onActivate: () => void;
}): JSX.Element {
  const { listing, card, subtitle, tags } = entry;
  const liveStatus = acting && acting.agentId === listing.id && acting.status !== "ready" ? acting.status : null;
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      data-testid="chat-task-workbench-capability-card"
      data-agent-id={listing.id}
      onClick={() => onSelect(listing.id)}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      className={optionClass(isSelected)}
    >
      <Avatar initials={card?.initials || abbrFor(listing)} avatarKey={card?.avatar?.key ?? null} tone="ai" size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-12 font-medium text-card-foreground">{listing.name}</span>
          {liveStatus ? <span className="shrink-0 rounded-pill bg-success/10 px-1.5 text-10 text-success">{statusLabel(liveStatus)}</span> : null}
        </span>
        {subtitle ? <span className="truncate text-11 text-muted-foreground" title={subtitle}>{subtitle}</span> : null}
        <TagChips tags={tags} />
      </span>
      <SelectedMark on={isSelected} />
    </button>
  );
}

function UnavailableOption({ entry, onActivate }: { entry: PickerEntry; onActivate: () => void }): JSX.Element {
  const { listing } = entry;
  return (
    <button
      type="button"
      role="option"
      disabled
      aria-selected={false}
      aria-label={`${listing.name}（不可用：${listing.disabledReason ?? "暂不可用"}）`}
      data-testid="chat-task-workbench-capability-card"
      data-agent-id={listing.id}
      data-unavailable="true"
      title={listing.disabledReason ?? undefined}
      onMouseEnter={onActivate}
      className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1 text-left text-disabled-foreground"
    >
      <span className="min-w-0 flex-1 truncate text-11">{listing.name}</span>
      <span className="max-w-[55%] shrink-0 truncate text-10">{shortReason(listing.disabledReason)}</span>
    </button>
  );
}

function PendingRow({ role, onActivate }: { role: PendingOfficialRole; onActivate: () => void }): JSX.Element {
  return (
    <div
      data-testid="chat-task-workbench-capability-pending"
      data-role-ref={role.roleRef}
      onMouseEnter={onActivate}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
    >
      <Avatar initials={role.roleRef} avatarKey={role.avatar?.key ?? null} tone="ai" size="md" className="opacity-70" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-12 font-medium text-card-foreground">{role.name}</span>
        <TagChips tags={role.tags} />
      </span>
      <span className="shrink-0 rounded-pill border border-dashed border-border px-1.5 text-10 text-muted-foreground">待启用</span>
    </div>
  );
}

function Facet({ label, testId, children, title, extra }: { label: string; testId: string; children: React.ReactNode; title?: string; extra?: Record<string, string> }): JSX.Element {
  return (
    <div className="flex gap-2 text-11">
      <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
      <dd data-testid={testId} title={title} className="min-w-0 flex-1 text-card-foreground" {...extra}>{children}</dd>
    </div>
  );
}

function PreviewPane({ active, entry, pending, acting }: { active: ActiveKey; entry: PickerEntry | undefined; pending: PendingOfficialRole | undefined; acting: CapabilityCardActingState | null }): JSX.Element {
  let body: React.ReactNode;
  if (entry) {
    const { listing, card, tags } = entry;
    const ready = identity.isCapabilityReady(listing);
    const status: CapabilityCardStatus = !ready ? "failed" : acting && acting.agentId === listing.id ? acting.status : "ready";
    const workflows = card?.workflows.map((w) => w.name) ?? [];
    const strengths = (card?.roleLabel ?? "").trim() || (listing.duty ?? "").trim() || "尚未填写擅长领域说明";
    body = (
      <>
        <div className="flex items-center gap-3">
          <Avatar initials={card?.initials || abbrFor(listing)} avatarKey={card?.avatar?.key ?? null} tone="ai" size="lg" className="size-14 text-16" />
          <div className="min-w-0">
            <p className="truncate text-14 font-semibold text-card-foreground">{listing.name}</p>
            {entry.subtitle ? <p className="truncate text-11 text-muted-foreground">{entry.subtitle}</p> : null}
            {card?.catalogSource === "official" ? <p className="mt-0.5 text-10 text-primary">官方数字人</p> : null}
          </div>
        </div>
        {listing.duty && listing.duty.trim() !== strengths ? <p className="text-11 leading-relaxed text-card-foreground">{listing.duty}</p> : null}
        <TagChips tags={tags} max={6} />
        <dl className="flex flex-col gap-1.5 border-t border-border pt-2">
          <Facet label="当前状态" testId="chat-task-workbench-capability-facet-status" extra={{ "data-status": status }}>
            <span className={status === "failed" ? "text-muted-foreground" : "text-success"}>{statusLabel(status)}</span>
            {!ready && listing.disabledReason ? <span className="block text-10 text-muted-foreground">{listing.disabledReason}</span> : null}
          </Facet>
          <Facet label="擅长" testId="chat-task-workbench-capability-facet-strengths">{strengths}</Facet>
          <Facet label="可发起流程" testId="chat-task-workbench-capability-facet-tools">
            {workflows.length > 0 ? workflows.join("、") : <span className="text-muted-foreground">未登记</span>}
          </Facet>
          <Facet label="可读材料" testId="chat-task-workbench-capability-facet-materials" title="能读哪些材料：暂缺该项披露"><span className="text-muted-foreground">暂缺该项披露</span></Facet>
          <Facet label="写入/外呼" testId="chat-task-workbench-capability-facet-writes" title="是否写文件或调外部服务：暂缺该项披露"><span className="text-muted-foreground">暂缺该项披露</span></Facet>
          <Facet label="记忆" testId="chat-task-workbench-capability-facet-memory" title={MEMORY_SCOPE_FULL_LABEL} extra={{ "data-memory-scope": "thread" }}>{MEMORY_SCOPE_SHORT_LABEL}</Facet>
        </dl>
      </>
    );
  } else if (pending) {
    body = (
      <>
        <div className="flex items-center gap-3">
          <Avatar initials={pending.roleRef} avatarKey={pending.avatar?.key ?? null} tone="ai" size="lg" className="size-14 text-16" />
          <div className="min-w-0">
            <p className="truncate text-14 font-semibold text-card-foreground">{pending.name}</p>
            <p className="mt-0.5 text-10 text-primary">官方数字人 · 待启用</p>
          </div>
        </div>
        <TagChips tags={pending.tags} max={6} />
        <p className="text-11 leading-relaxed text-muted-foreground">
          启用后可在这里直接选用，并可发起 {pending.workflowAllowlist.length} 个已登记的工作流程。启用由组织管理员一次完成。
        </p>
      </>
    );
  } else {
    body = (
      <>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-20 text-primary">✦</span>
          <p className="text-14 font-semibold text-card-foreground">自动匹配</p>
        </div>
        <p className="text-11 leading-relaxed text-muted-foreground">
          {active.kind === "auto" ? "不指定时，系统按你这条消息的任务挑选合适的数字人；想固定由某位数字人处理，从左侧选择即可。" : "把鼠标移到左侧的数字人上查看详情。"}
        </p>
      </>
    );
  }
  return (
    <aside aria-label="数字人详情" data-testid="chat-task-workbench-capability-preview" className="hidden w-[18rem] shrink-0 flex-col gap-2.5 overflow-y-auto p-3 sm:flex">
      {body}
    </aside>
  );
}

/** 与 composer「+」菜单共用的开合口。 */
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
  readonly official?: OfficialOfferState;
  /** 定位锚点（触发器）；缺省时贴视口左下角。 */
  readonly anchorRef?: React.RefObject<HTMLElement>;
  readonly onRetry?: () => void;
}

const EDGE = 16;
/** 粘性页头的保留高度：浮层顶边不进入这块。 */
const TOP_RESERVE = 64;
/** 搜索 + 标签 + 页脚的大致高度。 */
const CHROME = 120;

interface Placement { left: number; top?: number; bottom?: number; listMax: number }

/**
 * 横向：以触发器为中心，尽量夹在 composer 卡片内，再夹在视口 16px 边距内。
 * 纵向：贴 composer 卡片的上沿向上开（不压住输入框）；上方放不下才向下开。
 */
function computePlacement(anchor: DOMRect | null, frame: DOMRect | null, width: number): Placement {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const a = anchor ?? new DOMRect(EDGE, vh - EDGE, 0, 0);
  const f = frame ?? a;
  let left = a.left + a.width / 2 - width / 2;
  if (frame && frame.width >= width) left = Math.max(frame.left, Math.min(left, frame.right - width));
  left = Math.max(EDGE, Math.min(left, vw - width - EDGE));
  const above = f.top - TOP_RESERVE - 6;
  const below = vh - a.bottom - EDGE - 6;
  if (above >= 320 || above >= below) return { left, bottom: vh - f.top + 6, listMax: Math.max(160, Math.min(448, above - CHROME)) };
  return { left, top: a.bottom + 6, listMax: Math.max(160, Math.min(448, below - CHROME)) };
}

/** 触发器所在的 composer 卡片（浮层不压住它）；找不到时退回触发器本身。 */
const COMPOSER_FRAME_SELECTOR = '[data-testid="chat-task-workbench-composer"]';

/** 浮层壳：portal + fixed 定位；outside-click（锚点除外）/ Escape 关闭。 */
export function CapabilityPopover({ listings, status, selectedAgentId, onSelect, acting = null, directory, official, anchorRef, onRetry }: PopoverProps): JSX.Element | null {
  const [open, setOpen] = useCapabilityPopoverSlot();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const ownDirectory = useDigitalHumanDirectory(open && directory === undefined);
  const ownOfficial = useOfficialRoleOffer(open && official === undefined);
  const [placement, setPlacement] = React.useState<Placement | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const width = Math.min(640, window.innerWidth - 2 * EDGE);
      const anchor = anchorRef?.current ?? null;
      const frame = anchor?.closest(COMPOSER_FRAME_SELECTOR) ?? null;
      setPlacement(computePlacement(anchor?.getBoundingClientRect() ?? null, frame?.getBoundingClientRect() ?? null, width));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, anchorRef]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); anchorRef?.current?.focus(); }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen, anchorRef]);

  if (!open || typeof document === "undefined") return null;
  const style: React.CSSProperties = placement ? { left: placement.left, top: placement.top, bottom: placement.bottom } : { left: EDGE, bottom: EDGE };
  let content: React.ReactNode;
  if (status === "error") {
    content = (
      <div data-testid="chat-task-workbench-capability-error" className="flex w-64 flex-col gap-2 px-3 py-4 text-12 text-card-foreground">
        <p>数字人列表没有读出来。</p>
        {onRetry ? <button type="button" onClick={onRetry} className="self-start text-11 text-primary transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试</button> : null}
      </div>
    );
  } else if (status === "loading" || listings === null) {
    content = <p data-testid="chat-task-workbench-capability-loading" className="w-64 px-3 py-4 text-12 text-muted-foreground">正在读取数字人…</p>;
  } else {
    content = (
      <CapabilityCardList
        listings={listings}
        selectedAgentId={selectedAgentId}
        acting={acting}
        directory={directory ?? ownDirectory}
        official={official ?? ownOfficial}
        maxListHeight={placement?.listMax}
        autoFocusSearch
        onSelect={(agentId) => { onSelect(agentId); setOpen(false); anchorRef?.current?.focus(); }}
      />
    );
  }
  return createPortal(
    <div
      ref={containerRef}
      data-testid="chat-task-workbench-capability-popover"
      style={style}
      className="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
    >
      {content}
    </div>,
    document.body,
  );
}

/**
 * composer 工具行里的「数字人」触发器：默认「能力：自动匹配」；选中后显示真人像 + 名字。
 * testid `chat-task-workbench-capability-picker` + `data-auto-match` 逐字沿用（TW-P0-2①）。
 */
export function CapabilityPicker({
  listings,
  status,
  selectedAgentId,
  onSelect,
  disabled,
  acting = null,
  onListingsChanged,
}: {
  readonly listings: readonly CapabilityListing[] | null;
  readonly status: "loading" | "error" | "ready";
  readonly selectedAgentId: string | null;
  readonly onSelect: (agentId: string | null) => void;
  readonly disabled: boolean;
  readonly acting?: CapabilityCardActingState | null;
  /** 管理员一键启用官方数字人后，让父组件重读 `listCapabilities`。 */
  readonly onListingsChanged?: () => void;
}): JSX.Element {
  const [open, setOpen] = useCapabilityPopoverSlot();
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const [refresh, setRefresh] = React.useState(0);
  const directory = useDigitalHumanDirectory(status === "ready" && (open || selectedAgentId !== null), listAgentDirectory, refresh);
  const onEnabled = React.useCallback(() => { setRefresh((n) => n + 1); onListingsChanged?.(); }, [onListingsChanged]);
  const official = useOfficialRoleOffer(status === "ready" && open, onEnabled);
  const selected = listings?.find((l) => l.id === selectedAgentId) ?? null;
  const selectedCard = selected ? directory.get(selected.id) : undefined;
  const abilities = selectedCard?.workflows.map((w) => w.name) ?? [];
  const abilityHint = abilities.length > 0 ? `能做：${abilities.join("、")}` : null;
  return (
    <div className="relative flex items-center">
      <button
        ref={anchorRef}
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
        {selected ? <Avatar initials={selectedCard?.initials || abbrFor(selected)} avatarKey={selectedCard?.avatar?.key ?? null} tone="ai" size="xs" /> : null}
        <span className="truncate">{selected ? selected.name : "能力：自动匹配"}</span>
        {selected && abilities.length > 0 ? (
          <span data-testid="chat-task-workbench-capability-abilities" className="hidden truncate text-11 text-muted-foreground sm:inline">
            · {abilities.slice(0, 2).join("、")}{abilities.length > 2 ? ` 等 ${abilities.length} 项` : ""}
          </span>
        ) : null}
        <span aria-hidden className="text-9">▾</span>
      </button>
      <CapabilityPopover
        listings={listings}
        status={status}
        selectedAgentId={selectedAgentId}
        onSelect={onSelect}
        acting={acting}
        directory={directory}
        official={official}
        anchorRef={anchorRef}
      />
    </div>
  );
}
