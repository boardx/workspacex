"use client";
import * as React from "react";
import { Coins, TriangleAlert, ShieldQuestion, WalletMinimal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Phase 14 · 需求 1 —— Run 级成本/预算追踪条。
 *
 * 挂在 `plan-run-progress.tsx`（S5 执行态进度）**紧邻处**，与它同一套设计语言：
 * `Card` + `CardContent`（py-3、flex-col gap-2）、同款 `Progress` 细条、同款图标+文案节奏。
 * 一眼看去是"进度条下面多了一条成本条"，不是另一套视觉。
 *
 * ## 数据来源（活体接线时）
 * 需求原文：成本按 token 用量 × 定价实时累加，分母复用**已有的组织配额策略**
 * （`limit-policy-tab.tsx` 那套），不重新发明一套预算体系；数据走同一条 run 账本管道
 * （`getPlanLedger` / `agent_run_steps` 延伸出成本字段）。本组件是**纯展示**：只把服务端
 * 派生好的 `RunCostView` 渲染出来，不在前端做定价乘法、不重算百分比（与 phase-indicator
 * 同一条 I-7 纪律）。
 *
 * ## 状态（七态齐备，uiux-standards §6）
 * loading / empty / invalid(err) 由本组件自渲染；ready 内部按预算占比分三档色调
 * （健康 primary / 偏高 warning / 逼近或超支 destructive）；`budget-unavailable`（依赖失败：
 * 组织配额策略未配置，拿不到分母）与 `denied`（无权限看组织预算）都**仍显示本轮 ¥ 成本**，
 * 只是把百分比那半降级——本轮花费是用户自己 run 的事实，不该因为看不到组织分母就整条消失。
 *
 * ## 边界（需求明确划走）
 * 只做"看得到花了多少"，**不做**超预算自动暂停/拦截（那是另一个 phase 的需求）。所以这里
 * 逼近/超支只用红色调 + 文案提示，不出现任何"已为你暂停"之类的动作按钮。
 */

export const PLAN_RUN_COST_TESTID = "chat-task-workbench-run-cost";
export const PLAN_RUN_COST_DETAIL_TESTID = "chat-task-workbench-run-cost-detail";

export type RunCostStatus =
  | "loading"
  | "ready"
  | "empty"
  | "invalid"
  | "budget-unavailable"
  | "denied";

export interface RunCostView {
  /** 本轮 run 累计模型调用成本（¥）。 */
  readonly runCostCny: number;
  /** 本月已用（含本轮），¥——预算占比的分子。 */
  readonly monthUsedCny: number;
  /** 本月预算分母（来自组织配额策略），¥。 */
  readonly monthBudgetCny: number;
  /** run 是否已终态：终态显示「已结算」，进行中显示「实时累计」。 */
  readonly settled: boolean;
}

export interface PlanRunCostBarProps {
  readonly status: RunCostStatus;
  readonly view: RunCostView | null;
  /** invalid 态的具体报错文案；缺省给一句兜底。 */
  readonly errorMessage?: string;
  readonly onOpenDetail?: () => void;
}

/** ¥ 金额展示：两位小数（模型调用成本常在角分量级，一位小数会把 ¥2.47 抹成 ¥2.5）。 */
export function formatCny(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

/** 预算占比 → 百分比数值（0–100+，允许 >100 表达超支）。分母非正时返回 null（无从计算）。 */
export function budgetPercent(view: RunCostView): number | null {
  if (!(view.monthBudgetCny > 0)) return null;
  return Math.round((view.monthUsedCny / view.monthBudgetCny) * 1000) / 10;
}

type Tone = "primary" | "warning" | "destructive";
function toneForPercent(pct: number): Tone {
  if (pct >= 90) return "destructive";
  if (pct >= 70) return "warning";
  return "primary";
}

/** 静态 token 映射——Tailwind JIT 需要看到完整类名，禁止运行时拼接色 token 类名（JIT 扫不到）。 */
const TONE_TEXT: Record<Tone, string> = {
  primary: "text-primary",
  warning: "text-warning",
  destructive: "text-destructive",
};

function CostShell({ children }: { children: React.ReactNode }) {
  return (
    <Card data-testid={PLAN_RUN_COST_TESTID}>
      <CardContent className="flex flex-col gap-2 py-3">{children}</CardContent>
    </Card>
  );
}

export function PlanRunCostBar({
  status, view, errorMessage, onOpenDetail,
}: PlanRunCostBarProps): React.JSX.Element {
  if (status === "loading") {
    return (
      <CostShell>
        <div data-testid="loading" className="flex flex-col gap-2 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full bg-muted" />
            <div className="h-3 w-40 rounded-control bg-muted" />
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted" />
        </div>
      </CostShell>
    );
  }

  if (status === "invalid") {
    return (
      <CostShell>
        <div className="flex items-center gap-2">
          <TriangleAlert aria-hidden className="h-4 w-4 text-destructive" />
          <p role="alert" data-testid="err-cost" className="text-13 text-destructive">
            {errorMessage ?? "成本账本读取失败，暂时无法显示本轮花费"}
          </p>
        </div>
      </CostShell>
    );
  }

  if (status === "empty" || view === null) {
    return (
      <CostShell>
        <div className="flex items-center gap-2" data-testid="empty">
          <Coins aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="text-13 text-muted-foreground">本轮尚未产生调用成本</span>
          <span className="text-11 font-medium text-muted-foreground">{formatCny(0)}</span>
        </div>
      </CostShell>
    );
  }

  const pct = budgetPercent(view);
  const tone: Tone = pct === null ? "primary" : toneForPercent(pct);
  const budgetVisible = status === "ready" && pct !== null;

  return (
    <CostShell>
      <div className="flex items-center gap-2">
        <Coins aria-hidden className={cn("h-4 w-4", TONE_TEXT[tone])} />
        <span className="text-13">
          本轮成本 <b>{formatCny(view.runCostCny)}</b>
        </span>
        <span className="text-11 text-muted-foreground">
          {view.settled ? "已结算" : "实时累计"}
        </span>

        {budgetVisible ? (
          <span className="text-11 text-muted-foreground" data-testid="chat-task-workbench-run-cost-budget">
            · 本月预算已用 {pct}%
          </span>
        ) : status === "budget-unavailable" ? (
          <span
            className="flex items-center gap-1 text-11 text-warning"
            data-testid="dep-failed"
          >
            <WalletMinimal aria-hidden className="h-3 w-3" />
            · 组织尚未配置月度预算，暂无占比
          </span>
        ) : status === "denied" ? (
          <span
            className="flex items-center gap-1 text-11 text-muted-foreground"
            data-testid="denied"
          >
            <ShieldQuestion aria-hidden className="h-3 w-3" />
            · 无权限查看组织预算占比
          </span>
        ) : null}

        {budgetVisible && pct >= 90 ? (
          <Badge tone="danger" className="ml-1" data-testid="chat-task-workbench-run-cost-warn-badge">
            <TriangleAlert aria-hidden className="h-2.5 w-2.5" />
            {pct >= 100 ? "已超本月预算" : "逼近本月预算"}
          </Badge>
        ) : null}

        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          data-testid={PLAN_RUN_COST_DETAIL_TESTID}
          onClick={onOpenDetail}
        >
          成本明细
        </Button>
      </div>

      {budgetVisible ? (
        <>
          <Progress
            value={Math.min(pct, 100)}
            max={100}
            tone={tone}
            label={`本月预算已用 ${pct}%`}
          />
          <p className="text-11 text-muted-foreground">
            本月已用 {formatCny(view.monthUsedCny)} / 预算 {formatCny(view.monthBudgetCny)}
          </p>
        </>
      ) : (
        // 依赖失败 / 无权限：没有分母就不画会误导的进度条，只保留一行本轮花费事实。
        <p className="text-11 text-muted-foreground">
          本轮花费已如实累计；{status === "budget-unavailable" ? "配置组织配额策略后即可看到预算占比" : "组织预算占比需要相应权限"}
        </p>
      )}
    </CostShell>
  );
}
