import { redirect } from "next/navigation";

/**
 * ⚠ 已退役（2026-07-30）——推演画布的**现行**实现是 v2 束 `/canvas`（canvas 束，
 * 三栏 + 结构性冲突裁决 + AI 落笔回退；ui-material-map.json 声明目录 canvas-v2）。
 *
 * 本路由（旧「Studio 原型」骨架屏，单栏 825px，`components/studio/prototype-screen`）
 * 与 `/canvas` 覆盖同一 UC 域（07-canvas），是同一概念的两套实现并存。
 * 收敛为单一实现：本路由永久重定向到 `/canvas`，导航「画布」项已指向 `/canvas`。
 *
 * 组件 `components/studio/prototype-screen` 保留留痕（不删），但不再有入口。
 */
export default function DeprecatedStudioPrototypePage() {
  redirect("/canvas");
}
