"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { ArrowUpRight, CheckCircle2, Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  escalationTargetLabel,
  decideEscalation,
  escalationFailureText,
  parseEscalatePayload,
  type EscalateDecision,
  type EscalatePayload,
} from "@/lib/agent-escalation";
import { useAgentDirectoryMap } from "@/lib/use-agent-directory-map";
import { useAgentRunView } from "@/lib/use-agent-run-view";
import type { AgentRunView } from "@/lib/agent-run";
import { InterruptRenderContext } from "./workbench/interrupt-render-context";
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
  const { locale, t } = useI18n();
  const [text, setText] = React.useState("");
  const [inFlight, setInFlight] = React.useState<EscalateDecision["decision"] | null>(null);
  const [error, setError] = React.useState<{ cause: unknown } | null>(null);
  const [done, setDone] = React.useState<EscalateDecision["decision"] | null>(null);
  const textId = React.useId();
  const hintId = React.useId();

  const who = agentName?.trim() || t("chatEscalation.teammate");
  const trimmed = text.trim();
  const hasDistinctReason = payload !== null && payload.reason.trim() !== "" && payload.reason.trim() !== payload.matter.trim();
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
      setError({ cause });
    } finally {
      setInFlight(null);
    }
  };

  return (
    <section
      aria-label={t("chatEscalation.cardAria", { who })}
      className="overflow-hidden rounded-card border border-border bg-card shadow-sm"
      data-testid="agent-escalation-card"
      data-escalation-target={payload?.target ?? undefined}
    >
      <div className="flex items-center gap-1.5 bg-warning-tint px-3 py-1.5 text-11 font-medium text-warning-tint-foreground" data-testid="agent-escalation-banner">
        <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {done ? t("chatEscalation.doneBanner") : t("chatEscalation.waiting")}
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
            <span className="text-muted-foreground">{t("chatEscalation.escalatedTo")}</span>
            {payload ? (
              <Badge tone="attention" data-testid="agent-escalation-target">{escalationTargetLabel(payload.target, locale)}</Badge>
            ) : null}
          </p>
          <p className="mt-0.5 text-11 text-muted-foreground">
            {t("chatEscalation.scope")}
          </p>
        </div>
      </header>

      {payload ? (
        <dl className="mt-3 grid gap-2 text-12">
          {/* uiux-r5 #4.2：标题是数字人自己写的原因 / 摘要（它在问你什么）；事项名退成标签。
              原因缺失或与事项同文时，仍以事项作标题、不重复印。 */}
          {hasDistinctReason ? (
            <div className="rounded-control border-l-2 border-warning bg-muted px-2.5 py-2">
              <dt className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
                {t("chatEscalation.needsDecision")}
                <Badge tone="neutral" data-testid="agent-escalation-matter">{payload.matter}</Badge>
              </dt>
              <dd className="mt-0.5 whitespace-pre-wrap font-medium text-card-foreground" data-testid="agent-escalation-reason">{payload.reason}</dd>
            </div>
          ) : (
            <div className="rounded-control border-l-2 border-warning bg-muted px-2.5 py-2">
              <dt className="text-11 text-muted-foreground">{t("chatEscalation.needsDecision")}</dt>
              <dd className="mt-0.5 font-medium text-card-foreground" data-testid="agent-escalation-matter">{payload.matter}</dd>
            </div>
          )}
          {payload.contextRefs.length > 0 ? (
            <p className="px-0.5 text-11 text-muted-foreground" data-testid="agent-escalation-refs">
              {t("chatEscalation.refs", { count: payload.contextRefs.length })}
            </p>
          ) : null}
        </dl>
      ) : (
        <p className="mt-3 rounded-control bg-muted px-2.5 py-2 text-12 text-muted-foreground" data-testid="agent-escalation-unreadable">
          {t("chatEscalation.unreadable")}
        </p>
      )}

      {done ? (
        <p role="status" className="mt-3 flex items-center gap-1.5 rounded-control bg-muted px-2.5 py-2 text-12 text-card-foreground" data-testid="agent-escalation-done">
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />
          {done === "resolve" ? t("chatEscalation.resolved") : t("chatEscalation.rejected")}
        </p>
      ) : actionable ? (
        <div className="mt-3">
          <label htmlFor={textId} className="text-11 font-medium text-card-foreground">{t("chatEscalation.yourDecision")}</label>
          <textarea
            id={textId}
            aria-describedby={hintId}
            data-testid="agent-escalation-text"
            className="mt-1 h-20 w-full resize-y rounded-control border border-input bg-background px-2.5 py-1.5 text-12 text-background-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={t("chatEscalation.placeholder")}
            maxLength={TEXT_MAX}
            value={text}
            disabled={inFlight !== null}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send("resolve"); }
            }}
          />
          <p id={hintId} className="mt-1 text-10 text-muted-foreground">
            {t("chatEscalation.hint")}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-11 text-destructive" data-testid="agent-escalation-error">{escalationFailureText(error.cause, locale)}</p>
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
              {t("chatEscalation.disagree")}
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
              {t("chatEscalation.submit")}
            </Button>
          </div>
        </div>
      ) : payload && interruptId !== null && !canWrite ? (
        <p className="mt-3 text-11 text-muted-foreground" data-testid="agent-escalation-readonly">
          {t("chatEscalation.readonly", { target: locale === "en" ? escalationTargetLabel(payload.target, locale).toLowerCase() : escalationTargetLabel(payload.target, locale) })}
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
  const { locale } = useI18n();
  const directory = useAgentDirectoryMap();
  const card = directory.get(agentId);
  return (
    <AgentEscalationCard
      interruptId={pending.permissionRequestId ?? null}
      payload={parseEscalatePayload(pending.argsSummary)}
      agentName={card ? agentDisplayName(card, locale) : null}
      agentInitials={card?.initials ?? null}
      agentAvatarKey={card?.avatar?.key ?? null}
      sessionToken={sessionToken}
      canWrite={canWrite}
      onDecided={onDecided}
    />
  );
}

export type ResolvedEscalation = NonNullable<AgentRunView["resolvedEscalations"]>[number];

function formatDecidedAt(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  if (locale === "en") return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * uiux-r3 #4.5 —— 升级被裁决后，卡片不是凭空消失，而是在这一轮里留下一条紧凑的已裁决记录：
 * 决定人 · 同意/驳回 · 时间，下面是事项与说明原文。数据来自权威读 `resolvedEscalations`，刷新后照旧。
 */
export function AgentEscalationDecidedRecord({ record }: { readonly record: ResolvedEscalation }): JSX.Element {
  const { locale, t } = useI18n();
  const payload = parseEscalatePayload(record.argsSummary);
  const decider = record.decidedBy?.displayName?.trim() || (payload ? escalationTargetLabel(payload.target, locale) : t("chatEscalation.owner"));
  const verdict = record.decision === "resolve" ? t("chatEscalation.approved") : t("chatEscalation.declined");
  const when = formatDecidedAt(record.decidedAt, locale);
  return (
    <section
      aria-label={t("chatEscalation.recordAria", { decider, verdict })}
      className="rounded-card border border-border bg-muted px-3 py-2 text-12"
      data-testid="agent-escalation-decided"
      data-decision={record.decision}
    >
      <p className="flex flex-wrap items-center gap-1.5 text-11 text-muted-foreground">
        <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />
        <span className="font-medium text-card-foreground">{t("chatEscalation.recorded")}</span>
        <span aria-hidden>·</span>
        <span data-testid="agent-escalation-decided-by">{decider}</span>
        <Badge tone={record.decision === "resolve" ? "success" : "attention"} data-testid="agent-escalation-decided-verdict">{verdict}</Badge>
        {when ? <><span aria-hidden>·</span><time dateTime={record.decidedAt ?? undefined} data-testid="agent-escalation-decided-at">{when}</time></> : null}
      </p>
      {payload ? <p className="mt-1 text-card-foreground" data-testid="agent-escalation-decided-matter">{payload.matter}</p> : null}
      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground" data-testid="agent-escalation-decided-text">
        {record.decision === "resolve" ? t("chatEscalation.decisionPrefix") : t("chatEscalation.reasonPrefix")}{record.text}
      </p>
    </section>
  );
}

/** 某条 run 上全部已裁决的升级（按裁决先后）。没有就什么都不画。 */
export function RunEscalationRecords({
  runId,
  fetchRun,
}: {
  readonly runId: string;
  readonly fetchRun?: Parameters<typeof useAgentRunView>[2];
}): JSX.Element | null {
  const host = React.useContext(InterruptRenderContext);
  const run = useAgentRunView(runId, host.bearer, fetchRun);
  const records = run?.resolvedEscalations ?? [];
  if (records.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="agent-escalation-decided-list">
      {records.map((record, i) => <AgentEscalationDecidedRecord key={record.permissionRequestId ?? i} record={record} />)}
    </div>
  );
}
