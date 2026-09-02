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
 * ⚠ `lib/mock/plan-control.ts` 的 `PlanGate.reason` 是给人看的一句话
 * （"这是一个多步…"），契约 `PlanGateDecision.reason` 是封闭枚举（UC-8 判定码，
 * 不是文案）——两者不是同一件事。`plan-confirm-gate.tsx` 目前**直接把这个枚举码
 * 当文案渲染给用户**（`{gate.reason}`），没有一层"枚举→中文"的映射——这是一个
 * 真实存在、但不在本轮范围内的独立缺口（本轮只做 token/视觉，不改文案/业务
 * 逻辑）。这里为了让预览截图仍然可读，用类型断言塞一句人话，不代表生产环境
 * 会显示这句话——生产环境现在显示的是字面 "multi-step"。
 */
const gate = { required: GATE_REQUIRED.required, reason: GATE_REQUIRED.reason } as unknown as PlanGateDecision;

export default function PlanControlLivePreviewPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 bg-background p-6">
      <PlanPanelReadOnly steps={steps} />
      <PlanConfirmGate gate={gate} onConfirmRun={() => {}} onContinueEditing={() => {}} />
    </div>
  );
}
