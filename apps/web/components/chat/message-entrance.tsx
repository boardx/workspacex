"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 编排级动效：消息到达进场（F04；契约束 motion-microinteraction UC-2）。
 *
 * 时间线（不是单一线性过渡，两段有先后）：
 *   1. 内容先淡入 —— opacity 0→1，`duration-fast`（150ms）。
 *   2. 位移随后跟上 —— translateY 4px→0，`duration-base`（200ms），
 *      `delay-150` 起步（150ms，恰好等于 duration-fast，让位移在内容淡入
 *      「安顿下来」的那一刻接上，不是凭空发明的新数值——Tailwind 内置
 *      delay 刻度本就有 150/300，与 F03 的 fast/slow token 数值重合）。
 *
 * 「只在消息气泡首次出现时触发一次」（UC-2 HIGH_FREQUENCY_ARRIVAL）：
 *   动画由 mount 时机驱动（空依赖 useEffect），之后父组件传入的 children
 *   变化（如流式增量更新气泡文本）不会重新触发，因为 `MessageStream` 按
 *   消息 id 作为 React key——同一条消息的每次增量复用同一个组件实例，
 *   不会重新 mount。
 *
 * `prefers-reduced-motion: reduce`：用 Tailwind 内置 `motion-reduce:` 变体
 * （对应 CSS 媒体查询）直接把最终态钉死，不依赖 JS `matchMedia`——纯 CSS
 * 生效更早（首帧就是终态，不会有一闪而过的动画），系统运行时切换也能响应。
 */
export function MessageEntrance({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [entered, setEntered] = React.useState(false);

  React.useEffect(() => {
    // 下一个宏任务再翻转状态：保证浏览器先画出初始态（opacity-0/translate-y-1）
    // 再翻到终态，transition 才有起点可过渡；用 setTimeout(0) 而非
    // requestAnimationFrame，测试环境（jsdom）里更容易用 vi.advanceTimersByTime 驱动。
    const t = setTimeout(() => setEntered(true), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      data-testid={testId}
      data-motion-entered={entered ? "true" : "false"}
      className={cn(
        "transition-transform duration-base ease-base delay-150",
        "motion-reduce:transition-none motion-reduce:delay-0 motion-reduce:translate-y-0",
        entered ? "translate-y-0" : "translate-y-1",
        className,
      )}
    >
      <div
        data-testid={testId ? `${testId}-fade` : undefined}
        className={cn(
          "transition-opacity duration-fast ease-fast",
          "motion-reduce:transition-none motion-reduce:opacity-100",
          entered ? "opacity-100" : "opacity-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
