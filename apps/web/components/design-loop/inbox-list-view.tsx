"use client";
import * as React from "react";
import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { INBOX_STAGE_LABEL, INBOX_STAGE_ORDER, type InboxItem, type InboxStage } from "@/lib/live-inbox";
import { GithubBadge, SevereBadge } from "./badges";
import {
  CardMeta, ExceptionRecurrence, HIGHLIGHT_CLASS, ItemStatusBadge, KindLabel, LoadMoreBar, QuickActionMenu,
  formatRelative, type NavigateLink,
} from "./inbox-shared";
import { TagEditor } from "./inbox-tags";

export type StageFilter = "all" | InboxStage;

/**
 * 2026-09-08——收件箱列表视图，从 `inbox-screen.tsx` 拆出并重做（人类原话「列表模式很丑」）。
 *
 * ## 这版改了什么
 *
 *   · **一行一条、两层信息**：第一行是标题（`text-13`），第二行是编号 · 类型 · 提交人 · 时间这些
 *     元信息（`text-11` 灰），不再把编号、标题、徽标、关联标全塞在一个 `flex-wrap` 里挤成一团。
 *   · **列宽固定、对齐一致**：状态 / 类型 / GitHub / 时间四列各自定宽，标题列吃掉剩余空间；
 *     数字与时间右对齐。表头用面板底色、粘顶。
 *   · **状态子筛选做成分段控件**并显示当前行数；归档箱（`archived` 视图）时不显示分段——
 *     归档箱里只有一种状态。
 *   · **标签**：同看板卡片一样可在行内增删、点标签即筛选（`TagEditor`）。
 *   · hover 才出现的行菜单沿用 `QuickActionMenu`，归档动作也在这里（此前只有看板有）。
 */
export function InboxListView({
  items, stageFilter, onStageFilter, onOpen, highlightId, onNavigateLink, busyId, onQuickAction, onArchive,
  onSaveTags, onFilterTag, archivedView, nextCursor, loadingMore, onLoadMore,
}: {
  items: InboxItem[];
  stageFilter: StageFilter;
  onStageFilter: (s: StageFilter) => void;
  onOpen: (id: string) => void;
  highlightId: string | null;
  onNavigateLink: NavigateLink;
  busyId: string | null;
  onQuickAction: (item: InboxItem, target: InboxStage) => void;
  onArchive: (item: InboxItem) => void;
  onSaveTags: (item: InboxItem, tags: readonly string[]) => void;
  onFilterTag: (tag: string) => void;
  /** 归档箱：不显示状态分段，空态文案不同。 */
  archivedView: boolean;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const subFilters: { value: StageFilter; label: string }[] = [
    { value: "all", label: "全部" },
    ...INBOX_STAGE_ORDER.map((s) => ({ value: s as StageFilter, label: INBOX_STAGE_LABEL[s] })),
  ];
  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="inbox-list">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        {archivedView ? (
          <p className="flex items-center gap-1.5 text-11 text-muted-foreground" data-testid="inbox-archived-hint">
            <Archive aria-hidden className="h-3.5 w-3.5" />
            归档箱：已归档的反馈离开看板后都在这里，可随时「重新打开」回到待处理。
          </p>
        ) : (
          <div className="inline-flex items-center gap-0.5 rounded-control bg-panel p-0.5" role="group" aria-label="状态筛选">
            {subFilters.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={stageFilter === f.value}
                onClick={() => onStageFilter(f.value)}
                data-testid={`inbox-status-${f.value}`}
                className={cn(
                  "rounded-control px-2.5 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  stageFilter === f.value ? "bg-card text-card-foreground shadow-sm" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <span className="text-11 text-muted-foreground" data-testid="inbox-list-count">{items.length} 条</span>
      </div>
      {/* B6.5（U8）：宽表格在 375 下横向可滚是设计，不让单元格挤成一字一行。 */}
      <div className="flex-1 overflow-y-auto overflow-x-auto" data-allow-x-scroll="列表视图的宽表格在窄视口横向滚动是设计">
        <table className="w-full min-w-[44rem] table-fixed border-collapse text-12">
          <colgroup>
            <col className="w-20" />
            <col />
            <col className="w-24" />
            <col className="w-36" />
            <col className="w-28" />
            <col className="w-10" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-border text-left text-10 font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2">状态</th>
              <th className="px-3 py-2">条目</th>
              <th className="px-3 py-2">类型</th>
              <th className="px-3 py-2">GitHub</th>
              <th className="px-3 py-2 text-right">次数 / 时间</th>
              <th className="px-2 py-2" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const busy = busyId === item.id;
              const timeCell =
                item.kind === "exception" && item.exception !== null ? (
                  <>
                    <span className="font-medium text-card-foreground">{item.exception.count} 次</span>
                    {item.exception.count > 1 && (
                      <span className="block text-10" title={new Date(item.exception.lastSeenAt).toLocaleString("zh-CN")}>
                        最近 {formatRelative(item.exception.lastSeenAt)}
                      </span>
                    )}
                  </>
                ) : (
                  <span title={new Date(item.createdAt).toLocaleString("zh-CN")}>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</span>
                );
              return (
                <tr
                  key={item.id}
                  onClick={() => onOpen(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(item.id); }
                  }}
                  tabIndex={0}
                  aria-label={`${item.code} ${item.title}`}
                  data-testid={`inbox-row-${item.code}`}
                  data-highlighted={highlightId === item.id ? "true" : undefined}
                  className={cn(
                    "group cursor-pointer border-b border-border-subtle align-top transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    busy && "cursor-wait",
                    highlightId === item.id && cn(HIGHLIGHT_CLASS, "ring-inset bg-ai-tint/30"),
                  )}
                >
                  <td className="px-4 py-2.5"><ItemStatusBadge item={item} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-start gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-13 font-medium text-card-foreground" title={item.title}>{item.title}</p>
                      {item.severe && <SevereBadge />}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-11 text-muted-foreground">
                      <span className="font-mono text-10">{item.code}</span>
                      {item.reporter !== null && <span>· {item.reporter}</span>}
                      <ExceptionRecurrence item={item} testid={`inbox-row-recurrence-${item.code}`} />
                      <CardMeta item={item} onNavigateLink={onNavigateLink} />
                    </div>
                    <div className="mt-1">
                      <TagEditor
                        tags={item.tags}
                        onChange={(next) => onSaveTags(item, next)}
                        onFilter={onFilterTag}
                        busy={busy}
                        testidPrefix={`inbox-row-${item.code}`}
                        compact
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><KindLabel item={item} /></td>
                  <td className="px-3 py-2.5">{item.github !== null ? <GithubBadge {...item.github} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-11 text-muted-foreground">{timeCell}</td>
                  <td className="px-2 py-2.5 text-right">
                    <div className="inline-flex invisible transition-opacity duration-fast group-hover:visible group-focus-within:visible">
                      <QuickActionMenu
                        item={item}
                        busy={busy}
                        onQuickAction={(target) => onQuickAction(item, target)}
                        onArchive={() => onArchive(item)}
                        testidPrefix="inbox-row"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="p-8 text-center text-12 text-muted-foreground" data-testid="inbox-list-empty">
            {archivedView ? "归档箱是空的——在「已完成」或「不做」的反馈上选「归档」即可把它收进来。" : "没有符合当前筛选的条目。"}
          </p>
        )}
        <LoadMoreBar nextCursor={nextCursor} loading={loadingMore} onLoadMore={onLoadMore} />
      </div>
    </div>
  );
}
