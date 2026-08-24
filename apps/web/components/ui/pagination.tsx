import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pagination —— 契约束 interaction-primitives（F10）复合组件之一。
 *
 * 盘点结论（2026-08-24，自己重新 grep 核对，不信任种子清单）：
 * - `components/admin/capability-catalog-screen.tsx`：页码分页（`page`/`pageCount` state +
 *   「上一页」「下一页」两个 `Button`，`disabled` 卡住边界）。
 * - `components/profile/profile-screen.tsx`：游标分页（`nextCursor` + 单个「加载更多」
 *   `Button`，无「上一页」概念，是纯追加列表）。
 * - `components/survey/workflow/response-review-step.tsx`：页码分页（当时是静态原型，
 *   `<Button size="xs">1</Button><Button variant="ghost">2</Button>…` 硬编码页码按钮，
 *   未接真实翻页状态）。
 * 三处三种形状但都是「分页控件」这一个视觉/交互模式——达到 R4-A1 的 3 次门槛，收口。
 *
 * 设计取舍（回应 R4-E2 / usecases.md UC-4「pagination 组件层只负责展示与交互，不强行
 * 统一底层游标分页 vs 页码分页策略」）：本文件**不**内置任何分页状态机、不请求数据、
 * 不知道「下一页」按钮点了之后该发生什么——每个子组件都是纯展示 + 事件转发，由调用方
 * 决定要不要维护 `page`/`pageCount`，还是只维护一个 `nextCursor`。因此没有一个大一统的
 * `<Pagination items={...} onPageChange={...}>` 组件，而是给两种真实存在的形状各配一套
 * 拼接件：
 *   - 页码分页：`Pagination`（容器）+ `PaginationStatus` + `PaginationPrevious`/
 *     `PaginationNext` + 可选的 `PaginationItem`（页码按钮）/`PaginationEllipsis`。
 *   - 游标分页：`PaginationLoadMore`（单个「加载更多」按钮，`pending` 态与
 *     disabled 语义均已封装）。
 *
 * 视觉语言与 F09 的 table.tsx/menu.tsx 同一套 token（`border-border`/`text-muted-foreground`/
 * `duration-base`），按钮本身直接复用 `components/ui/button.tsx`（F01 标杆），不重新定义
 * 尺寸/圆角/hover 态。
 */

export const Pagination = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & { "aria-label"?: string }
>(({ className, "aria-label": ariaLabel = "分页", ...props }, ref) => (
  <nav
    ref={ref}
    role="navigation"
    aria-label={ariaLabel}
    className={cn("flex flex-wrap items-center justify-between gap-2", className)}
    {...props}
  />
));
Pagination.displayName = "Pagination";

/** 「共 N 条 · 第 X / Y 页」一类的状态文案位——纯展示，文案内容由调用方传入。 */
export const PaginationStatus = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("text-12 text-muted-foreground", className)} {...props} />
  ),
);
PaginationStatus.displayName = "PaginationStatus";

/** 页码按钮的横向容器——只负责排布，具体渲染几个 PaginationItem 由调用方决定（省略号同理）。 */
export const PaginationList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("flex items-center gap-1", className)} {...props} />,
);
PaginationList.displayName = "PaginationList";

export const PaginationPrevious = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children = "上一页", size = "sm", variant = "outline", ...props }, ref) => (
    <Button ref={ref} type="button" size={size} variant={variant} {...props}>
      {children}
    </Button>
  ),
);
PaginationPrevious.displayName = "PaginationPrevious";

export const PaginationNext = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children = "下一页", size = "sm", variant = "outline", ...props }, ref) => (
    <Button ref={ref} type="button" size={size} variant={variant} {...props}>
      {children}
    </Button>
  ),
);
PaginationNext.displayName = "PaginationNext";

/** 单个页码按钮；`active` 决定视觉高亮，不代表可点击状态（当前页通常也应可点，便于重新拉取）。 */
export const PaginationItem = React.forwardRef<HTMLButtonElement, ButtonProps & { active?: boolean }>(
  ({ children, active = false, size = "xs", className, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      size={size}
      variant={active ? "primary" : "ghost"}
      aria-current={active ? "page" : undefined}
      className={cn("min-w-6 px-2", className)}
      {...props}
    >
      {children}
    </Button>
  ),
);
PaginationItem.displayName = "PaginationItem";

/** 页码列表中的省略号占位——纯展示，不可交互。 */
export const PaginationEllipsis = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, children = "…", ...props }, ref) => (
    <span
      ref={ref}
      aria-hidden
      className={cn("px-1 text-12 text-muted-foreground", className)}
      {...props}
    >
      {children}
    </span>
  ),
);
PaginationEllipsis.displayName = "PaginationEllipsis";

/**
 * 游标分页的「加载更多」按钮——对应 profile-screen.tsx 的真实用法：
 * 有没有下一页由调用方通过是否渲染本组件来表达（`nextCursor` 存在才渲染），
 * `pending` 态复用 disabled + 文案切换，不新造一个 loading spinner 变体。
 */
export const PaginationLoadMore = React.forwardRef<
  HTMLButtonElement,
  ButtonProps & { pending?: boolean; pendingLabel?: React.ReactNode }
>(
  (
    { children = "加载更多", pending = false, pendingLabel = "加载中…", size = "xs", variant = "outline", disabled, ...props },
    ref,
  ) => (
    <Button ref={ref} type="button" size={size} variant={variant} disabled={disabled || pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  ),
);
PaginationLoadMore.displayName = "PaginationLoadMore";
