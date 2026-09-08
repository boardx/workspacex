"use client";
import * as React from "react";
import { Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { ApiError } from "@/lib/api-client";
import { INBOX_KIND_LABEL, isArchivedInboxItem, type InboxItem, type InboxStage } from "@/lib/live-inbox";
import { canArchiveInboxItem } from "./board-reorder";
import { LinkBadge, StatusBadge } from "./badges";

/**
 * 2026-09-08——`inbox-screen.tsx` 拆分（该文件已撞 2000 行上限，AGENTS.md 文件规模纪律）：
 * 看板 / 列表 / drawer 三处共用的小部件与纯函数集中在这里。**没有状态、没有 IO**。
 */

/** B3.7——关联跳转回调：`targetId` 是契约 `InboxItem.id`，`label` 只用于提示文案。 */
export type NavigateLink = (targetId: string, label: string) => void;

export function describeFailure(err: unknown): string {
  if (err instanceof ApiError) return err.reasonCode ?? `http_${err.status}`;
  if (err instanceof TypeError) return "无法连接服务器，请稍后重试";
  return String(err);
}

/** B3.7 高亮态：卡片/行共用，用 `ring-primary` token，不硬编码颜色。 */
export const HIGHLIGHT_CLASS = "ring-2 ring-primary ring-offset-1 ring-offset-background";

export function KindLabel({ item }: { item: InboxItem }) {
  const text = item.kind === "feedback" && item.feedbackKind !== null ? item.feedbackKind : INBOX_KIND_LABEL[item.kind];
  return <span className="whitespace-nowrap rounded-control border border-border px-1.5 py-0.5 text-10 text-muted-foreground">{text}</span>;
}

/**
 * 状态标：已归档的反馈显示「已归档」，不显示它在四列投影上共享的「不做」位置——归档箱里
 * 每一行都标「不做」会让人以为它们全是被拒掉的（见契约 `isArchivedInboxItem` 头注）。
 */
export function ItemStatusBadge({ item }: { item: InboxItem }) {
  if (isArchivedInboxItem(item)) return <Badge tone="neutral" data-testid="status-badge-archived-feedback">已归档</Badge>;
  return <StatusBadge stage={item.stage} />;
}

/** 关联标：反馈 → 「已生成方案」（目标 = 设计条目 id），设计 → 「源自反馈」（目标 = 反馈 id）。 */
export function CardMeta({ item, onNavigateLink }: { item: InboxItem; onNavigateLink: NavigateLink }) {
  return (
    <>
      {item.resolvedByDesignId !== null && (
        <LinkBadge text="已生成方案" testid={`link-generated-${item.code}`} onClick={() => onNavigateLink(item.resolvedByDesignId!, "设计方案")} />
      )}
      {item.linkedFeedbackId !== null && (
        <LinkBadge text="源自反馈" testid={`link-from-${item.code}`} onClick={() => onNavigateLink(item.linkedFeedbackId!, "反馈")} />
      )}
    </>
  );
}

/** 系统异常卡片/行上的「N 次 · 最近 <时间>」。只有折叠了重复行（`count > 1`）才值得占一行。 */
export function ExceptionRecurrence({ item, testid }: { item: InboxItem; testid: string }) {
  if (item.kind !== "exception" || item.exception === null || item.exception.count <= 1) return null;
  return (
    <span className="whitespace-nowrap text-10 text-muted-foreground" data-testid={testid} title={`最近一次：${new Date(item.exception.lastSeenAt).toLocaleString("zh-CN")}`}>
      ×{item.exception.count} · 最近 {formatRelative(item.exception.lastSeenAt)}
    </span>
  );
}

/** 「3 分钟前 / 2 小时前 / 昨天 / 9/4」——只给一眼看的时间，精确值放 `title`。 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return new Date(iso).toLocaleDateString("zh-CN");
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return "昨天";
  if (d < 7) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function LoadMoreBar({ nextCursor, loading, onLoadMore }: { nextCursor: string | null; loading: boolean; onLoadMore: () => void }) {
  if (nextCursor === null) return null;
  return (
    <div className="flex justify-center border-t border-border p-3">
      <Button size="sm" variant="outline" disabled={loading} onClick={onLoadMore} data-testid="inbox-load-more">
        {loading && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
        加载更多
      </Button>
    </div>
  );
}

/**
 * issue #2752 ③——hover 卡片/行时缺一个不用先点开详情就能做的操作动作（比如关闭）。
 * 复用 `applyTransition`（footer 按钮同一套逻辑，含「不做」落点到 drawer 理由表单、
 * 系统异常没有「已完成」这条边会被拒绝的规则），这里只挑"当前状态能一键做"的几条
 * 摆进菜单，不重造第二套状态机判断。`item.kind === "design"` 没有对应源操作，不渲染。
 */
export function QuickActionMenu({
  item, busy, onQuickAction, onArchive, testidPrefix,
}: {
  item: InboxItem;
  busy: boolean;
  onQuickAction: (target: InboxStage) => void;
  /** 2026-09-06——归档动作，`undefined` 时不渲染这个入口。 */
  onArchive?: () => void;
  testidPrefix: string;
}) {
  if (item.kind === "design") return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="更多操作"
          disabled={busy}
          data-testid={`${testidPrefix}-menu-${item.code}`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-5 w-5 items-center justify-center rounded-control text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
        </button>
      </MenuTrigger>
      <MenuContent align="end" onClick={(e) => e.stopPropagation()} data-testid={`${testidPrefix}-menu-content-${item.code}`}>
        {item.stage === "backlog" && (
          <MenuItem onSelect={() => onQuickAction("doing")} data-testid={`${testidPrefix}-menu-start-${item.code}`}>
            开始处理
          </MenuItem>
        )}
        {item.stage === "doing" && item.kind === "feedback" && (
          <MenuItem onSelect={() => onQuickAction("done")} data-testid={`${testidPrefix}-menu-done-${item.code}`}>
            标记已修复
          </MenuItem>
        )}
        {item.stage === "doing" && (
          <MenuItem onSelect={() => onQuickAction("backlog")} data-testid={`${testidPrefix}-menu-back-${item.code}`}>
            退回待处理
          </MenuItem>
        )}
        {(item.stage === "done" || item.stage === "archived") && (
          <MenuItem onSelect={() => onQuickAction("backlog")} data-testid={`${testidPrefix}-menu-reopen-${item.code}`}>
            重新打开
          </MenuItem>
        )}
        {(item.stage === "backlog" || item.stage === "doing") && (
          <>
            <MenuSeparator />
            <MenuItem
              onSelect={() => onQuickAction("archived")}
              data-testid={`${testidPrefix}-menu-close-${item.code}`}
              className="text-destructive focus:text-destructive"
            >
              关闭（不做）…
            </MenuItem>
          </>
        )}
        {onArchive !== undefined && canArchiveInboxItem(item) && (
          <>
            <MenuSeparator />
            {/* 2026-09-06——触发已有的「已归档」状态，不需要理由（只有转「不做」才要理由，见契约
                `TRIAGE_REASON_REQUIRED`），所以直接点即生效；2026-09-08 起归档后离开看板，进「归档箱」。 */}
            <MenuItem onSelect={onArchive} data-testid={`${testidPrefix}-menu-archive-${item.code}`}>
              归档
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
