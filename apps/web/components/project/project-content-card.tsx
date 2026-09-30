"use client";
import * as React from "react";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 项目「内容」tab 的一张内容卡（#4743）—— 「全部」合并列表、按类型的资源列表、对话列表共用同一份，
 * 外观对齐项目列表卡（`ProjectRealCard`）：图标软底块 + 标题（最多两行）+ 类型徽标 + 更新时间。
 *
 * 整张卡就是打开入口：标题 `<a>` 用「拉伸链接」（`after:absolute after:inset-0`）铺满整卡，键盘 Tab 直达、
 * 焦点环落在整卡上（`focus-within`）；右上更多菜单（`menu`）与底部操作区（`footer`）抬到 `z-10`，
 * 不被拉伸链接吃掉点击。`linkTestId` 放在那条 `<a>` 上（e2e / 单测按它断言 href）。
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
    <Card
      data-testid={cardTestId}
      className={cn(
        "group relative flex h-full min-h-[6.5rem] flex-col gap-3 p-4 transition-all duration-base",
        "hover:border-primary hover:shadow-md",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground">
          <Icon aria-hidden className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={href}
            data-testid={linkTestId}
            title={title}
            className="line-clamp-2 break-words text-13 font-semibold tracking-tight rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0 after:content-['']"
          >
            {title}
          </a>
        </div>
        {menu ? (
          <div className="relative z-10 -mr-1 -mt-1 shrink-0">{menu}</div>
        ) : (
          <ArrowUpRight
            aria-hidden
            className="h-4 w-4 shrink-0 text-transparent transition-colors duration-base group-hover:text-muted-foreground group-focus-within:text-muted-foreground"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="outline">{typeLabel}</Badge>
        {status ? <Badge tone="neutral">{status}</Badge> : null}
        {meta ? <span className="min-w-0 truncate text-11 text-muted-foreground">{meta}</span> : null}
      </div>
      {footer ? <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2">{footer}</div> : null}
    </Card>
  );
}

/** 卡片网格：手机 1 列 / 平板 2 列 / 桌面 3 列。 */
export const CONTENT_GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";
