"use client";
import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, readCurrentTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * 浅色/深色切换 —— 手写极简 toggle，不引入 `next-themes`（不是现有依赖）。
 *
 * 真正决定「刷新后是哪个」的是 `app/layout.tsx` 里的内联阻塞脚本（早于 hydration），
 * 这里首帧读 DOM 上已经生效的 `.dark` class 即可，不需要自己再猜一遍存储值，
 * 也避免了「组件状态」与「阻塞脚本已经做的决定」打架。
 */
export function ThemeToggle({
  testId, className, role = "menuitem",
}: { testId: string; className?: string; role?: "menuitem" | undefined }) {
  // 初始 null：避免 SSR（服务端不知道 localStorage）与阻塞脚本已经设好的 DOM 状态不一致导致的
  // hydration 告警——首帧渲染一个中性态，挂载后立刻用真实 DOM class 同步。
  const [mode, setMode] = React.useState<ThemeMode | null>(null);

  React.useEffect(() => {
    setMode(readCurrentTheme());
  }, []);

  const current = mode ?? "light";

  function toggle() {
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    applyTheme(next);
    setMode(next);
  }

  return (
    <button
      type="button"
      role={role}
      data-testid={testId}
      aria-pressed={mode === null ? undefined : current === "dark"}
      onClick={toggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 text-card-foreground",
        "transition-colors duration-200 hover:bg-muted",
        className,
      )}
    >
      {/* 文案是「点了会发生什么」（动作），不是「现在是什么状态」——
          复核实测过反过来的写法（当前浅色态显示"浅色模式"，点击却切到深色）会让人以为点击无效或
          语义相反。当前深色 ⇒ 提供"切换到浅色"的动作；当前浅色 ⇒ 提供"切换到深色"的动作。 */}
      {current === "dark"
        ? <Sun aria-hidden className="h-3.5 w-3.5" />
        : <Moon aria-hidden className="h-3.5 w-3.5" />}
      {current === "dark" ? "切换到浅色模式" : "切换到深色模式"}
    </button>
  );
}
