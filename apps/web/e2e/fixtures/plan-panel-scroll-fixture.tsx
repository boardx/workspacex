/**
 * issue #3245② —— 用**真组件**（`PlanPanelReadOnly`）+ 宿主的**真滚动容器常量**
 * （`PLAN_CONTROL_SCROLLER_CLASS`）渲出计划面板的静态 DOM，供
 * `chat-plan-panel-scroll-geometry.spec.ts` 在真浏览器里量滚动。
 *
 * 步骤数由 argv[3] 给：长计划要能滚，短计划不许出现多余滚动条——两个方向各量一次。
 *
 * 用法：node --import tsx e2e/fixtures/plan-panel-scroll-fixture.tsx <html 路径> <步骤数>
 */
import * as React from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanStep } from "@repo/contracts/plan-control";
import { PlanPanelReadOnly } from "@/components/plan-control/plan-panel-readonly";
import { PLAN_CONTROL_SCROLLER_CLASS } from "@/components/chat/copilotkit-v2-plan-control";

const count = Number(process.argv[3] ?? 12);
const steps: PlanStep[] = Array.from({ length: count }, (_, i) => ({
  planStepId: `step-${i}`,
  content: `第 ${i + 1} 步：做一件需要一整行字才说得清楚的事情`,
  status: i < 3 ? "completed" : i === 3 ? "in_progress" : "pending",
  constraints: [],
}));

const markup = renderToStaticMarkup(
  // 宿主里计划面板所在的那一列（`copilotkit-v2-panel-body.tsx`，composer 上方）。
  <div className="mx-auto flex w-full min-w-0 max-w-3xl shrink-0 flex-col gap-3">
    <div data-testid="chat-task-workbench-plan-control" className={PLAN_CONTROL_SCROLLER_CLASS}>
      <div className="flex items-center gap-2">
        <button type="button" data-testid="chat-task-workbench-plan-collapse-toggle" className="text-13">
          执行计划 · 执行中 · 3/{count} 步已标记完成
        </button>
      </div>
      <PlanPanelReadOnly steps={steps} compact />
    </div>
  </div>,
);

writeFileSync(
  process.argv[2]!,
  `<html><head><link rel="stylesheet" href="out.css"></head><body style="margin:0">`
  + `<div style="height:100vh;display:flex;flex-direction:column;justify-content:flex-end">${markup}</div></body></html>`,
);
