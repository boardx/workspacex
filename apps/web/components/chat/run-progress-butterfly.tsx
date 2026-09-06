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
 *   · 颜色走 token：`fill="currentColor"` + `text-success`（`--success`，青绿"在场"色；
 *     2026-09-06 人类要求换色——原 `text-ai` 紫与 AI 气泡 tint 同色相，蝴蝶淹在里面，
 *     青绿在紫/灰底上都跳得出来，且 `--success` 本就是"在场/进行中"语义）。
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
 * 2026-09-06 人类实测（配合 /chat 5 处 UI 修正）：原剪影写实、线条硬，要"更抽象、更简化、
 * 有艺术感"。现在是**四片笔触式花瓣 + 一线身体**：翅膀不再贴着身体，与中轴留一条细缝，
 * 像水墨里两笔甩出去的翼；上翅是拉长的泪滴、下翅是收拢的小瓣，整体轮廓只靠曲线，没有
 * 一处直角。仍是单条 path 的 5 段 `M…Z`（身体 + 上下两对翅膀，关于 x=12 镜像），
 * `scaleX` 收放的开合语义不变。
 *   1. 身体：中轴上一线（两端收圆）。
 *   2/3. 上翅：向外上方甩出去的泪滴。
 *   4/5. 下翅：向外下方收拢的小瓣。
 */
export const BUTTERFLY_PATH =
  "M11.7 9.6C11.7 9.2 12.3 9.2 12.3 9.6V15.4C12.3 15.8 11.7 15.8 11.7 15.4Z" +
  "M11.2 11.4C8.6 6.2 3.6 4.4 2.6 6.9C1.7 9.4 6.2 12.1 11.2 11.4Z" +
  "M12.8 11.4C15.4 6.2 20.4 4.4 21.4 6.9C22.3 9.4 17.8 12.1 12.8 11.4Z" +
  "M11.2 12.7C7.4 12.4 4.6 14.9 5.7 17.4C6.7 19.6 10.4 17.9 11.2 12.7Z" +
  "M12.8 12.7C16.6 12.4 19.4 14.9 18.3 17.4C17.3 19.6 13.6 17.9 12.8 12.7Z";

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
        "h-7 w-7 shrink-0 origin-center text-success motion-reduce:animate-none",
        MOTION_CLASS[motion],
        className,
      )}
    >
      <path d={BUTTERFLY_PATH} />
    </svg>
  );
}
