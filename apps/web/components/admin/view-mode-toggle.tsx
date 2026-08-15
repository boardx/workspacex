"use client";
import * as React from "react";
import { LayoutGrid, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 后台 entity 列表统一的「卡片 / 列表」视图切换（人类原话 2026-08-15：
 * 「左边保留后台菜单，右边列出卡片来表达当前的 entity 的列表，卡片也可以切换为列表」）。
 *
 * ⚠ 写这个文件前查过 `apps/web/components/admin/` 下有没有并行 agent（做「Agent 目录」的
 *   那条线）已经合并的共享组件——`git pull origin main` 之后仍未合并，故按人类给的最小
 *   规格自己实现，不等待。testid 规则固定为
 *   `admin-<module>-view-toggle-card` / `admin-<module>-view-toggle-list`，
 *   `module` 由调用方传入（如 `members` / `feedback` / `limits`）。
 *
 * 纯展示组件：视图模式的 state 由每个屏/tab 自己持有（不做跨屏持久化——三个屏各自
 * 的默认视图取决于原有 testid 是否已被既有测试断言，见各调用点注释）。
 */
export type EntityViewMode = "card" | "list";

export function ViewModeToggle({
  module,
  mode,
  onChange,
  className,
}: {
  /** 拼进 data-testid 的英文 slug，例如 "members" / "feedback" / "limits"。 */
  module: string;
  mode: EntityViewMode;
  onChange: (mode: EntityViewMode) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-md border border-border p-0.5${className ? ` ${className}` : ""}`}
      role="group"
      aria-label="切换卡片视图或列表视图"
      data-testid={`admin-${module}-view-toggle`}
    >
      <Button
        size="xs"
        variant={mode === "card" ? "primary" : "ghost"}
        aria-pressed={mode === "card"}
        onClick={() => onChange("card")}
        data-testid={`admin-${module}-view-toggle-card`}
      >
        <LayoutGrid aria-hidden className="h-3.5 w-3.5" />
        卡片
      </Button>
      <Button
        size="xs"
        variant={mode === "list" ? "primary" : "ghost"}
        aria-pressed={mode === "list"}
        onClick={() => onChange("list")}
        data-testid={`admin-${module}-view-toggle-list`}
      >
        <LayoutList aria-hidden className="h-3.5 w-3.5" />
        列表
      </Button>
    </div>
  );
}
