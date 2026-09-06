/**
 * issue #2785（2026-09-05 devapp 人类实测）—— 上一版刚把 /chat run 进度卡的
 * spinner 换成 X logo 呼吸动画（issue #2769 / PR #2772，`run-progress-x-mark.tsx`），
 * 人类看过截图后改主意：不要 X logo，要**蝴蝶（butterfly）主题**。这个文件顶替
 * `RunProgressXMark`，接线点、约束、testid 命名习惯照抄那一版（同一张进度卡，
 * 只换图形与动效，阶段文案/计时/45s longrun 提示一个字不动）。
 *
 * ## 形态
 *
 * 单个 `<svg>`、单条 `<path>`（`fill="currentColor"`）：一段细身体 + 上下各一对
 * 翅膀共 5 个子路径（`M…Z`）合成一个 `d`，与 X 标一样"整枚图形是一条 path"，不
 * 另起多个可独立摆动的部件——动效钉在这一个元素上，不是"翅膀单独摆、身体不动"
 * 那种多元素编排（那需要多个 transform-origin，实现和验证都会重一档）。
 *
 * ## 动效约束（issue 原话：一个元素、一段 keyframes，CSS-only，reduced-motion 降级静态）
 *
 *   · keyframes 定义在 `tailwind.config.ts`（`butterfly-flap` / `butterfly-drift`，
 *     与既有 `x-breathe`/`x-turn` 同一处，不引任何动画库、不写 JS 计时）。
 *   · 方案 A `flap`（默认）：整枚图形沿水平方向 `scaleX` 收放，`transform-origin`
 *     钉在图形几何中心（身体所在的竖线）——收缩时两侧翅膀向中线靠拢，视觉上就是
 *     "翅膀开合"，身体本身因为紧贴中轴，形变可忽略。配一点点 `opacity` 起伏（翅膀
 *     合拢时略暗，如同侧对光线），呼应 `x-breathe` 已经用过的"transform+opacity"
 *     搭配，不是新发明的组合。
 *   · 方案 B `drift`：整枚图形 `translateY` 小幅浮动 + 轻微 `rotate`，模拟"飞行时
 *     忽高忽低、左右打晃"，issue 原话"上下浮动"的另一种读法，供人类挑选对比。
 *   · `motion-reduce:animate-none`：与 `x-mark` 同一套降级写法，`prefers-reduced-motion:
 *     reduce` 下纯 CSS 钉死为静态蝴蝶形，不读 `matchMedia`。
 *   · 颜色走 token：`fill="currentColor"` + `text-ai`（`--ai`，AI 在场色），与 X 标一致，
 *     不为蝴蝶另挑颜色（同一张卡片的"AI 正在干活"信号，色语义不因图形换了而变）。
 *   · 尺寸走 Tailwind 刻度（默认 `h-3 w-3`，与被替换的 `RunProgressXMark` 同尺寸），
 *     调用方可覆盖。
 *
 * 两个候选方案对比截图见 issue #2785 评论；定稿后若人类选了非默认方案，只需把
 * `copilotkit-v2-panel-body.tsx` 里的 `<RunProgressButterfly />` 加一个
 * `motion="drift"` prop，不用碰这个文件本身。
 *
 * ## issue #2837（2026-09-06 devapp 人类实测）—— 放大 + 合成动效
 *
 * 长任务（300+ 秒）里被盯着看很久，人类原话「有点丑，要大一点」：12px 太小、单独
 * flap 显得机械。默认尺寸 `h-3 w-3` → `h-7 w-7`（28px），新增方案 C `fly`（默认）：
 * flap + drift **合成为同一段** keyframes（`butterfly-fly`，扑翼频率为上浮频率 2 倍），
 * 仍然是一个元素一段动画。`flap` / `drift` 保留供比对。
 *
 * 纯装饰：`aria-hidden`，可读文案在旁边的 `copilotkit-v2-thinking-phase` 上。
 */
"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 蝴蝶剪影（细身体 + 上大下小两对翅膀），单条 path 的 5 段 `M…Z`：
 *   1. 身体：贴中轴 x=12 的细竖条。
 *   2/3. 上翅（左右各一，较大，靠近身体上半段）。
 *   4/5. 下翅（左右各一，较小，靠近身体下半段）。
 * 左右两对翅膀互为镜像（关于 x=12 对称），`scaleX` 收放时两侧对称向中线收拢。
 */
export const BUTTERFLY_PATH =
  "M11.3 8C11.3 7.45 11.67 7 12 7C12.33 7 12.7 7.45 12.7 8V16C12.7 16.55 12.33 17 12 17C11.67 17 11.3 16.55 11.3 16V8Z" +
  "M11.6 8.5C9.5 6.5 5.5 6.7 4.3 9C3.3 11 4.8 13.3 7.3 13C9.3 12.7 11 11 11.6 10.2Z" +
  "M12.4 8.5C14.5 6.5 18.5 6.7 19.7 9C20.7 11 19.2 13.3 16.7 13C14.7 12.7 13 11 12.4 10.2Z" +
  "M11.6 11.8C10.2 11.1 7.8 11.3 6.8 13.1C6 14.6 7 16.3 9 16.1C10.3 16 11.3 14.1 11.6 13Z" +
  "M12.4 11.8C13.8 11.1 16.2 11.3 17.2 13.1C18 14.6 17 16.3 15 16.1C13.7 16 12.7 14.1 12.4 13Z";

export type RunProgressButterflyMotion = "flap" | "drift" | "fly";

const MOTION_CLASS: Record<RunProgressButterflyMotion, string> = {
  flap: "animate-butterfly-flap",
  drift: "animate-butterfly-drift",
  fly: "animate-butterfly-fly",
};

export function RunProgressButterfly({
  className,
  motion = "fly",
}: {
  className?: string;
  /**
   * 默认 `fly`（方案 C，issue #2837：扑翼 + 上浮合成一段）；`flap`（方案 A，只开合）与
   * `drift`（方案 B，只浮动+轻晃）保留供人类切换比对。
   */
  motion?: RunProgressButterflyMotion;
}): JSX.Element {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="currentColor"
      data-testid="copilotkit-v2-thinking-mark"
      data-motion={motion}
      className={cn(
        "h-7 w-7 shrink-0 origin-center text-ai motion-reduce:animate-none",
        MOTION_CLASS[motion],
        className,
      )}
    >
      <path d={BUTTERFLY_PATH} />
    </svg>
  );
}
