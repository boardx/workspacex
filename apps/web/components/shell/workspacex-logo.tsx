/**
 * WorkspaceX 官方品牌 logo（issue #2661 修复，2026-09-04）：
 * 直接渲染人类指定的官方位图 `apps/web/workspacex.png`（已复制到
 * `apps/web/public/workspacex-logo.png`，由 Next.js 按原路径伺服到 `/workspacex-logo.png`），
 * 不再用手工描摹的 SVG 近似形状/配色。
 *
 * ⚠ 2026-09-03 曾用可缩放 SVG「描摹版」替代（理由是不想内嵌位图资产），但描摹结果与
 *   官方图在字体、"X" 图形标形状（四瓣旋风尖角 vs. 官方的四瓣圆润水滴）上都对不上——
 *   这正是 issue #2661 报告的问题："workspacex logo 未更新为指定图片地址"。
 *   人类已明确指定这张位图为权威 logo，改用它本身而不是再造一版近似矢量。
 * ⚠ 纯展示组件，不接任何交互——用它的地方（`SidebarBrandHeader` 等）各自决定是否
 *   包一层可点击容器，这里不越权替调用方决定。
 */
"use client";
import * as React from "react";

export function WorkspaceXWordmark({ className }: { className?: string }): JSX.Element {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 固定静态资产，无需 next/image 的响应式优化
    <img src="/workspacex-logo.png" alt="WorkspaceX" className={className} />
  );
}
