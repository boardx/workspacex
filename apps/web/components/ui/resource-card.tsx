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
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="menuitem"], [role="checkbox"], [data-card-stop]';

export function ResourceCard({
  testId, title, titleTestId, subtitle, badges, menu, description, tags, meta, children, actions,
  layout = "grid", density = "comfortable", href, titleHref, titleLinkTestId, onClick, selected = false, leading, media, ariaLabel, className, headingLevel = 3,
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
  /** `compact`：看板/侧栏里的紧凑卡（内边距与字号各降一档）。 */
  density?: "comfortable" | "compact";
  /**
   * 整张卡片是一条链接（首页预览卡、项目内容卡用）：卡片本身渲染成 `<a>`，键盘可达、有焦点环。
   * 带 `href` 时卡片里不要再放别的可点元素（不能嵌套链接/按钮）。
   */
  href?: string;
  /**
   * 「拉伸链接」：标题是一条 `<a>`，它的热区铺满整张卡片（键盘 Tab 直达、焦点环落在整卡上），
   * 而卡片里的菜单 / 操作区 / 标签仍各自可点（抬到 z-10）。适合「整卡是打开入口，但卡里还有别的控件」的卡
   * （项目内容卡）。`titleLinkTestId` 放在那条 `<a>` 上。
   */
  titleHref?: string;
  titleLinkTestId?: string;
  /**
   * 整张卡片可点（目录选中、打开编辑器等）：卡片是 `role="button"`，Enter/空格触发；
   * 卡片里的按钮/链接/输入框/菜单自己的点击**不会**冒泡成整卡点击。
   */
  onClick?: () => void;
  /** 选中态：加一圈焦点色描边（目录页「当前选中的那一项」）。 */
  selected?: boolean;
  /** 标题左侧的头像 / 图标槽。 */
  leading?: React.ReactNode;
  /** 卡片顶部通栏的缩略图 / 封面槽（贴边，随卡片圆角裁切）。 */
  media?: React.ReactNode;
  /** 整卡是链接/按钮时的读屏名（默认取内容文本）。 */
  ariaLabel?: string;
  className?: string;
  /** 卡片标题的标题层级。页面 h1 之下直接是卡片列表时用 2，避免跳级（默认 3，嵌在 h2 分区里的卡片）。 */
  headingLevel?: 2 | 3;
}) {
  const list = layout === "list";
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const compact = density === "compact";
  const shell = cn(
    "flex h-full min-w-0 flex-col overflow-hidden transition-all duration-base hover:shadow-md",
    selected && "ring-2 ring-ring",
    titleHref !== undefined && "group relative hover:border-primary",
    className,
  );
  // 拉伸链接模式下，除标题外的可交互区域抬到 z-10，不被铺满的 <a> 吃掉点击
  const lift = titleHref !== undefined ? "relative z-10" : "";
  const cardSurface = "rounded-card border border-border bg-card text-card-foreground shadow-sm";
  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const body = (
    <>
      {media ? <div className="shrink-0 border-b border-border-subtle">{media}</div> : null}
      <CardContent className={cn("flex flex-1 flex-col", compact ? "gap-2 p-3" : "gap-3 p-4", list && "sm:flex-row sm:items-center sm:justify-between")}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {leading ? <div className="shrink-0">{leading}</div> : null}
              <div className="flex min-w-0 flex-col gap-1">
                <Heading className={cn("font-semibold tracking-tight", titleHref === undefined && "truncate", compact ? "text-13" : "text-14")} data-testid={titleTestId}>
                  {titleHref !== undefined ? (
                    <Link
                      href={titleHref}
                      data-testid={titleLinkTestId}
                      className="line-clamp-2 break-words rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0 after:content-['']"
                    >
                      {title}
                    </Link>
                  ) : title}
                </Heading>
                {subtitle ? <p className="text-11 text-muted-foreground">{subtitle}</p> : null}
              </div>
            </div>
            {badges || menu ? (
              <div className={cn("flex shrink-0 items-center gap-1.5", lift)}>
                {badges}
                {menu}
              </div>
            ) : null}
          </div>
          {description ? <div className={cn("text-12 leading-relaxed text-muted-foreground", compact ? "line-clamp-2" : "line-clamp-2")}>{description}</div> : null}
          {tags}
          {children}
          {meta ? <div className="flex flex-wrap items-center justify-between gap-2 text-11 text-muted-foreground">{meta}</div> : null}
        </div>
        {actions ? <div className={cn("flex flex-wrap items-center gap-2", list ? "shrink-0" : "mt-auto pt-1", lift)}>{actions}</div> : null}
      </CardContent>
    </>
  );
  if (href !== undefined) {
    return (
      <Link href={href} data-testid={testId} aria-label={ariaLabel} className={cn(cardSurface, focusRing, shell)}>
        {body}
      </Link>
    );
  }
  if (onClick !== undefined) {
    const inner = (target: EventTarget | null, host: HTMLElement) => {
      const el = target as Element | null;
      const hit = el?.closest?.(INTERACTIVE) ?? null;
      return hit !== null && hit !== host && host.contains(hit);
    };
    return (
      <Card
        data-testid={testId}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-pressed={selected || undefined}
        data-selected={selected ? "true" : undefined}
        onClick={(e) => { if (!inner(e.target, e.currentTarget)) onClick(); }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
        }}
        className={cn("cursor-pointer", focusRing, shell)}
      >
        {body}
      </Card>
    );
  }
  // 纯展示卡：语义上是一篇独立内容（article），读屏能按「文章」导航，测试也按这个 role 找卡
  return <article data-testid={testId} aria-label={ariaLabel} className={cn(cardSurface, shell)}>{body}</article>;
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
