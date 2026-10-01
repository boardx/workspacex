"use client";
import * as React from "react";
import { BUTTERFLY_PATH } from "@/components/chat/run-progress-butterfly";
import { cn } from "@/lib/utils";

/**
 * 登录页品牌栏的「蜕变」动画（2026-09-28 人类交办；2026-09-30 人类反馈「视觉不高科技、
 * 不自然」后重做）。一个 9s 循环讲三段，画面是**知识粒子汇聚成蝴蝶**，而不是卡通的茧：
 *
 *   01 结茧（积累）—— 散落的光点从四周浮现（经验与知识）；
 *   02 破茧（协作）—— 光点被收拢到蝴蝶轮廓的节点上，轮廓线沿路径描出；
 *   03 展翅（释放）—— 轮廓填充成渐变蝴蝶，柔光亮起、慢速扇翅，随后淡出循环。
 *
 * 背景是一层向中心聚拢的点阵 + 一圈缓慢旋转的虚线环，给「仪表盘」式的科技质感，
 * 但都是低对比的装饰，不抢文案。
 *
 * ## 约束
 *   · 蝴蝶图形复用 `run-progress-butterfly.tsx` 的 `BUTTERFLY_PATH`，不另画一份。
 *   · 纯 CSS：keyframes 只在 `tailwind.config.ts` 定义一处，各层共用 9s 周期、靠百分比
 *     对齐，不写 JS 计时器；粒子起点用 CSS 变量 `--dx/--dy` 传入，同一段 keyframes 复用。
 *   · 颜色走 `--brand` / `--brand-warm` token（取自官方 logo），渐变 stop 用 `style`
 *     读变量，不写字面量。
 *   · `prefers-reduced-motion: reduce` 下动画层全部 `motion-reduce:animate-none|hidden`，
 *     静止为「已展翅」的蝴蝶 + 三段文案全亮——不动也能读懂。
 *   · 纯装饰图形 `aria-hidden`；三段文案是真实文本，屏幕阅读器按顺序读到。
 */
const STAGES = [
  { no: "01", title: "结茧", body: "积累经验与知识", delay: "" },
  { no: "02", title: "破茧", body: "与 AI 团队协作", delay: "[animation-delay:3s]" },
  { no: "03", title: "展翅", body: "释放每个人的创造力", delay: "[animation-delay:6s]" },
] as const;

/** 让 CSS transform-origin 相对元素自身包围盒，而不是整张 SVG 画布。 */
const FILL_BOX: React.CSSProperties = { transformBox: "fill-box" };

/**
 * 粒子的落点（蝴蝶 24×24 局部坐标里的轮廓节点：翅尖 / 翅根 / 身体两端）与散开的起点偏移。
 * 起点偏移是手写的固定值（不用 Math.random——SSR 与客户端要一致，避免水合不匹配）。
 */
const PARTICLES: ReadonlyArray<{ x: number; y: number; dx: number; dy: number; d: number }> = [
  { x: 21.4, y: 6.9, dx: 7, dy: -8, d: 0 },
  { x: 16.6, y: 5.6, dx: 5, dy: -10, d: 0.2 },
  { x: 12.8, y: 11.4, dx: 9, dy: 2, d: 0.1 },
  { x: 19.6, y: 10.8, dx: 10, dy: -3, d: 0.35 },
  { x: 18.3, y: 17.4, dx: 8, dy: 9, d: 0.15 },
  { x: 15, y: 18.4, dx: 4, dy: 11, d: 0.3 },
  { x: 13.4, y: 14.6, dx: 11, dy: 6, d: 0.05 },
  { x: 12, y: 9.6, dx: 1, dy: -11, d: 0.25 },
  { x: 2.6, y: 6.9, dx: -7, dy: -8, d: 0.1 },
  { x: 7.4, y: 5.6, dx: -5, dy: -10, d: 0.3 },
  { x: 11.2, y: 11.4, dx: -9, dy: 2, d: 0.2 },
  { x: 4.4, y: 10.8, dx: -10, dy: -3, d: 0 },
  { x: 5.7, y: 17.4, dx: -8, dy: 9, d: 0.25 },
  { x: 9, y: 18.4, dx: -4, dy: 11, d: 0.05 },
  { x: 10.6, y: 14.6, dx: -11, dy: 6, d: 0.35 },
  { x: 12, y: 15.4, dx: -1, dy: 11, d: 0.15 },
];

/** 背景点阵：离中心越远越淡。确定性生成（无随机），SSR/客户端一致。 */
const GRID_DOTS = (() => {
  const dots: Array<{ x: number; y: number; o: number }> = [];
  for (let gx = 0; gx < 17; gx += 1) {
    for (let gy = 0; gy < 11; gy += 1) {
      const x = 20 + gx * 17.5;
      const y = 15 + gy * 18;
      const dist = Math.hypot((x - 160) / 150, (y - 105) / 95);
      const o = Math.max(0, 0.5 - dist * 0.45);
      if (o > 0.04) dots.push({ x, y, o: Number(o.toFixed(2)) });
    }
  }
  return dots;
})();

export function Metamorphosis({ className }: { className?: string }) {
  const id = React.useId().replace(/:/g, "");
  const wing = `meta-wing-${id}`;
  const glow = `meta-glow-${id}`;

  return (
    <div className={cn("flex flex-col gap-5", className)} data-testid="auth-metamorphosis">
      <svg viewBox="0 0 320 210" aria-hidden className="h-44 w-full max-w-sm overflow-visible">
        <defs>
          <linearGradient id={wing} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "hsl(var(--brand-warm))" }} />
            <stop offset="1" style={{ stopColor: "hsl(var(--brand))" }} />
          </linearGradient>
          <radialGradient id={glow}>
            <stop offset="0" style={{ stopColor: "hsl(var(--brand-warm))", stopOpacity: 0.5 }} />
            <stop offset="1" style={{ stopColor: "hsl(var(--brand))", stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        {/* 点阵背景：向中心聚拢、越远越淡 */}
        <g className="fill-muted-foreground">
          {GRID_DOTS.map((d) => (
            <circle key={`${String(d.x)}-${String(d.y)}`} cx={d.x} cy={d.y} r="1" opacity={d.o} />
          ))}
        </g>

        {/* 缓慢旋转的虚线环（仪表感） */}
        <circle
          cx="160"
          cy="105"
          r="86"
          fill="none"
          strokeWidth="1"
          strokeDasharray="1.5 7"
          strokeLinecap="round"
          style={FILL_BOX}
          className="origin-center stroke-muted-foreground opacity-60 animate-meta-orbit motion-reduce:animate-none"
        />
        <circle cx="160" cy="105" r="62" fill="none" strokeWidth="0.75" className="stroke-border opacity-70" />

        {/* 柔光：展翅阶段亮起 */}
        <circle
          cx="160"
          cy="105"
          r="74"
          fill={`url(#${glow})`}
          style={FILL_BOX}
          className="origin-center opacity-40 animate-meta-glow motion-reduce:animate-none"
        />

        {/* 蝴蝶：24×24 局部坐标 → 居中放大 7 倍 */}
        <g transform="translate(160 105) scale(7) translate(-12 -12.5)">
          {/* 02 轮廓线：沿路径描出 */}
          <path
            d={BUTTERFLY_PATH}
            pathLength={1}
            fill="none"
            stroke={`url(#${wing})`}
            strokeWidth="0.16"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="opacity-0 animate-meta-draw motion-reduce:hidden"
            style={{ strokeDasharray: 1 }}
          />

          {/* 03 填充蝴蝶 + 慢速扇翅 */}
          <g style={FILL_BOX} className="origin-center animate-meta-fill motion-reduce:animate-none">
            <g style={FILL_BOX} className="origin-center animate-meta-wing motion-reduce:animate-none">
              <path d={BUTTERFLY_PATH} fill={`url(#${wing})`} />
            </g>
          </g>

          {/* 01→02 粒子：从四周汇聚到轮廓节点，到位后淡出 */}
          {PARTICLES.map((p) => (
            <circle
              key={`${String(p.x)}-${String(p.y)}`}
              cx={p.x}
              cy={p.y}
              r="0.26"
              style={
                {
                  ...FILL_BOX,
                  "--dx": `${String(p.dx)}px`,
                  "--dy": `${String(p.dy)}px`,
                  animationDelay: `${String(p.d)}s`,
                  fill: "hsl(var(--brand))",
                } as React.CSSProperties
              }
              className="origin-center opacity-0 animate-meta-particle motion-reduce:hidden"
            />
          ))}
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
