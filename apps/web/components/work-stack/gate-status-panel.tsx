"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorState } from "@/components/work-stack/states";
import type { GateState, PreviewState, SkillGateView } from "@/lib/mock/work-stack";

const GATE_TEXT: Record<GateState, string> = {
  pass: "通过",
  fail: "未通过",
  not_applicable: "不适用",
  not_evaluated: "未评测",
};

const GATE_TONE: Record<GateState, "success" | "danger" | "neutral" | "outline"> = {
  pass: "success",
  fail: "danger",
  not_applicable: "neutral",
  not_evaluated: "outline",
};

export function GateStatusPanel({
  gates,
  state,
  isPlatformOperator,
}: {
  gates: SkillGateView;
  state: PreviewState;
  /** EV04：非平台运营不渲染「标为 verified」 */
  isPlatformOperator: boolean;
}) {
  const notEvaluated = state === "empty";
  const stale = state === "success" ? false : gates.stale;
  const g5Pass = gates.cells.find((c) => c.gate === "G5")?.state === "pass";

  if (state === "depfail") {
    return (
      <div data-testid="work-skill-gates">
        <ErrorState
          testid="work-gate-state-error"
          message="门状态加载失败，未影响其余字段。请稍后重试。"
        />
      </div>
    );
  }

  const cells = notEvaluated
    ? gates.cells.map((c) => ({ ...c, state: "not_evaluated" as GateState, reason: "尚未评测" }))
    : gates.cells;

  return (
    <div data-testid="work-skill-gates" className="flex flex-col gap-3">
      {notEvaluated && (
        <p data-testid="work-gate-state-not-evaluated" className="text-12 text-muted-foreground">
          该版本尚未评测，六门均为「未评测」。跑一轮评测套件后此处更新。
        </p>
      )}
      {stale && (
        <p
          data-testid="work-gate-stale"
          className="rounded-control bg-warning/15 px-3 py-2 text-12 text-warning-foreground"
        >
          当前版本尚未重新评测，以下为上一版本的门结果，仅供参考。
        </p>
      )}

      <TooltipProvider delayDuration={100}>
        <div className="flex flex-wrap gap-2">
          {cells.map((c) => (
            <Tooltip key={c.gate}>
              <TooltipTrigger asChild>
                <span
                  data-testid={`work-gate-badge-${c.gate}`}
                  data-state={c.state}
                  tabIndex={0}
                  className="cursor-default rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Badge tone={GATE_TONE[c.state]}>
                    {c.gate} · {GATE_TEXT[c.state]}
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <span data-testid={`work-gate-reason-${c.gate}`} className="block max-w-56 text-11">
                  {c.reason}
                  {c.decidedAt ? ` · ${c.decidedAt}` : ""}
                </span>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-12">
        <dt className="text-muted-foreground">评测套件</dt>
        <dd data-testid="work-gate-suite-id" className="text-background-foreground">
          {gates.suiteId}
        </dd>
        <dt className="text-muted-foreground">版本</dt>
        <dd data-testid="work-gate-version" className="text-background-foreground">
          {gates.versionLabel}
        </dd>
        <dt className="text-muted-foreground">通过数（本体 vs 基线）</dt>
        <dd data-testid="work-gate-score" className="text-background-foreground">
          {notEvaluated ? "—" : `${gates.subjectScore} vs ${gates.baselineScore}`}
        </dd>
      </dl>

      {isPlatformOperator && (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <Button
            size="sm"
            variant="primary"
            data-testid="work-gate-mark-verified"
            disabled={!g5Pass}
          >
            标为 verified
          </Button>
          {!g5Pass && (
            <p data-testid="work-gate-mark-verified-reason" className="text-11 text-muted-foreground">
              G5 未通过，暂不能升级到 verified 通道。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
