/**
 * WorkspaceX 官方品牌 logo（2026-09-03 人类直接指令，附件为原图）——描摹版矢量重绘：
 * 粗体圆角无衬线 "Workspace" 字标（品牌粉）+ 四瓣渐变（粉→橙）"X" 图形标。
 *
 * ⚠ 这是**矢量描摹**，不是原图切图——人类附件是一张位图截图，本仓不内嵌位图资产
 *   （体积、无法随主题/尺寸缩放）；改用可缩放 SVG 复刻同一套形状与配色，视觉上与
 *   原图一致，且能在任意尺寸（图标栏 20px～落地页大图）下保持清晰。
 * ⚠ 纯展示组件，不接任何交互——用它的地方（`SidebarBrandHeader` 等）各自决定是否
 *   包一层可点击容器，这里不越权替调用方决定。
 */
"use client";
import * as React from "react";

export function WorkspaceXWordmark({ className }: { className?: string }): JSX.Element {
  const gradientId = React.useId();
  return (
    <svg
      viewBox="0 0 220 48"
      role="img"
      aria-label="WorkspaceX"
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF7A18" />
          <stop offset="55%" stopColor="#FF2D78" />
          <stop offset="100%" stopColor="#E0116F" />
        </linearGradient>
      </defs>
      <text
        x="0"
        y="34"
        fontFamily="ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif"
        fontWeight="800"
        fontSize="34"
        fill="#F0136B"
        letterSpacing="-0.5"
      >
        Workspace
      </text>
      {/* 四瓣旋风状 "X" 图形标——四个圆角三角瓣绕中心点旋转拼成，同原图的动感 X。 */}
      <g transform="translate(197, 24)">
        <path d="M0,0 C6,-3 11,-9 11,-16 C11,-19 8.5,-21 6,-19 C0,-15 -2,-6 0,0 Z" fill={`url(#${gradientId})`} />
        <path d="M0,0 C3,6 9,11 16,11 C19,11 21,8.5 19,6 C15,0 6,-2 0,0 Z" fill={`url(#${gradientId})`} />
        <path d="M0,0 C-6,3 -11,9 -11,16 C-11,19 -8.5,21 -6,19 C0,15 2,6 0,0 Z" fill={`url(#${gradientId})`} />
        <path d="M0,0 C-3,-6 -9,-11 -16,-11 C-19,-11 -21,-8.5 -19,-6 C-15,0 -6,2 0,0 Z" fill={`url(#${gradientId})`} />
      </g>
    </svg>
  );
}
