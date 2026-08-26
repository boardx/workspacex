import * as React from "react";
import { PlanControlScreen } from "@/components/plan-control/plan-control-screens";
import { PLAN_CONTROL_SCREENS, type PlanControlScreenKey } from "@/lib/mock/plan-control";

/**
 * plan-control 契约束（TW-P0-3 可编辑计划 + 六态工作流）UI 先行原型入口。
 * ADR-023 签核第 ① 件材料（G-01～G-08）。纯 mock，不接后端。
 *
 * query：?screen= g01 | g02 | g03 | g04 | g05 | g06 | g07 | g08
 * ⚠ 本束不新建路由；这些区域生产环境落在 /chat 三栏骨架内（宿主屏归 chat 束）。
 *   此预览页只为逐屏签核把四个区域单独铺出来。
 */
const KEYS = PLAN_CONTROL_SCREENS.map((s) => s.key) as PlanControlScreenKey[];

function resolveScreen(raw: string | undefined): PlanControlScreenKey {
  return KEYS.includes(raw as PlanControlScreenKey) ? (raw as PlanControlScreenKey) : "g01";
}

export default function PlanControlPreviewPage({
  searchParams,
}: {
  searchParams: { screen?: string };
}) {
  const screen = resolveScreen(searchParams.screen);
  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <PlanControlScreen screen={screen} />
    </main>
  );
}
