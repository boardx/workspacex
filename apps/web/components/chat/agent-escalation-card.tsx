"use client";
import * as React from "react";
import { ArrowUpRight, CheckCircle2, Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ESCALATION_TARGET_LABEL,
  decideEscalation,
  escalationFailureText,
  parseEscalatePayload,
  type EscalateDecision,
  type EscalatePayload,
} from "@/lib/agent-escalation";
import { useAgentDirectoryMap } from "@/lib/use-agent-directory-map";
import { agentDisplayName } from "@/lib/agent-directory";

/**
 * AG06（契约束 agent-role R3 ⑧ / E6）—— 升级卡片：数字人命中 escalationPolicy、把一件事
 * 交给人拍板时，run 停在 `awaiting_tool_permission`、待决工具是 `escalate_matter`。
 * 此前这条中断落进通用「等待你的批准：escalate_matter」+ 原始 JSON，成员看不出谁、为什么、
 * 要他决定什么。本卡片把 `EscalatePayload` 讲成人话：
 *
 *   谁升级（数字人头像 + 名字）→ 升级给谁（target）→ 要决定的事（matter）→ 原因（reason）
 *   → 两个契约动作：`resolve`（给出决定，decisionText）/ `reject`（不同意，reason）。
 *
 * 纪律同 `AgentApprovalPanel`：提交后**不在本地预测结果**，由宿主轮询权威读更新；失败只说
 * 人话（`escalationFailureText`），内部码从不上屏。能否裁决由服务端判定（E6），前端不猜。
 */
export interface AgentEscalationCardProps {
  /** 待决中断 id（= `pendingApproval.permissionRequestId`）；缺失时卡片只读展示。 */
  readonly interruptId: string | null;
  /** 解析后的载荷；null = 服务端给的摘要读不出，卡片展示兜底文案、不提供动作。 */
  readonly payload: EscalatePayload | null;
  readonly agentName?: string | null;
  readonly agentAvatarKey?: string | null;
  readonly agentInitials?: string | null;
  readonly sessionToken?: string;
  readonly canWrite?: boolean;
  readonly onDecided?: (decision: EscalateDecision["decision"]) => void;
  /** 测试可注入；默认走真实 `decideEscalation`。 */
  readonly submit?: typeof decideEscalation;
}

const TEXT_MAX = 2000;

export function AgentEscalationCard({
  interruptId,
  payload,
  agentName,
  agentAvatarKey = null,
  agentInitials,
  sessionToken,
  canWrite = true,
  onDecided,
  submit = decideEscalation,
}: AgentEscalationCardProps): JSX.Element {
  const [text, setText] = React.useState("");
  const [inFlight, setInFlight] = React.useState<EscalateDecision["decision"] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<EscalateDecision["decision"] | null>(null);
  const textId = React.useId();
  const hintId = React.useId();

  const who = agentName?.trim() || "数字人";
  const trimmed = text.trim();
  const actionable = canWrite && interruptId !== null && payload !== null && done === null;

  const send = async (kind: EscalateDecision["decision"]) => {
    if (!actionable || inFlight || trimmed.length === 0) return;
    setInFlight(kind);
    setError(null);
    try {
      const decision: EscalateDecision = kind === "resolve"
        ? { decision: "resolve", decisionText: trimmed }
        : { decision: "reject", reason: trimmed };
      await submit(interruptId, decision, sessionToken);
      setDone(kind);
      onDecided?.(kind);
    } catch (cause) {
      setError(escalationFailureText(cause));
    } finally {
      setInFlight(null);
    }
  };

  return (
    <section
      aria-label={`${who} 升级了一件事，需要你拍板`}
      className="overflow-hidden rounded-card border border-border bg-card shadow-sm"
      data-testid="agent-escalation-card"
      data-escalation-target={payload?.target ?? undefined}
    >
      <div className="flex items-center gap-1.5 bg-warning-tint px-3 py-1.5 text-11 font-medium text-warning-tint-foreground" data-testid="agent-escalation-banner">
        <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {done ? "已给出决定" : "等你拍板 · 任务暂停中"}
      </div>
      <div className="p-3">
      <header className="flex items-start gap-2.5">
        <Avatar
          initials={agentInitials?.trim() || who.slice(0, 1)}
          avatarKey={agentAvatarKey}
          tone="ai"
          size="lg"
          data-testid="agent-escalation-avatar"
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-13 font-medium text-card-foreground">
            <span data-testid="agent-escalation-who">{who}</span>
            <span className="text-muted-foreground">把一件事升级给了</span>
            {payload ? (
              <Badge tone="attention" data-testid="agent-escalation-target">{ESCALATION_TARGET_LABEL[payload.target]}</Badge>
            ) : null}
          </p>
          <p className="mt-0.5 text-11 text-muted-foreground">
            这件事超出了它自己能做主的范围，任务会停在这里，等你给出决定后继续。
          </p>
        </div>
      </header>

      {payload ? (
        <dl className="mt-3 grid gap-2 text-12">
          <div className="rounded-control border-l-2 border-warning bg-muted px-2.5 py-2">
            <dt className="text-11 text-muted-foreground">需要你决定</dt>
            <dd className="mt-0.5 font-medium text-card-foreground" data-testid="agent-escalation-matter">{payload.matter}</dd>
          </div>
          <div className="px-0.5">
            <dt className="text-11 text-muted-foreground">它为什么来问你</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-card-foreground" data-testid="agent-escalation-reason">{payload.reason}</dd>
          </div>
          {payload.contextRefs.length > 0 ? (
            <p className="px-0.5 text-11 text-muted-foreground" data-testid="agent-escalation-refs">
              附带 {payload.contextRefs.length} 条相关材料，可在任务过程区查看。
            </p>
          ) : null}
        </dl>
      ) : (
        <p className="mt-3 rounded-control bg-muted px-2.5 py-2 text-12 text-muted-foreground" data-testid="agent-escalation-unreadable">
          这条升级请求的详情暂时读不出来。刷新页面后再看一次；如果仍然看不到，可以在对话里直接告诉它你的意见。
        </p>
      )}

      {done ? (
        <p role="status" className="mt-3 flex items-center gap-1.5 rounded-control bg-muted px-2.5 py-2 text-12 text-card-foreground" data-testid="agent-escalation-done">
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />
          {done === "resolve" ? "已提交你的决定，任务正在按它继续。" : "已告诉它你不同意，它会据此调整做法。"}
        </p>
      ) : actionable ? (
        <div className="mt-3">
          <label htmlFor={textId} className="text-11 font-medium text-card-foreground">你的决定或意见</label>
          <textarea
            id={textId}
            aria-describedby={hintId}
            data-testid="agent-escalation-text"
            className="mt-1 h-20 w-full resize-y rounded-control border border-input bg-background px-2.5 py-1.5 text-12 text-background-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="例如：同意按 8 折报价，但交付时间不能晚于下月 15 日。"
            maxLength={TEXT_MAX}
            value={text}
            disabled={inFlight !== null}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send("resolve"); }
            }}
          />
          <p id={hintId} className="mt-1 text-10 text-muted-foreground">
            它会按你写的内容继续；选「不同意」时，这段话会作为理由告诉它。Ctrl/⌘ + Enter 快速提交决定。
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-11 text-destructive" data-testid="agent-escalation-error">{error}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="agent-escalation-reject"
              disabled={trimmed.length === 0 || inFlight !== null}
              onClick={() => void send("reject")}
            >
              {inFlight === "reject" ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
              不同意
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              data-testid="agent-escalation-resolve"
              disabled={trimmed.length === 0 || inFlight !== null}
              onClick={() => void send("resolve")}
            >
              {inFlight === "resolve" ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
              提交决定
            </Button>
          </div>
        </div>
      ) : payload && interruptId !== null && !canWrite ? (
        <p className="mt-3 text-11 text-muted-foreground" data-testid="agent-escalation-readonly">
          你当前只能查看这条对话，决定需要由{ESCALATION_TARGET_LABEL[payload.target]}给出。
        </p>
      ) : null}
      </div>
    </section>
  );
}

/**
 * 从 run 的权威读（`AgentRunView.pendingApproval`）直接挂升级卡片：解析载荷、按 `agentId`
 * 在成员目录里取数字人名字与 dh-* 头像。两条渲染路径（旧轨道 `AgentApprovalPanel`、
 * v2 轨道 `RestoredRunApproval`）共用这一处，不各写一份。
 */
export function AgentEscalationForRun({
  agentId,
  pending,
  sessionToken,
  canWrite,
  onDecided,
}: {
  readonly agentId: string;
  readonly pending: { readonly permissionRequestId?: string | null; readonly argsSummary: string | null };
  readonly sessionToken?: string;
  readonly canWrite?: boolean;
  readonly onDecided?: (decision: EscalateDecision["decision"]) => void;
}): JSX.Element {
  const directory = useAgentDirectoryMap();
  const card = directory.get(agentId);
  return (
    <AgentEscalationCard
      interruptId={pending.permissionRequestId ?? null}
      payload={parseEscalatePayload(pending.argsSummary)}
      agentName={card ? agentDisplayName(card) : null}
      agentInitials={card?.initials ?? null}
      agentAvatarKey={card?.avatar?.key ?? null}
      sessionToken={sessionToken}
      canWrite={canWrite}
      onDecided={onDecided}
    />
  );
}
