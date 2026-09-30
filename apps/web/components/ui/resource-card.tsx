import * as React from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { TagChip } from "@/components/ui/tag-chip";
import { cn } from "@/lib/utils";

/**
 * 标准资源卡片（2026-09-30 人类直接要求：「所有的卡片的界面全部统一成标准的项目组件」）。
 *
 * 版式取自 `/projects` 的项目卡片（此前的事实标准），抽成一处，项目 / 设计 / 研究 / 访谈 /
 * 录音 / 问卷等列表页的卡片都走它，不再各写一套：
 *
 *   ┌──────────────────────────────────────┐
 *   │ 标题（可截断）              [状态] [⋯] │  ← header：`badges` + `menu`
 *   │ 类型 / 副标题（11px 灰）              │  ← `subtitle`
 *   │ 描述（最多两行，可选）                 │  ← `description`
 *   │ 标签芯片                              │  ← `tags`
 *   │ …自定义正文（进度条 / 统计）           │  ← `children`
 *   │ 元信息（来源数 · 更新时间）            │  ← `meta`
 *   │ [主按钮] [次按钮]                     │  ← `actions`，主按钮在最前
 *   └──────────────────────────────────────┘
 *
 * ⚠ 只管版式：状态怎么算、菜单里有什么、点了去哪，全部由调用方传入——本组件不认识任何一种
 *   业务对象。`layout="list"` 是项目页的列表视图（操作列靠右），其余页面用默认的网格版式。
 */
export function ResourceCard({
  testId, title, titleTestId, subtitle, badges, menu, description, tags, meta, children, actions,
  layout = "grid", href, className,
}: {
  testId?: string;
  title: React.ReactNode;
  titleTestId?: string;
  subtitle?: React.ReactNode;
  /** 标题右侧的状态徽标（可多个）。 */
  badges?: React.ReactNode;
  /** 标题右侧最末的「⋯」菜单触发器 + 内容（调用方自己带 Menu）。 */
  menu?: React.ReactNode;
  description?: React.ReactNode;
  tags?: React.ReactNode;
  meta?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  layout?: "grid" | "list";
  /**
   * 整张卡片是一条链接（首页「继续你的工作」这类只读预览卡用）：卡片本身渲染成 `<a>`，
   * 键盘可达、有焦点环。带 `href` 时卡片里不要再放别的可点元素（不能嵌套链接/按钮）。
   */
  href?: string;
  className?: string;
}) {
  const list = layout === "list";
  const shell = cn("flex h-full min-w-0 flex-col transition-all duration-base hover:shadow-md", className);
  const body = (
    <>
      <CardContent className={cn("flex flex-1 flex-col gap-3 p-4", list && "sm:flex-row sm:items-center sm:justify-between")}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="truncate text-14 font-semibold tracking-tight" data-testid={titleTestId}>{title}</h3>
              {subtitle ? <p className="text-11 text-muted-foreground">{subtitle}</p> : null}
            </div>
            {badges || menu ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {badges}
                {menu}
              </div>
            ) : null}
          </div>
          {description ? <div className="line-clamp-2 text-12 leading-relaxed text-muted-foreground">{description}</div> : null}
          {tags}
          {children}
          {meta ? <div className="flex flex-wrap items-center justify-between gap-2 text-11 text-muted-foreground">{meta}</div> : null}
        </div>
        {actions ? <div className={cn("flex flex-wrap items-center gap-2", list ? "shrink-0" : "mt-auto pt-1")}>{actions}</div> : null}
      </CardContent>
    </>
  );
  if (href !== undefined) {
    return (
      <Link
        href={href}
        data-testid={testId}
        className={cn(
          "rounded-card border border-border bg-card text-card-foreground shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          shell,
        )}
      >
        {body}
      </Link>
    );
  }
  return <Card data-testid={testId} className={shell}>{body}</Card>;
}

/** 标准标签芯片行（字符串标签用；标签外观唯一来源是 `TagChip`）。`onTagClick` 给了就可点击筛选。 */
export function ResourceCardTags({ tags, max, testId, onTagClick, selectedTags = [] }: {
  tags: readonly string[]; max?: number; testId?: string; onTagClick?: (tag: string) => void; selectedTags?: readonly string[];
}) {
  const shown = max === undefined ? tags : tags.slice(0, max);
  if (shown.length === 0) return null;
  const extra = tags.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid={testId}>
      {shown.map((tag) => (
        <TagChip
          key={tag}
          onClick={onTagClick === undefined ? undefined : () => onTagClick(tag)}
          selected={selectedTags.includes(tag)}
        >
          {tag}
        </TagChip>
      ))}
      {extra > 0 ? <span className="text-10 text-muted-foreground">+{String(extra)}</span> : null}
    </div>
  );
}
