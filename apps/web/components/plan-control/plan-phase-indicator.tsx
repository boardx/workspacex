"use client";
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLAN_PHASE_LABEL_ZH, type PlanPhase } from "@repo/contracts/plan-control";

/**
 * F977 —— S1 六态指示器（`ui.md` 判据一）。
 *
 * ⚠ `phase` 是唯一输入，来自 `getPlanLedger.phase`（UC-1，服务端派生 I-7）。
 * 本组件**不重算** phase，也不维护第二份中文文案映射表——`PLAN_PHASE_LABEL_ZH`
 * 是单一事实源（`packages/contracts/src/plan-control.ts`，domain.md 一·5 的警告：
 * 本仓已因文案与枚举值分开维护漂移五次）。
 *
 * 判据一「当前态可读不靠颜色」：同时提供
 *   ① 文本高亮（当前态的文案本身加粗/换色，不是仅描边/仅色块）
 *   ② `aria-current="step"`（辅助技术能读出「当前所在这一步」）
 *   ③ `role="status"` 播报当前态中文文案（screen reader 主动播报，不需要用户去找）
 * 去掉 CSS 后仍能靠 DOM 结构（`aria-current` + `sr-only` 文本）读出在哪一态。
 */
const PHASE_LINE: readonly PlanPhase[] = ["preparing", "planning", "executing", "approving", "done"];

export const PLAN_PHASE_INDICATOR_TESTID = "chat-task-workbench-phase-indicator";

export interface PlanPhaseIndicatorProps {
  readonly phase: PlanPhase;
}

export function PlanPhaseIndicator({ phase }: PlanPhaseIndicatorProps): React.JSX.Element {
  if (phase === "failed") {
    return (
      <div
        data-testid={PLAN_PHASE_INDICATOR_TESTID}
        data-phase="failed"
        role="status"
        className="flex items-center gap-2 rounded-control border border-destructive/40 bg-destructive/5 px-3 py-1.5"
      >
        <AlertTriangle aria-hidden className="h-4 w-4 text-destructive" />
        <span className="text-13 font-medium text-destructive">{PLAN_PHASE_LABEL_ZH.failed}</span>
      </div>
    );
  }

  return (
    <div
      data-testid={PLAN_PHASE_INDICATOR_TESTID}
      data-phase={phase}
      className="flex items-center gap-1 rounded-control border border-border-subtle bg-panel px-3 py-1.5"
    >
      {/* ③ role=status 播报：不依赖用户去找当前处于哪一态。 */}
      <span role="status" className="sr-only">当前处于「{PLAN_PHASE_LABEL_ZH[phase]}」阶段</span>
      {PHASE_LINE.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && <span aria-hidden className="text-11 text-muted-foreground">›</span>}
          <span
            // ② aria-current：辅助技术定位当前步骤。
            aria-current={p === phase ? "step" : undefined}
            className={cn(
              "rounded-control px-1.5 py-0.5 text-12 transition-colors duration-base",
              // ① 文本高亮：字重/配色变化，不只靠颜色色块。
              p === phase ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {PLAN_PHASE_LABEL_ZH[p]}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
