import * as React from "react";
import { Clock, AlertTriangle, Radio, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  EXEC_MODE_LABEL,
  type JudgmentCard,
  type PushCard,
  type RunningCard,
  type WaitingCard,
  type RiskLevel,
} from "@/lib/mock/tasks";

/** 风险分级 → Badge tone（硬要求：R3 danger / R2 warning / R1 primary）*/
const RISK_TONE: Record<RiskLevel, "danger" | "warning" | "primary"> = {
  R3: "danger",
  R2: "warning",
  R1: "primary",
};

function ProjectLine({ project }: { project: string }) {
  return (
    <span className="text-10 text-muted-foreground" data-testid="tasks-card-project">
      {project}
    </span>
  );
}

/** ① 等我判断 —— 阻塞点卡：风险前缀 + 等待时长 + 决策问句 + 动作 */
export function JudgmentCardView({ card }: { card: JudgmentCard }) {
  return (
    <article
      data-testid={`tasks-judgment-card-${card.id}`}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RISK_TONE[card.risk]} data-testid="tasks-risk-badge">
          {card.risk} · {card.statusWord}
        </Badge>
        <span className="inline-flex items-center gap-1 text-10 text-muted-foreground">
          <Clock aria-hidden className="h-3 w-3" />
          {card.waitedBy} · {card.waitedFor}
        </span>
        <span className="ml-auto text-10 text-muted-foreground">{card.due}</span>
      </div>

      <h3 className="text-13 font-medium">{card.title}</h3>
      <p className="text-12 text-muted-foreground">{card.question}</p>

      {card.note && (
        <p className="inline-flex items-start gap-1 text-11 text-warning">
          <ShieldCheck aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          {card.note}
        </p>
      )}

      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        {card.actions.map((a, i) => (
          <Button
            key={a}
            size="sm"
            variant={i === 0 ? "primary" : "outline"}
            data-testid={`tasks-judgment-action-${card.id}-${i}`}
          >
            {a}
          </Button>
        ))}
        <ProjectLine project={card.project} />
      </div>
    </article>
  );
}

/** ② 今天该我推进 —— 执行模式 + 完成标准进度 + 到期 */
export function PushCardView({ card }: { card: PushCard }) {
  const [done, total] = card.criteria;
  return (
    <article
      data-testid={`tasks-push-card-${card.id}`}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-card p-3 shadow-sm",
        card.live ? "border-primary" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        {card.live && (
          <Badge tone="primary" data-testid="tasks-live-badge">
            <Radio aria-hidden className="h-3 w-3" />
            现场
          </Badge>
        )}
        <h3 className="text-13 font-medium">{card.title}</h3>
        <span className="ml-auto inline-flex items-center gap-1">
          {card.overdue && (
            <Badge tone="danger" data-testid="tasks-overdue-badge">
              <AlertTriangle aria-hidden className="h-3 w-3" />
              逾期
            </Badge>
          )}
          <span className={cn("text-10", card.overdue ? "text-destructive" : "text-muted-foreground")}>
            {card.due}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-10 text-muted-foreground">
        <Badge tone={card.mode === "human" ? "neutral" : "ai"} data-testid="tasks-mode-badge">
          {EXEC_MODE_LABEL[card.mode]}
        </Badge>
        <span data-testid="tasks-criteria">完成标准 {done}/{total}</span>
        <ProjectLine project={card.project} />
      </div>

      {card.hint && <p className="text-11 text-muted-foreground">{card.hint}</p>}

      <div className="mt-0.5 flex items-center gap-2">
        <Button size="sm" variant="primary" data-testid={`tasks-push-advance-${card.id}`}>推进</Button>
        <Button size="sm" variant="ghost" data-testid={`tasks-push-reschedule-${card.id}`}>改期</Button>
        <Button size="sm" variant="ghost" data-testid={`tasks-push-block-${card.id}`}>标记阻塞</Button>
      </div>
    </article>
  );
}

/** ③ AI 正在替我跑 —— executor 是 agent，owner 恒为我（D-39：同时显示两个身份）*/
export function RunningCardView({ card }: { card: RunningCard }) {
  return (
    <article
      data-testid={`tasks-running-card-${card.id}`}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <Avatar initials={card.agentInitials} tone="ai" size="sm" />
        <div className="flex min-w-0 flex-col">
          <h3 className="text-13 font-medium">{card.title}</h3>
          <span className="text-10 text-muted-foreground">{card.step}</span>
        </div>
        <span className="ml-auto flex flex-col items-end gap-0.5">
          <Badge tone="ai" data-testid="tasks-executor-badge">{card.agentName} 在跑</Badge>
          <span className="inline-flex items-center gap-1 text-10 text-muted-foreground" data-testid="tasks-owner-line">
            <Avatar initials={card.ownerName.slice(0, 1)} tone="human" size="xs" />
            我负责
          </span>
        </span>
      </div>

      <Progress value={card.progress} label={`${card.title} 进度`} />

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" data-testid={`tasks-running-view-${card.id}`}>查看 agent 运行</Button>
        <Button size="sm" variant="ghost" data-testid={`tasks-running-pause-${card.id}`}>暂停</Button>
        <Button size="sm" variant="ghost" data-testid={`tasks-running-budget-${card.id}`}>追加预算</Button>
        <ProjectLine project={card.project} />
      </div>
    </article>
  );
}

/** ④ 下一步轮到别人 —— 必须显示在等谁（具体人名 + 等什么 + 逾期）*/
export function WaitingCardView({ card }: { card: WaitingCard }) {
  return (
    <article
      data-testid={`tasks-waiting-card-${card.id}`}
      className="flex items-center gap-3 rounded-md border border-border bg-card p-3 shadow-sm"
    >
      <Avatar initials={card.waitingOnInitial} tone="human" size="sm" />
      <div className="flex min-w-0 flex-col">
        <h3 className="text-13 font-medium">{card.what}</h3>
        <span className="text-10 text-muted-foreground" data-testid="tasks-waiting-on">
          在等 {card.waitingOn} · {card.project}
        </span>
      </div>
      <span className="ml-auto flex items-center gap-2">
        {card.priority && (
          <Badge tone={card.priority === "高" ? "danger" : "neutral"}>{card.priority}</Badge>
        )}
        <span className={cn("text-10", card.overdue ? "text-destructive" : "text-muted-foreground")}>{card.due}</span>
        <Button size="sm" variant="outline" data-testid={`tasks-waiting-nudge-${card.id}`}>催办</Button>
      </span>
    </article>
  );
}
