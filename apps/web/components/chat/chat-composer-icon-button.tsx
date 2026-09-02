"use client";

import * as React from "react";

/**
 * 2026-09-02 composer 重设计——工具栏的 32px 圆形图标按钮（材料 / 技能 / 任务模式）。
 * 名称不常驻，悬停显示（`title`），读屏走 `aria-label`。`pressed` 为开关型按钮的
 * 开启态（任务模式）：反色实心。右上角可挂一个小数字角标（材料数 / 已挂技能数）。
 * 尺寸按设计稿 2x 截图折算：直径 32、描边 1、图标 16、间距 10。
 */
export const ComposerIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly label: string;
    readonly pressed?: boolean;
    readonly badge?: number;
    readonly badgeTestId?: string;
  }
>(function ComposerIconButton({ label, pressed, badge, badgeTestId, className, children, ...rest }, ref) {
  return (
    <span className="relative inline-flex">
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={rest.title ?? label}
        aria-pressed={pressed}
        className={[
          "flex h-8 w-8 items-center justify-center rounded-pill border transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:border-transparent disabled:bg-disabled disabled:text-disabled-foreground",
          pressed
            ? "border-inverse bg-inverse text-inverse-foreground hover:bg-primary-hover"
            : "border-border bg-panel-alt text-card-foreground hover:bg-muted",
          className ?? "",
        ].join(" ")}
        {...rest}
      >
        {children}
      </button>
      {badge !== undefined && badge > 0 ? (
        <span
          data-testid={badgeTestId}
          className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-inverse px-1 text-9 font-medium tabular-nums text-inverse-foreground"
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
});
