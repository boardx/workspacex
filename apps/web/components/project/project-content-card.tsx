"use client";
import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ResourceCard } from "@/components/ui/resource-card";

/**
 * 项目「内容」tab 的一张内容卡（#4743）—— 「全部」合并列表、按类型的资源列表、对话列表共用同一份。
 * 2026-09-30 起是标准 `ResourceCard` 的薄封装（图标进 `leading` 槽、类型是副标题、状态是徽标、
 * 「更多」菜单进 `menu`、底部操作区进 `actions`），版式不再自己写。
 *
 * 整张卡就是打开入口：标题是「拉伸链接」（`ResourceCard` 的 `titleHref`），键盘 Tab 直达、
 * 焦点环落在整卡上；菜单与操作区抬到 z-10，不被吃掉点击。`linkTestId` 放在那条 `<a>` 上。
 */
export function ProjectContentCard({
  href, linkTestId, cardTestId, icon: Icon, title, typeLabel, status, meta, menu, footer,
}: {
  href: string;
  linkTestId: string;
  cardTestId?: string;
  icon: LucideIcon;
  title: string;
  typeLabel: string;
  status?: string | null;
  /** 次要信息行（更新时间 / 副标题）。 */
  meta?: React.ReactNode;
  /** 右上角「更多」菜单（如移出项目）；没有就不画。 */
  menu?: React.ReactNode;
  /** 底部操作区（如对话的可见范围选择）。 */
  footer?: React.ReactNode;
}) {
  return (
    <ResourceCard
      testId={cardTestId}
      density="compact"
      titleHref={href}
      titleLinkTestId={linkTestId}
      title={title}
      subtitle={typeLabel}
      leading={
        <span className="flex h-9 w-9 items-center justify-center rounded-control bg-accent text-accent-foreground">
          <Icon aria-hidden className="h-4 w-4" />
        </span>
      }
      badges={status ? <Badge tone="neutral">{status}</Badge> : undefined}
      menu={menu}
      meta={meta ? <span className="min-w-0 truncate">{meta}</span> : undefined}
      actions={footer}
    />
  );
}

/** 卡片网格：手机 1 列 / 平板 2 列 / 桌面 3 列。 */
export const CONTENT_GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
