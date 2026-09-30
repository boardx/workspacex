import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 标签胶囊——**全仓唯一的标签视觉**（2026-09-30 人类要求统一标签体验）。
 *
 * 展示（卡片上的标签）、编辑（`TagInput` 里已选的标签）、点击筛选三种用法同一个外观：
 * 灰底圆角胶囊、10px 字。此前只读标签有四种写法（自画 span / Badge / ResourceCardTags /
 * TagInput 的深色胶囊），字号 9/10/11/12 混用。
 *
 *   · 纯展示：`<TagChip>客户</TagChip>`
 *   · 可删除：传 `onRemove`（渲染 ×，带「移除标签 x」读屏名）
 *   · 可点击（点标签筛选）：传 `onClick`，整颗胶囊是按钮；`selected` 时反色
 */
export function TagChip({
  children, onRemove, onClick, selected = false, disabled = false, removeTestId, filterTestId, filterTitle, testId, className,
}: {
  children: string;
  onRemove?: () => void;
  onClick?: () => void;
  /** 既可点击筛选又可删除时，内层「筛选」按钮的 testid / 提示（整颗胶囊是 span，内含两个按钮）。 */
  filterTestId?: string;
  filterTitle?: string;
  selected?: boolean;
  disabled?: boolean;
  removeTestId?: string;
  testId?: string;
  className?: string;
}) {
  const base = cn(
    "inline-flex max-w-full items-center gap-1 break-all rounded-full px-2 py-0.5 text-10",
    selected ? "bg-inverse font-medium text-inverse-foreground" : "bg-muted text-muted-foreground",
    className,
  );
  if (onClick !== undefined && onRemove !== undefined) {
    return (
      <span className={base} data-testid={testId}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          title={filterTitle}
          data-testid={filterTestId}
          className="truncate underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`移除标签 ${children}`}
          data-testid={removeTestId}
          className="rounded-full text-muted-foreground transition-colors duration-fast hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"
        >
          ×
        </button>
      </span>
    );
  }
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        data-testid={testId}
        className={cn(
          base,
          "transition-colors duration-fast hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
          selected && "hover:bg-inverse",
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={base} data-testid={testId}>
      {children}
      {onRemove !== undefined ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`移除标签 ${children}`}
          data-testid={removeTestId}
          className="rounded-full text-muted-foreground transition-colors duration-fast hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
