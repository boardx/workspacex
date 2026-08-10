"use client";
import * as React from "react";
import Link from "next/link";
import { Clock, AlertTriangle, Radio, ShieldCheck, Check, ChevronRight } from "lucide-react";
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

/**
 * 「我的今天」四类任务卡（UC-11.5）。
 *
 * 所有动作都接了真实出口（乐观更新 + 可见反馈 / 展开面板 / 真链接）——
 * ⚠ 界面投影：责任人始终是人（D-39），乐观反馈只表示「动作被接住」，真实落库在服务端。
 */

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

/** 处理完成后统一的成功反馈条 */
function ResolvedLine({ text, testid }: { text: string; testid: string }) {
  return (
    <p className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-11 text-success" data-testid={testid}>
      <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {text}
    </p>
  );
}

/** 依据面板：给出几条支撑 + 去大脑看完整 Context Pack */
function EvidencePanel({ cardId }: { cardId: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-muted p-2.5" data-testid={`tasks-evidence-${cardId}`}>
      <p className="text-11 font-medium">这条判断的依据</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-11 text-muted-foreground">
        <li>支撑 9 条（含 2 条反对，强制保留）· 每条带页码/时间码锚点</li>
        <li>Ledger 现金流模型：路径 B 单位度电成本低 11%，回本快 8 个月</li>
        <li>反对：补贴退坡后套利窗口存在收窄风险</li>
      </ul>
      <Button size="xs" variant="outline" asChild data-testid={`tasks-evidence-brain-${cardId}`}>
        <Link href="/brain">在组织大脑看完整 Context Pack ▸</Link>
      </Button>
    </div>
  );
}

/** ① 等我判断 —— 阻塞点卡：风险前缀 + 等待时长 + 决策问句 + 动作 */
export function JudgmentCardView({ card }: { card: JudgmentCard }) {
  const [showEvidence, setShowEvidence] = React.useState(false);
  const [acting, setActing] = React.useState(false);
  const [choice, setChoice] = React.useState<string | null>(null);
  const [resolved, setResolved] = React.useState<string | null>(null);

  // 主动作面板的选项/文案随阻塞类型（statusWord）而变
  const decideOptions =
    card.statusWord === "需批准"
      ? ["承诺收益保底（改成本结构）", "不承诺保底（维持当前画布）", "需要更多依据再定"]
      : card.statusWord === "待验收"
        ? ["三项完成标准均已核对，验收通过", "3 条低置信度可接受，验收通过", "退回补证据后再验收"]
        : ["授权 CRM 读取（仅本次任务内）", "仅授权只读联系人字段", "拒绝本次授权"];
  const resolveText =
    card.statusWord === "需批准"
      ? `已记入判断：${choice ?? ""}`
      : card.statusWord === "待验收"
        ? "已验收 · 结论已成为可引用证据"
        : "已授权 · 已加入本任务权限包（逐次 · 限范围 · 限本次任务）";

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
          {card.waitedFor && <Clock aria-hidden className="h-3 w-3" />}
          {card.waitedFor ? `${card.waitedBy} · ${card.waitedFor}` : card.waitedBy}
        </span>
        {card.due && <span className="ml-auto text-10 text-muted-foreground">{card.due}</span>}
      </div>

      <h3 className="text-13 font-medium">{card.title}</h3>
      {card.question && <p className="text-12 text-muted-foreground">{card.question}</p>}

      {card.note && (
        <p className="inline-flex items-start gap-1 text-11 text-muted-foreground">
          <ShieldCheck aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
          {card.note}
        </p>
      )}

      {resolved ? (
        <ResolvedLine text={resolved} testid={`tasks-judgment-resolved-${card.id}`} />
      ) : acting ? (
        <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-accent/40 p-2.5" role="group" data-testid={`tasks-judgment-panel-${card.id}`}>
          <p className="text-11 font-medium">{card.actions[0]}</p>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label={card.actions[0]}>
            {decideOptions.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={choice === o}
                onClick={() => setChoice(o)}
                data-testid={`tasks-judgment-option-${card.id}-${decideOptions.indexOf(o)}`}
                className={cn(
                  "rounded-md border px-2 py-1 text-left text-11 transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  choice === o ? "border-primary bg-card text-card-foreground" : "border-border-subtle text-muted-foreground hover:bg-muted",
                )}
              >
                {o}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!choice}
              onClick={() => setResolved(resolveText)}
              data-testid={`tasks-judgment-submit-${card.id}`}
            >
              确认并记入
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setActing(false)} data-testid={`tasks-judgment-cancel-${card.id}`}>取消</Button>
          </div>
        </div>
      ) : (
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {card.actions.map((a, i) => {
            if (a === "看依据") {
              return (
                <Button
                  key={a}
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowEvidence((v) => !v)}
                  aria-expanded={showEvidence}
                  data-testid={`tasks-judgment-action-${card.id}-${i}`}
                >
                  <ChevronRight aria-hidden className={cn("h-3 w-3 transition-transform duration-200", showEvidence && "rotate-90")} />
                  看依据
                </Button>
              );
            }
            if (a === "要求补证据") {
              return (
                <Button
                  key={a}
                  size="sm"
                  variant="outline"
                  onClick={() => setResolved("已要求补证据 · 已退回交付方（Scout）")}
                  data-testid={`tasks-judgment-action-${card.id}-${i}`}
                >
                  {a}
                </Button>
              );
            }
            return (
              <Button
                key={a}
                size="sm"
                variant={i === 0 ? "primary" : "outline"}
                onClick={() => setActing(true)}
                data-testid={`tasks-judgment-action-${card.id}-${i}`}
              >
                {a}
              </Button>
            );
          })}
          <ProjectLine project={card.project} />
        </div>
      )}

      {showEvidence && !resolved && !acting && <EvidencePanel cardId={card.id} />}
    </article>
  );
}

/** ② 今天该我推进 —— 执行模式 + 完成标准进度 + 到期 */
export function PushCardView({ card }: { card: PushCard }) {
  const [done, total] = card.criteria;
  const [outcome, setOutcome] = React.useState<null | "advanced" | "blocked" | "rescheduled">(null);
  const [rescheduling, setRescheduling] = React.useState(false);
  const [newDue, setNewDue] = React.useState<string | null>(null);

  const shownDone = outcome === "advanced" ? Math.min(done + 1, total) : done;
  const rescheduleOptions = ["明天", "本周五", "下周一"];

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
          {card.overdue && outcome !== "rescheduled" && (
            <Badge tone="danger" data-testid="tasks-overdue-badge">
              <AlertTriangle aria-hidden className="h-3 w-3" />
              逾期
            </Badge>
          )}
          <span className={cn("text-10", card.overdue && outcome !== "rescheduled" ? "text-destructive" : "text-muted-foreground")}>
            {outcome === "rescheduled" && newDue ? `已改期 · ${newDue}` : card.due}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-10 text-muted-foreground">
        <Badge tone={card.mode === "human" ? "neutral" : "ai"} data-testid="tasks-mode-badge">
          {EXEC_MODE_LABEL[card.mode]}
        </Badge>
        <span data-testid="tasks-criteria">完成标准 {shownDone}/{total}</span>
        <ProjectLine project={card.project} />
      </div>

      {card.hint && <p className="text-11 text-muted-foreground">{card.hint}</p>}

      {outcome === "advanced" && <ResolvedLine text={`已推进 · 完成标准 ${shownDone}/${total}`} testid={`tasks-push-advanced-${card.id}`} />}
      {outcome === "blocked" && (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-11 text-warning" data-testid={`tasks-push-blocked-${card.id}`}>
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          已标记阻塞 · 已挪入「等我判断」，不会静默停摆
        </p>
      )}
      {outcome === "rescheduled" && <ResolvedLine text={`已改期到 ${newDue}`} testid={`tasks-push-rescheduled-${card.id}`} />}

      {rescheduling && !outcome && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-subtle bg-muted p-2" data-testid={`tasks-push-reschedule-panel-${card.id}`}>
          <span className="text-11 text-muted-foreground">改到：</span>
          {rescheduleOptions.map((o) => (
            <Button
              key={o}
              size="xs"
              variant="outline"
              onClick={() => { setNewDue(o); setOutcome("rescheduled"); setRescheduling(false); }}
              data-testid={`tasks-push-reschedule-opt-${card.id}-${rescheduleOptions.indexOf(o)}`}
            >
              {o}
            </Button>
          ))}
          <Button size="xs" variant="ghost" onClick={() => setRescheduling(false)} data-testid={`tasks-push-reschedule-cancel-${card.id}`}>取消</Button>
        </div>
      )}

      {!outcome && !rescheduling && (
        <div className="mt-0.5 flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => setOutcome("advanced")} data-testid={`tasks-push-advance-${card.id}`}>推进</Button>
          <Button size="sm" variant="ghost" onClick={() => setRescheduling(true)} data-testid={`tasks-push-reschedule-${card.id}`}>改期</Button>
          <Button size="sm" variant="ghost" onClick={() => setOutcome("blocked")} data-testid={`tasks-push-block-${card.id}`}>标记阻塞</Button>
        </div>
      )}
    </article>
  );
}

/** ③ AI 正在替我跑 —— executor 是 agent，owner 恒为我（D-39：同时显示两个身份）*/
export function RunningCardView({ card }: { card: RunningCard }) {
  const [showRun, setShowRun] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [budgetPanel, setBudgetPanel] = React.useState(false);
  const [addedBudget, setAddedBudget] = React.useState<string | null>(null);

  const budgetOptions = ["+100k", "+200k", "+500k"];

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
          <Badge tone={paused ? "warning" : "ai"} data-testid="tasks-executor-badge">
            {paused ? `${card.agentName} 已暂停` : `${card.agentName} 在跑`}
          </Badge>
          <span className="inline-flex items-center gap-1 text-10 text-muted-foreground" data-testid="tasks-owner-line">
            <Avatar initials={card.ownerName.slice(0, 1)} tone="human" size="xs" />
            我负责
          </span>
        </span>
      </div>

      <Progress value={card.progress} label={`${card.title} 进度`} />

      {showRun && (
        <ol className="flex flex-col gap-1 rounded-md border border-border-subtle bg-muted p-2.5 text-11 text-muted-foreground" data-testid={`tasks-running-detail-${card.id}`}>
          <li>1. 读取项目图谱证据段 · 已读 41 份</li>
          <li>2. 交叉核验来源可信度 · 剔除 3 条低可信</li>
          <li className="text-background-foreground">3. 当前：{card.step} · 进度 {card.progress}%</li>
          <li className="text-10">token / 读取文件数等细节在任务详情「执行」页，不在本摘要展开。</li>
        </ol>
      )}

      {addedBudget && <ResolvedLine text={`已追加预算 ${addedBudget} · agent 继续跑`} testid={`tasks-running-budget-added-${card.id}`} />}

      {budgetPanel && !addedBudget && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-subtle bg-muted p-2" data-testid={`tasks-running-budget-panel-${card.id}`}>
          <span className="text-11 text-muted-foreground">追加：</span>
          {budgetOptions.map((o) => (
            <Button
              key={o}
              size="xs"
              variant="outline"
              onClick={() => { setAddedBudget(o); setBudgetPanel(false); }}
              data-testid={`tasks-running-budget-opt-${card.id}-${budgetOptions.indexOf(o)}`}
            >
              {o}
            </Button>
          ))}
          <Button size="xs" variant="ghost" onClick={() => setBudgetPanel(false)} data-testid={`tasks-running-budget-cancel-${card.id}`}>取消</Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowRun((v) => !v)}
          aria-expanded={showRun}
          data-testid={`tasks-running-view-${card.id}`}
        >
          {showRun ? "收起运行" : "查看 agent 运行"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setPaused((v) => !v)}
          aria-pressed={paused}
          data-testid={`tasks-running-pause-${card.id}`}
        >
          {paused ? "继续" : "暂停"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setBudgetPanel((v) => !v)} data-testid={`tasks-running-budget-${card.id}`}>追加预算</Button>
        <ProjectLine project={card.project} />
      </div>
    </article>
  );
}

/** ④ 下一步轮到别人 —— 必须显示在等谁（具体人名 + 等什么 + 逾期）*/
export function WaitingCardView({ card }: { card: WaitingCard }) {
  const [nudged, setNudged] = React.useState(false);

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
        {nudged ? (
          <span className="inline-flex items-center gap-1 text-11 text-success" data-testid={`tasks-waiting-nudged-${card.id}`}>
            <Check aria-hidden className="h-3.5 w-3.5" />
            已催办 {card.waitingOn}
          </span>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setNudged(true)} data-testid={`tasks-waiting-nudge-${card.id}`}>催办</Button>
        )}
      </span>
    </article>
  );
}
