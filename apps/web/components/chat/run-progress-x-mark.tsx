/**
 * issue #2769（2026-09-05 devapp 人类实测）—— /chat run 进度卡的「正在回复… · 已用 N 秒」
 * 那一行，原来挂的是通用 `Loader2` spinner。人类要的是**一个最简单的、与 X logo 呼应**的
 * 小动画：形态从品牌图形标派生，不另起一套图形。
 *
 * ## 形态来源（不是新画的）
 *
 * 权威 logo 是位图 `public/workspacex-logo.png`（`workspacex-logo.tsx` 头注：人类指定，
 * 手工描摹的 SVG 已被 #2661 否决）。位图不能当 12px 行内图标用（缩到那个尺寸只剩一团色），
 * 所以这里只取它右侧的**图形标**：四瓣圆润水滴汇于一点成 X，右侧两瓣大、左侧两瓣小。
 * `d` 里四段 `M…Z` 就是这四瓣（尖端在中心 (12,12)，圆头朝外，按 ±45°/135°/225° 旋出），
 * 合成**一条 path**——整个标记就是一个 `<svg>` 元素，动画也只挂在它身上。
 *
 * ## 动效约束（issue 原话：一个元素、一段 keyframes、CSS-only、reduced-motion 降级静态）
 *
 *   · keyframes 定义在 `tailwind.config.ts`（`x-breathe`，与既有 `fade-in` 同一处），不引
 *     任何动画库、不写 JS 计时——"已用 N 秒" 的计时器在 `copilotkit-v2-run-progress.ts`，
 *     与这里无关，这里只负责"看得出还在动"。
 *   · `motion-reduce:animate-none`：`prefers-reduced-motion: reduce` 下纯 CSS 钉死为
 *     静态图形标（同 `message-entrance.tsx` 的做法，不读 `matchMedia`）。
 *   · 颜色走 token：`fill="currentColor"` + `text-ai`（`--ai`，AI 在场色）——进度卡就是
 *     "AI 正在干活"的在场信号，用这个语义色而不是硬编码 logo 的品红/橙渐变
 *     （`lint-design.sh` U5a 拦硬编码色；渐变色也没有对应 token，不为它新造一个）。
 *   · 尺寸走 Tailwind 刻度（默认 `h-3 w-3`，与被替换的 `Loader2` 同尺寸），调用方可覆盖。
 *
 * 备选方案 B（`x-turn`，整标慢速自转）同样只在 `tailwind.config.ts` 定义一段 keyframes，
 * 人类想换时把 `animate-x-breathe` 改成 `animate-x-turn` 即可——两个方案的对比截图见
 * issue #2769 评论。
 *
 * 纯装饰：`aria-hidden`，可读文案在旁边的 `copilotkit-v2-thinking-phase` 上。
 */
"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** 四瓣水滴 X 标（从 `public/workspacex-logo.png` 右侧图形标派生），单条 path。 */
export const X_MARK_PATH =
  "M12 12C12.47 8.66 13.39 6.51 14.62 5.28A2.9 2.9 0 1 1 18.72 9.38C17.49 10.61 15.34 11.53 12 12Z" +
  "M12 12C15.34 12.47 17.49 13.39 18.72 14.62A2.9 2.9 0 1 1 14.62 18.72C13.39 17.49 12.47 15.34 12 12Z" +
  "M12 12C11.6 14.57 10.67 16.44 9.74 17.37A2.2 2.2 0 1 1 6.63 14.26C7.56 13.33 9.43 12.4 12 12Z" +
  "M12 12C9.43 11.6 7.56 10.67 6.63 9.74A2.2 2.2 0 1 1 9.74 6.63C10.67 7.56 11.6 9.43 12 12Z";

export type RunProgressXMarkMotion = "breathe" | "turn";

export function RunProgressXMark({
  className,
  motion = "breathe",
}: {
  className?: string;
  /** 默认 `breathe`（方案 A）；`turn` 是方案 B，仅供人类切换比对。 */
  motion?: RunProgressXMarkMotion;
}): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="currentColor"
      data-testid="copilotkit-v2-thinking-mark"
      data-motion={motion}
      className={cn(
        "h-3 w-3 shrink-0 origin-center text-ai motion-reduce:animate-none",
        motion === "breathe" ? "animate-x-breathe" : "animate-x-turn",
        className,
      )}
    >
      <path d={X_MARK_PATH} />
    </svg>
  );
}
