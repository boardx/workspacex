"use client";
import { PlanPanelReadOnly } from "@/components/plan-control/plan-panel-readonly";
import { PlanConfirmGate } from "@/components/plan-control/plan-confirm-gate";
import { PLAN_STEPS, GATE_REQUIRED } from "@/lib/mock/plan-control";
import type { PlanGateDecision, PlanStep } from "@repo/contracts/plan-control";

/**
 * issue #2476 —— 临时视觉核对页：渲染**真实**的 `PlanPanelReadOnly`/`PlanConfirmGate`
 * （不是 `plan-control-screens.tsx` 里那份独立的签核 mock 复刻），喂同一份既有
 * `lib/mock/plan-control.ts` 数据，只做字段名映射（mock 字段名故意与契约不同，
 * 见该文件头注）。纯本地核对用，不接后端、不进任何真实用户可达的路由链路。
 */
const steps: PlanStep[] = PLAN_STEPS.map((s) => ({
  planStepId: s.id,
  content: s.content,
  status: s.status,
  constraints: s.constraints.map((c) => ({
    constraintId: c.id,
    text: c.text,
    createdAt: new Date().toISOString(),
  })),
}));

/**
 * issue #2486 已收口：`lib/mock/plan-control.ts` 的 `PlanGate.reason` 现在就是契约
 * 的 `PlanGateReason` 枚举本身，"枚举 → 中文"这层映射落在契约的单一事实源
 * `PLAN_GATE_REASON_LABEL_ZH` 上，由 `PlanConfirmGate` 渲染。
 *
 * ⚠ 所以这里**不再需要** `as unknown as` 那道类型断言——当初那道断言是在往一个
 * 枚举字段里塞一句人话（mock 手写的文案与契约字段根本不是同一件事），它正是这个
 * 缺陷被发现的地方。形状现在真的对得上，就不该再用断言把它按下去。
 */
const gate: PlanGateDecision = { required: GATE_REQUIRED.required, reason: GATE_REQUIRED.reason };

export default function PlanControlLivePreviewPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 bg-background p-6">
      <PlanPanelReadOnly steps={steps} />
      <PlanConfirmGate gate={gate} onConfirmRun={() => {}} onContinueEditing={() => {}} />
    </div>
  );
}
