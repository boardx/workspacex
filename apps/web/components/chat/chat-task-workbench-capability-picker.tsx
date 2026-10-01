"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { identity } from "@repo/contracts";
import { ArrowLeft, Check, Loader2, SearchX, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";
import type { CapabilityListing } from "@/lib/live-capabilities";
import { CapabilityEditionNote } from "@/components/chat/capability-edition-note";
import {
  enableOfficialRolePack,
  getOfficialRolePackOffer,
  listAgentDirectory,
  type AgentDirectoryCard,
  type EnableProgress,
  type OfficialRolePackOffer,
  type PendingOfficialRole,
} from "@/lib/agent-directory";
import { autoExamplePrompts, buildPickerGroups, examplePromptsFor, pendingWorkflowLabels, joinWithOverflow, reasonCopy, shortReason, strengthsFor, workflowLabelsOf, type PickerEntry, type PickerFilter } from "@/lib/capability-picker-model";

export { agentTagsOf } from "@/lib/capability-picker-model";

/**
 * issue #2130（TW-P0-2）起的「选择能力」浮层；2026-09-30 按人类反馈整体重设计
 * （「这个界面要改 UIUX 的体验，这里也看不到你新增的数字人」）。
 *
 * ## 结构（两栏）
 * 左栏：搜索 + 标签 chip（换行，超一行收进「更多」）+ 分组列表（自动匹配 → 数字人 → 待启用 → 其他助手 →
 * 折叠的「不可用（n）」）。分组/排序/副标题去重的唯一实现在 `lib/capability-picker-model.ts`。
 * 右栏（≥sm）：当前高亮项的预览——擅长、可发起的流程与底部一行「边界」，承载 TW-P0-2② 的六项披露
 * （`chat-task-workbench-capability-facet-*`）。六项披露从每张卡片上移到这里：卡片上常驻一行
 * 「能力未登记 材料 / 写权限未披露 · 记忆仅本对话」是截图里最大的噪音，而信息本身没有丢。
 *
 * ## 六项披露的范围裁决（issue #2130，仍是唯一事实源）
 * - 「擅长什么」= `strengthsFor`：与名字不同的 duty → 标签 → 流程名（不回显名字，UIUX 复审 r1）。
 * - 「可用工具与技能」= 目录卡片的可发起 workflows（没有则在底部「边界」行写「暂无可直接发起的流程」）。
 * - 「能读哪些材料」「是否写文件/调外部服务」—— 契约无对应字段，在「边界」行如实写「未单独声明」。
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
 * 低于 640px 改为贴底的底部面板（标题栏 + 关闭按钮 + 遮罩），不再压住页头、悬在屏幕中间。
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
  return (listing.name.trim() || "AI").slice(0, 2).toUpperCase();
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
  /** 启用进行中的步骤（技能与流程 → 数字人）；空闲时 null。 */
  readonly progress?: EnableProgress | null;
  /** 启用完成后的一句结果（启用了几位、能发起几个流程）；未启用过为 null。 */
  readonly result?: string | null;
}

/** 启用结果：按启用后的目录如实数——能发起流程的官方数字人 / 还没有可发起流程的。 */
export function enableResultText(cards: readonly AgentDirectoryCard[]): string {
  const official = cards.filter((c) => c.catalogSource === "official");
  if (official.length === 0) return "已启用。数字人列表稍后刷新即可看到。";
  const flows = new Set(official.flatMap((c) => c.workflows.map((w) => w.stableId)));
  const waiting = official.filter((c) => c.workflows.length === 0).map((c) => c.name);
  const head = `已启用 ${official.length} 位官方数字人${flows.size > 0 ? `，可发起 ${flows.size} 个流程` : ""}。`;
  return waiting.length > 0 ? `${head}${waiting.join("、")}暂无可发起的流程，可先直接对话。` : head;
}

/** 官方数字人待启用要约 + 管理员一键启用。读失败 → 不显示该分组（不打扰聊天）。 */
export function useOfficialRoleOffer(enabled: boolean, onEnabled?: () => void): OfficialOfferState {
  const [offer, setOffer] = React.useState<OfficialRolePackOffer | null>(null);
  const [enabling, setEnabling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<EnableProgress | null>(null);
  const [result, setResult] = React.useState<string | null>(null);
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
    setResult(null);
    enableOfficialRolePack(offer, setProgress)
      .then(async () => {
        const cards = await listAgentDirectory().catch(() => [] as const);
        setResult(enableResultText(cards));
        setTick((t) => t + 1);
        onEnabled?.();
      })
      .catch(() => setError("启用没有完成，已完成的部分会保留。请稍后再点一次继续；仍不行请联系平台支持。"))
      .finally(() => { setEnabling(false); setProgress(null); });
  }, [offer, enabling, onEnabled]);
  return { offer, enabling, error, enable, progress, result };
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
  /** 手机底部抽屉：两步——先列表，点一行进详情步（带返回箭头与「选择」主按钮）。 */
  readonly sheet?: boolean;
}

const EMPTY_DIRECTORY: DigitalHumanDirectory = new Map();

const chipClass = (active: boolean) => [
  "shrink-0 rounded-pill border px-2 py-0.5 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-card-foreground",
].join(" ");

/** 标签行默认露出的个数（约一行）；其余收进「更多」。当前选中的标签总在可见集合里。 */
const TAG_ROW_LIMIT = 6;
function visibleTags(tags: readonly string[], selected: string | null, all: boolean): readonly string[] {
  if (all || tags.length <= TAG_ROW_LIMIT) return tags;
  const head = tags.slice(0, TAG_ROW_LIMIT);
  return selected && !head.includes(selected) ? [...head, selected] : head;
}

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
      {tags.slice(0, max).map((t) => <Badge key={t} tone="neutral" className="py-px">{t}</Badge>)}
    </span>
  );
}

/** 数字人选择列表 + 预览：`role="listbox"`，可选项 `role="option"`。 */
export function CapabilityCardList({
  listings, selectedAgentId, onSelect, acting = null, directory = EMPTY_DIRECTORY, autoFocusSearch = false, official, maxListHeight, sheet = false,
}: CapabilityCardListProps): JSX.Element {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<PickerFilter>(null);
  const [active, setActive] = React.useState<ActiveKey>(selectedAgentId ? { kind: "agent", id: selectedAgentId } : { kind: "auto" });
  const [allTags, setAllTags] = React.useState(false);
  const [detailStep, setDetailStep] = React.useState(false);
  const showDetail = sheet && detailStep;
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
    onSelect: sheet ? (id: string) => { setActive({ kind: "agent", id }); setDetailStep(true); } : onSelect,
    onActivate: () => setActive({ kind: "agent", id: entry.listing.id }),
  });
  const openDetail = (key: ActiveKey) => { setActive(key); setDetailStep(true); };

  return (
    <div className="flex w-full min-h-0 flex-col sm:w-[min(40rem,calc(100vw-2rem))]">
      <div className="flex min-h-0 flex-1">
        <div className={`min-w-0 flex-1 flex-col sm:max-w-[22rem] sm:border-r sm:border-border ${showDetail ? "hidden" : "flex"}`}>
          <div className="flex flex-col gap-1.5 border-b border-border p-2">
            <label htmlFor={searchId} className="sr-only">搜索数字人</label>
            <Input
              ref={searchRef}
              id={searchId}
              type="search"
              data-testid="chat-task-workbench-capability-search"
              value={query}
              autoFocus={autoFocusSearch}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); focusOption("first"); } }}
              placeholder="搜索名字、角色、标签或擅长的事"
              className="text-12 focus-visible:border-ring/50 focus-visible:ring-ring/25 focus-visible:ring-offset-0"
            />
            {groups.tagOptions.length > 0 ? (
              /* 复审 P0-1：不再单行横向裁切（半个 chip 露在边上、无滚动提示）——改为换行，超过一行的收进「更多」。 */
              <div role="group" aria-label="按标签筛选" data-testid="chat-task-workbench-capability-tags" className="flex flex-wrap gap-1">
                <button type="button" aria-pressed={filter === null} className={chipClass(filter === null)} onClick={() => setFilter(null)}>全部</button>
                {visibleTags(groups.tagOptions, filter?.value ?? null, allTags).map((t) => {
                  const on = filter?.value === t;
                  return (
                    <button key={t} type="button" aria-pressed={on} data-tag={t} className={chipClass(on)} onClick={() => setFilter(on ? null : { kind: "tag", value: t })}>
                      {t}
                    </button>
                  );
                })}
                {groups.tagOptions.length > TAG_ROW_LIMIT ? (
                  <button type="button" data-testid="chat-task-workbench-capability-tags-more" aria-expanded={allTags} className={chipClass(false)} onClick={() => setAllTags((v) => !v)}>
                    {allTags ? "收起" : `更多 ${groups.tagOptions.length - TAG_ROW_LIMIT}`}
                  </button>
                ) : null}
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
                onClick={() => (sheet ? openDetail({ kind: "auto" }) : onSelect(null))}
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
              <div data-testid="chat-task-workbench-capability-empty" className="flex flex-col items-center gap-2 px-2 py-6 text-center">
                <SearchX aria-hidden className="size-6 text-muted-foreground" />
                <p className="text-12 text-card-foreground">没有找到匹配的数字人</p>
                <p className="text-11 text-muted-foreground">换个关键词，或清除筛选看全部。</p>
                <Button type="button" size="xs" variant="outline" onClick={() => { setQuery(""); setFilter(null); }}>
                  清除搜索与筛选
                </Button>
              </div>
            ) : null}

            {official?.result ? (
              <p role="status" data-testid="chat-task-workbench-capability-enable-result" className="mx-1 my-1 flex items-start gap-1.5 rounded-md bg-ai-tint px-2 py-1.5 text-11 text-ai-tint-foreground">
                <Check aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>{official.result}</span>
              </p>
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
                    <Button
                      type="button"
                      size="xs"
                      variant="primary"
                      data-testid="chat-task-workbench-capability-enable-official"
                      disabled={official.enabling}
                      onClick={official.enable}
                    >
                      {official.enabling ? <Loader2 aria-hidden className="size-3 animate-spin" /> : null}
                      {official.enabling ? "启用中…" : `一键启用 ${official.offer.pending.length} 位`}
                    </Button>
                  ) : <span className="text-10 text-muted-foreground">需管理员启用</span>}
                >
                  官方数字人 · 待启用
                </GroupHeading>
                {official.enabling && official.progress ? (
                  <div role="status" data-testid="chat-task-workbench-capability-enable-progress" className="mx-2 mb-1.5 flex flex-col gap-1">
                    <span className="text-11 text-card-foreground">{official.progress.label}（{official.progress.step}/{official.progress.total}）</span>
                    <span aria-hidden className="h-1 overflow-hidden rounded-pill bg-muted">
                      <span className="block h-full rounded-pill bg-primary transition-all duration-base" style={{ width: `${Math.round((official.progress.step / official.progress.total) * 100)}%` }} />
                    </span>
                  </div>
                ) : null}
                {official.error ? <p role="alert" className="px-2 pb-1 text-11 text-destructive">{official.error}</p> : null}
                {groups.pending.map((p) => (
                  <PendingRow key={p.roleRef} role={p} onActivate={() => setActive({ kind: "pending", roleRef: p.roleRef })} onOpen={sheet ? () => openDetail({ kind: "pending", roleRef: p.roleRef }) : undefined} />
                ))}
              </section>
            ) : null}

            {groups.others.length > 0 ? (
              <section aria-label="其他助手" data-testid="chat-task-workbench-capability-group-others">
                <GroupHeading>其他助手</GroupHeading>
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
        <PreviewPane
          active={active} entry={activeEntry} pending={activePending} acting={acting} suggestions={groups.digitalHumans}
          step={showDetail ? { onBack: () => setDetailStep(false), onChoose: () => onSelect(active.kind === "agent" ? active.id : null) } : undefined}
        />
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
    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
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
          {liveStatus ? <Badge tone="ai" className="shrink-0">{statusLabel(liveStatus)}</Badge> : null}
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
      aria-label={`${listing.name}（不可用：${reasonCopy(listing.disabledReason).short}）`}
      data-testid="chat-task-workbench-capability-card"
      data-agent-id={listing.id}
      data-unavailable="true"
      title={reasonCopy(listing.disabledReason).full}
      onMouseEnter={onActivate}
      className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1 text-left text-disabled-foreground"
    >
      <span className="min-w-0 flex-1 truncate text-11">{listing.name}</span>
      <span className="max-w-[55%] shrink-0 truncate text-10">{shortReason(listing.disabledReason)}</span>
    </button>
  );
}

function PendingRow({ role, onActivate, onOpen }: { role: PendingOfficialRole; onActivate: () => void; onOpen?: () => void }): JSX.Element {
  return (
    <div
      data-testid="chat-task-workbench-capability-pending"
      data-role-ref={role.roleRef}
      onMouseEnter={onActivate}
      onClick={onOpen}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${onOpen ? "cursor-pointer transition-colors duration-fast hover:bg-muted" : ""}`}
    >
      <Avatar initials={role.roleRef} avatarKey={role.avatar?.key ?? null} tone="ai" size="md" className="opacity-70" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-12 font-medium text-card-foreground">{role.name}</span>
        <TagChips tags={role.tags} />
      </span>
      <Badge tone="outline" className="shrink-0">待启用</Badge>
    </div>
  );
}

function Facet({ label, testId, children, title, extra }: { label: string; testId: string; children: React.ReactNode; title?: string; extra?: Record<string, string> }): JSX.Element {
  return (
    <div className="flex gap-2 text-11">
      <dt className="w-14 shrink-0 text-muted-foreground">{label}</dt>
      <dd data-testid={testId} title={title} className="min-w-0 flex-1 text-card-foreground" {...extra}>{children}</dd>
    </div>
  );
}

/**
 * 预览栏（复审 P0-2 / P1-5）：只显示有内容的行。
 * - 「擅长」由 duty/标签/流程派生（`strengthsFor`），不再回显名字；
 * - 「可发起」有流程才占一行，没有时并进底部一行「边界」；
 * - 可读材料 / 写入外呼两项（`AgentDirectoryCard` 未承载）不再各占一行写「暂缺该项披露」，而是与记忆范围一起
 *   收成底部一行小字「边界」——六项披露（TW-P0-2②）的锚点都还在、都可见，只是不再用整栏说「不知道」。
 */
function PreviewPane({ active, entry, pending, acting, suggestions, step }: { step?: { onBack: () => void; onChoose: () => void }; active: ActiveKey; entry: PickerEntry | undefined; pending: PendingOfficialRole | undefined; acting: CapabilityCardActingState | null; suggestions: readonly PickerEntry[] }): JSX.Element {
  let body: React.ReactNode;
  if (entry) {
    const { listing, card, tags } = entry;
    const ready = identity.isCapabilityReady(listing);
    const status: CapabilityCardStatus = !ready ? "failed" : acting && acting.agentId === listing.id ? acting.status : "ready";
    const workflows = workflowLabelsOf(card);
    const strengths = strengthsFor(listing, card) ?? "日常对话与问答";
    body = (
      <>
        <div className="flex items-center gap-3">
          <Avatar initials={card?.initials || abbrFor(listing)} avatarKey={card?.avatar?.key ?? null} tone="ai" size="lg" className="size-14 text-16" />
          <div className="min-w-0">
            <p className="truncate text-14 font-semibold text-card-foreground">{listing.name}</p>
            {entry.subtitle ? <p className="truncate text-11 text-muted-foreground">{entry.subtitle}</p> : null}
            {card?.catalogSource === "official" ? <Badge tone="ai" className="mt-1">官方数字人</Badge> : null}
          </div>
        </div>
        <dl className="flex flex-col gap-1.5 border-t border-border pt-2">
          <Facet label="状态" testId="chat-task-workbench-capability-facet-status" extra={{ "data-status": status }}>
            <span className={status === "failed" ? "text-muted-foreground" : "text-success"}>{statusLabel(status)}</span>
            {!ready ? <span className="block text-10 text-muted-foreground">{reasonCopy(listing.disabledReason).full}</span> : null}
          </Facet>
          <Facet label="擅长" testId="chat-task-workbench-capability-facet-strengths">{strengths}</Facet>
          {workflows.length > 0 ? (
            <Facet label="可发起" testId="chat-task-workbench-capability-facet-tools" extra={{ "data-count": String(workflows.length) }}>
              <ExpandableList key={listing.id} items={workflows} />
            </Facet>
          ) : null}
        </dl>
        <div data-testid="chat-task-workbench-capability-examples" className="flex flex-col gap-1 border-t border-border pt-2">
          <p className="text-10 font-medium text-muted-foreground">适合这样问</p>
          <ul className="flex flex-col gap-1">
            {examplePromptsFor(card).map((q) => <li key={q} className="rounded-md bg-muted px-2 py-1 text-11 text-card-foreground">{q}</li>)}
          </ul>
        </div>
        <p data-testid="chat-task-workbench-capability-boundary" className="border-t border-border pt-2 text-10 leading-relaxed text-muted-foreground">
          {workflows.length === 0 ? <span data-testid="chat-task-workbench-capability-facet-tools" data-count="0">暂无可直接发起的流程，可以直接对话。</span> : null}
          <span data-testid="chat-task-workbench-capability-facet-memory" data-memory-scope="thread" title={MEMORY_SCOPE_FULL_LABEL}>记忆{MEMORY_SCOPE_SHORT_LABEL}</span>
          {" · "}
          <span data-testid="chat-task-workbench-capability-facet-materials" title="能读哪些材料：该数字人未单独声明">材料读取</span>
          <span data-testid="chat-task-workbench-capability-facet-writes" title="是否写文件或调外部服务：该数字人未单独声明">与写入范围未单独声明，按组织权限执行</span>
        </p>
      </>
    );
  } else if (pending) {
    body = (
      <>
        <div className="flex items-center gap-3">
          <Avatar initials={pending.name.slice(0, 1)} avatarKey={pending.avatar?.key ?? null} tone="ai" size="lg" className="size-14 text-16" />
          <div className="min-w-0">
            <p className="truncate text-14 font-semibold text-card-foreground">{pending.name}</p>
            <Badge tone="outline" className="mt-1">官方数字人 · 待启用</Badge>
          </div>
        </div>
        <TagChips tags={pending.tags} max={6} />
        <p className="text-11 leading-relaxed text-muted-foreground">
          启用后可在这里直接选用{pending.workflowAllowlist.length > 0 ? "，并按角色发起相应的工作流程" : ""}。启用由组织管理员一次完成，所需的技能与流程会一并准备好。
        </p>
        <PendingWorkflows role={pending} />
        <ol data-testid="chat-task-workbench-capability-pending-steps" className="flex flex-col gap-1 border-t border-border pt-2 text-11 text-card-foreground">
          <li className="text-10 font-medium text-muted-foreground">启用之后</li>
          <li>1. 出现在上方「数字人」分组，可直接选用</li>
          <li>2. 在对话里说出任务，由它按流程推进</li>
          <li>3. 需要审批的步骤会先请你确认</li>
        </ol>
      </>
    );
  } else {
    body = (
      <>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-20 text-primary">✦</span>
          <div className="min-w-0">
            <p className="text-14 font-semibold text-card-foreground">自动匹配</p>
            <p className="text-11 text-muted-foreground">按你这条消息的任务挑人</p>
          </div>
        </div>
        {suggestions.length > 0 ? (
          <div data-testid="chat-task-workbench-capability-auto-candidates" className="flex flex-col gap-1.5 border-t border-border pt-2">
            <p className="text-10 font-medium text-muted-foreground">可能由他们来处理</p>
            {suggestions.slice(0, 4).map((e) => (
              <div key={e.listing.id} className="flex items-center gap-2">
                <Avatar initials={e.card?.initials || abbrFor(e.listing)} avatarKey={e.card?.avatar?.key ?? null} tone="ai" size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-11 font-medium text-card-foreground">{e.listing.name}</span>
                  <span className="truncate text-10 text-muted-foreground">{strengthsFor(e.listing, e.card) ?? "日常对话与问答"}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div data-testid="chat-task-workbench-capability-examples" className="flex flex-col gap-1 border-t border-border pt-2">
          <p className="text-10 font-medium text-muted-foreground">适合这样问</p>
          <ul className="flex flex-col gap-1">
            {autoExamplePrompts(suggestions).map((q) => <li key={q} className="rounded-md bg-muted px-2 py-1 text-11 text-card-foreground">{q}</li>)}
          </ul>
        </div>
        <p className="border-t border-border pt-2 text-11 leading-relaxed text-muted-foreground">按消息里的任务与标签挑最合适的一位；想固定由某位数字人处理，从左侧选择即可。</p>
      </>
    );
  }
  const canChoose = step !== undefined && (entry ? identity.isCapabilityReady(entry.listing) : pending === undefined);
  return (
    <aside
      aria-label="数字人详情"
      data-testid="chat-task-workbench-capability-preview"
      data-step={step ? "detail" : undefined}
      className={step ? "flex min-h-0 w-full flex-1 flex-col gap-2.5 overflow-y-auto p-3" : "hidden w-[18rem] shrink-0 flex-col gap-2.5 overflow-y-auto p-3 sm:flex"}
    >
      {step ? (
        <button type="button" data-testid="chat-task-workbench-capability-detail-back" onClick={step.onBack} className="-ml-1 flex items-center gap-1 self-start rounded-md px-1 py-1 text-12 text-muted-foreground transition-colors duration-fast hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft aria-hidden className="size-4" />返回列表
        </button>
      ) : null}
      {body}
      {step && canChoose ? (
        <Button type="button" variant="primary" className="sticky bottom-0 mt-auto w-full" data-testid="chat-task-workbench-capability-detail-choose" onClick={step.onChoose}>选择</Button>
      ) : null}
    </aside>
  );
}

/** 「可发起」列表：超过 5 项时「另有 n 个」可点开全部，「收起」还原（不是死路）。 */
function ExpandableList({ items, testId = "chat-task-workbench-capability-facet-tools-more" }: { items: readonly string[]; testId?: string }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const shown = open ? items : items.slice(0, 5);
  return (
    <ul className="flex flex-col gap-0.5">
      {shown.map((w) => <li key={w} className={open ? "break-words" : "truncate"} title={w}>{w}</li>)}
      {items.length > 5 ? (
        <li>
          <button type="button" aria-expanded={open} data-testid={testId} onClick={() => setOpen((v) => !v)} className="text-left text-muted-foreground underline-offset-2 transition-colors duration-fast hover:text-card-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {open ? "收起" : `另有 ${items.length - 5} 个`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function PendingWorkflows({ role }: { role: PendingOfficialRole }): JSX.Element | null {
  const { labels, unknown } = pendingWorkflowLabels(role);
  if (labels.length === 0 && unknown === 0) return null;
  return (
    <div data-testid="chat-task-workbench-capability-pending-workflows" className="flex flex-col gap-1 border-t border-border pt-2">
      <p className="text-10 font-medium text-muted-foreground">启用后可发起</p>
      <div className="text-11 text-card-foreground">
        {labels.length > 0 ? <ExpandableList key={role.name} items={labels} testId="chat-task-workbench-capability-pending-workflows-more" /> : null}
        {unknown > 0 ? <p className="text-muted-foreground">{labels.length > 0 ? "另有" : "共"} {unknown} 个流程</p> : null}
      </div>
    </div>
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

/** 低于 `sm`（640px）改为贴底的底部面板（复审 P0-3：窄屏浮层压住页头、悬在屏幕中间）。 */
const SHEET_BREAKPOINT = 640;
/** 浮层与 composer 上沿的间距（复审 P1-9）。 */
const SIDE_OFFSET = 8;

interface Placement { left: number; top?: number; bottom?: number; listMax: number; sheet?: boolean; arrowX?: number }

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
  // 箭头指向触发器的水平中心（夹在浮层圆角内），让浮层与「能力：…」芯片的归属关系一眼可见。
  const arrowX = Math.max(16, Math.min(width - 16, a.left + a.width / 2 - left));
  if (above >= 320 || above >= below) return { left, bottom: vh - f.top + SIDE_OFFSET, listMax: Math.max(160, Math.min(448, above - CHROME)), arrowX };
  return { left, top: a.bottom + SIDE_OFFSET, listMax: Math.max(160, Math.min(448, below - CHROME)) };
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
      if (window.innerWidth < SHEET_BREAKPOINT) {
        // 底部面板：全宽贴底，高度上限 85% 视口；列表高度 = 面板上限 − 标题栏/搜索/标签/页脚。
        setPlacement({ left: 0, bottom: 0, sheet: true, listMax: Math.max(200, Math.round(window.innerHeight * 0.85) - 190) });
        return;
      }
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
        sheet={placement?.sheet === true}
        autoFocusSearch
        onSelect={(agentId) => { onSelect(agentId); setOpen(false); anchorRef?.current?.focus(); }}
      />
    );
  }
  const close = () => { setOpen(false); anchorRef?.current?.focus(); };
  if (placement?.sheet) {
    return createPortal(
      <>
        <div aria-hidden data-testid="chat-task-workbench-capability-sheet-backdrop" className="fixed inset-0 z-50 bg-inverse/40" />
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-label="选择数字人"
          data-testid="chat-task-workbench-capability-popover"
          data-layout="sheet"
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-container border-t border-border bg-popover pb-[env(safe-area-inset-bottom)] shadow-lg"
        >
          <div className="relative flex items-center gap-2 border-b border-border px-3 pb-2 pt-3">
            <span aria-hidden className="absolute left-1/2 top-1 h-1 w-8 -translate-x-1/2 rounded-pill bg-muted" />
            <p className="flex-1 text-13 font-semibold text-popover-foreground">选择数字人</p>
            <Button type="button" size="icon" variant="ghost" aria-label="关闭" data-testid="chat-task-workbench-capability-sheet-close" onClick={close}>
              <X aria-hidden className="size-4" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{content}</div>
        </div>
      </>,
      document.body,
    );
  }
  return createPortal(
    <div
      ref={containerRef}
      data-testid="chat-task-workbench-capability-popover"
      data-layout="popover"
      style={style}
      className="fixed z-50 rounded-lg border border-border bg-popover shadow-lg"
    >
      <div className="overflow-hidden rounded-lg">{content}</div>
      {placement?.arrowX !== undefined ? (
        <span
          aria-hidden
          data-testid="chat-task-workbench-capability-arrow"
          style={{ left: placement.arrowX - 6 }}
          className="absolute -bottom-1.5 size-3 rotate-45 border-b border-r border-border bg-popover"
        />
      ) : null}
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
  const abilities = workflowLabelsOf(selectedCard);
  const abilityHint = abilities.length > 0 ? `能做：${joinWithOverflow(abilities, 3)}` : null;
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
        className="flex h-7 max-w-[11rem] min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-12 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-disabled-foreground"
      >
        {selected ? <Avatar initials={selectedCard?.initials || abbrFor(selected)} avatarKey={selectedCard?.avatar?.key ?? null} tone="ai" size="xs" /> : null}
        {/* 复审 r1：芯片只放肖像 + 名字，能力清单移进 title 提示，不再两段截断。 */}
        <span data-testid="chat-task-workbench-capability-picker-name" className="truncate">{selected ? selected.name : "能力：自动匹配"}</span>
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
