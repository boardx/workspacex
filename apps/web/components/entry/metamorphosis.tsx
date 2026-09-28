"use client";
import * as React from "react";
import { BUTTERFLY_PATH } from "@/components/chat/run-progress-butterfly";
import { cn } from "@/lib/utils";

/**
 * 登录页品牌栏的「蜕变」动画（2026-09-28 人类直接交办：加一个 butterfly 动画来展示人的
 * transformation）。一个 9s 循环讲三段：
 *
 *   01 结茧 —— 悬在枝头的茧轻轻摇晃（积累）；
 *   02 破茧 —— 茧收缩消失，一圈光晕散开，蝴蝶从中心展开；
 *   03 展翅 —— 蝴蝶边扑翼边向右上方飞离，淡出后循环。
 *
 * ## 约束
 *   · 蝴蝶图形复用 `run-progress-butterfly.tsx` 的 `BUTTERFLY_PATH`，不另画一份；
 *     扑翼复用既有 `animate-butterfly-flap`。
 *   · 纯 CSS：keyframes 只在 `tailwind.config.ts` 定义一处，各段共用 9s 周期、靠百分比
 *     对齐，不写 JS 计时器。
 *   · 颜色走 `--brand` / `--brand-warm` token（取自官方 logo），渐变 stop 用 `style`
 *     读变量，不写字面量。
 *   · `prefers-reduced-motion: reduce` 下全部 `motion-reduce:animate-none`，静止为「已展翅」
 *     的蝴蝶 + 三段文案全亮——不动也能读懂。
 *   · 纯装饰图形 `aria-hidden`；三段文案是真实文本，屏幕阅读器按顺序读到。
 */
const STAGES = [
  { no: "01", title: "结茧", body: "积累经验与知识", delay: "" },
  { no: "02", title: "破茧", body: "与 AI 团队协作", delay: "[animation-delay:3s]" },
  { no: "03", title: "展翅", body: "释放每个人的创造力", delay: "[animation-delay:6s]" },
] as const;

/** 让 CSS transform-origin 相对元素自身包围盒，而不是整张 SVG 画布。 */
const FILL_BOX: React.CSSProperties = { transformBox: "fill-box" };

export function Metamorphosis({ className }: { className?: string }) {
  const id = React.useId().replace(/:/g, "");
  const wing = `meta-wing-${id}`;
  const cocoon = `meta-cocoon-${id}`;

  return (
    <div className={cn("flex flex-col gap-5", className)} data-testid="auth-metamorphosis">
      <svg viewBox="0 0 240 150" aria-hidden className="h-48 w-full max-w-sm overflow-visible">
        <defs>
          <linearGradient id={wing} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "hsl(var(--brand-warm))" }} />
            <stop offset="1" style={{ stopColor: "hsl(var(--brand))" }} />
          </linearGradient>
          <linearGradient id={cocoon} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "hsl(var(--brand-warm))", stopOpacity: 0.55 }} />
            <stop offset="1" style={{ stopColor: "hsl(var(--brand))", stopOpacity: 0.75 }} />
          </linearGradient>
        </defs>

        {/* 枝头 */}
        <path
          d="M40 22 C 90 14, 150 30, 200 18"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className="stroke-border"
        />

        {/* 01 茧：挂点在上端，绕挂点摇晃 */}
        <g style={FILL_BOX} className="origin-top opacity-0 animate-meta-chrysalis motion-reduce:animate-none">
          <path d="M120 22 V 36" strokeWidth="1.5" className="stroke-muted-foreground" />
          <path
            d="M120 36 C 134 40, 138 62, 131 84 C 127 96, 113 96, 109 84 C 102 62, 106 40, 120 36 Z"
            fill={`url(#${cocoon})`}
          />
          <path
            d="M110 56 Q 120 60 130 56 M108 70 Q 120 74 132 70 M111 84 Q 120 87 129 84"
            fill="none"
            strokeWidth="1"
            strokeLinecap="round"
            className="stroke-card"
          />
        </g>

        {/* 02 破茧光晕 */}
        <circle
          cx="120"
          cy="72"
          r="34"
          fill="none"
          strokeWidth="1.5"
          stroke={`url(#${wing})`}
          style={FILL_BOX} className="origin-center opacity-0 animate-meta-burst motion-reduce:animate-none"
        />

        {/* 03 蝴蝶：外层定位（SVG 属性），中层飞行轨迹，内层扑翼 */}
        <g transform="translate(78 30) scale(3.5)">
          <g style={FILL_BOX} className="origin-center animate-meta-butterfly motion-reduce:animate-none">
            <g style={FILL_BOX} className="origin-center animate-butterfly-flap motion-reduce:animate-none">
              <path d={BUTTERFLY_PATH} fill={`url(#${wing})`} />
            </g>
          </g>
        </g>
      </svg>

      <ol className="grid grid-cols-3 gap-4">
        {STAGES.map((s) => (
          <li key={s.no} className="flex flex-col gap-2">
            <span className="h-0.5 w-full overflow-hidden rounded-full bg-border">
              <span
                className={cn(
                  "block h-full w-full origin-left scale-x-0 bg-brand animate-meta-step-bar motion-reduce:hidden",
                  s.delay,
                )}
              />
            </span>
            <span className={cn("flex flex-col gap-0.5 animate-meta-step motion-reduce:animate-none", s.delay)}>
              <span className="text-11 font-medium text-muted-foreground">{s.no}</span>
              <span className="text-13 font-semibold">{s.title}</span>
              <span className="text-11 text-muted-foreground">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
