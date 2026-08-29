import * as React from "react";
import Link from "next/link";
import { PlanRunProgress } from "@/components/plan-control/plan-run-progress";
import { PlanRunCostBar } from "@/components/plan-control/plan-run-cost-bar";
import {
  COST_SCENES, COST_SCENE_LABEL, resolveCostScene, costSceneData,
} from "@/lib/mock/plan-run-cost";

/**
 * Phase 14 · 需求 1（Run 级成本/预算追踪条）UI 先行原型入口 —— ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 纯前端 mock，**不接后端**。走真实的 `PlanRunCostBar` 组件，吃 mock 的 `RunCostView`。
 *   为证明「与现有进度条同一套设计语言、且挂在它紧邻处」，本页把真实的 `PlanRunProgress`
 *   一并铺在成本条上方——人类核对两条卡片是否浑然一体。
 *
 * query（预览手段）：?scene= default | loading | empty | invalid | dep-failed | denied
 *   | success | warning | over  —— 顶部一排场景切换 pill。前七个覆盖七态，warning/over
 *   是「逼近/超支」的额外色调档，一并铺出来供人类核对红黄阈值。
 */
export default function PlanRunCostPreviewPage({
  searchParams,
}: {
  searchParams: { scene?: string };
}) {
  const scene = resolveCostScene(searchParams.scene);
  const { status, view, errorMessage } = costSceneData(scene);

  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <nav
        className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3"
        data-testid="plan-run-cost-scene-nav"
      >
        <span className="mr-1 text-11 font-medium text-muted-foreground">界面态</span>
        {COST_SCENES.map((s) => {
          const active = s === scene;
          return (
            <Link
              key={s}
              href={`/preview/plan-run-cost?scene=${s}`}
              data-testid={`plan-run-cost-scene-${s}`}
              data-active={active}
              className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-base ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-card-foreground hover:bg-muted"
              }`}
            >
              {COST_SCENE_LABEL[s]}
            </Link>
          );
        })}
      </nav>

      <div
        className="mx-auto flex max-w-xl flex-col gap-2 px-4 py-6"
        data-testid="plan-run-cost-preview"
      >
        <p className="text-11 text-muted-foreground">
          需求 1 原型 · 纯前端 mock（不接后端）· 成本条挂在 <code>plan-run-progress</code> 紧邻处，
          与其同一套 <code>Card</code> + <code>Progress</code> 设计语言
        </p>

        {/* 上：真实的执行进度条（既有组件，证明设计语言一致）。 */}
        <PlanRunProgress
          currentStepLabel="按月聚合华东区 Q3 销售额"
          stepIndex={3}
          stepTotal={5}
          elapsedMs={196_000}
          isPaused={false}
        />

        {/* 下：本次要签的成本条。 */}
        <PlanRunCostBar status={status} view={view} errorMessage={errorMessage} />

        <p className="text-10 text-muted-foreground">
          提示：切换顶部场景核对七态 + 逼近/超支色调。成本条只做「看得到花了多少」，
          按需求边界<b>不做</b>超预算自动暂停/拦截。
        </p>
      </div>
    </main>
  );
}
