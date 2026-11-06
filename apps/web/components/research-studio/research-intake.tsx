"use client";
import { DEFAULT_RESEARCH_NAME } from "@/lib/guided-research-heading";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { research as researchContract } from "@repo/contracts";
import { ArrowRight, Upload } from "lucide-react";
import { InterviewVoiceInput } from "@/components/itv/interview-voice-input";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { WorkflowActionButton, WorkflowActionBar } from "./research-workflow-actions";
import { ResearchLoading } from "./guided-research-presentation";
import { GuidedResearchStepLayout } from "./guided-research-step-layout";
import type { GuidedResearchCreateDraft } from "./create-guided-research-dialog";
import { createGuidedResearchSession, getResearchRuntime, executeResearchRuntime, confirmResearchBrief, executeGuidedResearchNodeCommand, getGuidedResearchSession, runGuidedResearchSkillTurn, type GuidedResearchSession, type GuidedResearchWorkflowProjection } from "@/lib/guided-research-api";
type Brief = GuidedResearchSession["brief"];
type Step = "home" | "brief" | "directions" | "outline" | "search" | "report";
const briefShape = researchContract.GuidedResearchBrief.shape;
const goalLimit = briefShape.goal.maxLength!;
const optionalBriefLabels = { topic: "research.intake.topic", timeRange: "research.intake.timeRange", region: "research.intake.region", focus: "research.intake.focus" } as const;
const EMPTY_BRIEF: Brief = { topic: "", goal: "", timeRange: "", region: "", focus: "" };
function requestId(prefix: string) { return prefix + "-" + crypto.randomUUID(); }
function workflowGraphVersion(workflow: GuidedResearchWorkflowProjection | null) { return workflow?.graphVersion ?? null; }
function briefNodeState(session: GuidedResearchSession | null, brief: Brief) { return { name: session?.title ?? brief.topic, tags: session?.tags ?? [], topic: brief.topic, objective: brief.goal, timeRange: brief.timeRange, geography: brief.region, focus: brief.focus }; }
export const CREATE_DRAFT_KEY = "wsx.guidedResearch.createDraft";
const CREATE_IDEMPOTENCY_TAB_KEY = "wsx.guidedResearch.createTabId";
const CREATE_IDEMPOTENCY_STORAGE_PREFIX = "wsx.guidedResearch.createIdempotencyKey.";
const CREATE_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function cleanStaleCreateIdempotencyKeys(now: number): void {
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const storageKey = window.localStorage.key(index);
    if (!storageKey?.startsWith(CREATE_IDEMPOTENCY_STORAGE_PREFIX)) continue;
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { createdAt?: number } | null;
      if (!stored?.createdAt || now - stored.createdAt > CREATE_IDEMPOTENCY_TTL_MS) window.localStorage.removeItem(storageKey);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }
}

function pendingCreateIdempotencyKey(intent: GuidedResearchCreateDraft & { brief: Brief; sourceMode?: string }): { key: string; storageKey: string } {
  const now = Date.now();
  cleanStaleCreateIdempotencyKeys(now);
  let tabId = window.sessionStorage.getItem(CREATE_IDEMPOTENCY_TAB_KEY);
  if (!tabId) {
    tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(CREATE_IDEMPOTENCY_TAB_KEY, tabId);
  }
  const fingerprint = JSON.stringify(intent);
  const storageKey = `${CREATE_IDEMPOTENCY_STORAGE_PREFIX}${tabId}.${encodeURIComponent(fingerprint)}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    const stored = JSON.parse(existing) as { key: string; createdAt: number };
    return { key: stored.key, storageKey };
  }
  const generated = `guided-${now}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(storageKey, JSON.stringify({ key: generated, createdAt: now }));
  return { key: generated, storageKey };
}

export function ResearchIntake({ sessionId, session, workflow, onSession, onWorkflow, onNavigate, onPending, initialBrief = EMPTY_BRIEF, renderAssistant, onClear, onCreated, onDirtyChange, onConfirmBrief }: {
  /** An embedding may own submission; the default remains the persisted workflow. */
  onConfirmBrief?: (brief: Brief) => void;
  onDirtyChange?: (dirty: boolean) => void;
  initialBrief?: Brief;
  /** 新会话创建成功、拿到 id 之后立刻调用（项目中枢用它把会话挂回项目）；抛错由调用方自行吞掉。 */
  onCreated?: (sessionId: string) => Promise<void> | void;
  renderAssistant?: (brief: Brief, onChange: (brief: Brief) => void) => React.ReactNode;
  onClear?: (sessionId?: string) => void;
  onPending: (pending: boolean) => void;
  sessionId?: string;
  session: GuidedResearchSession | null;
  workflow: GuidedResearchWorkflowProjection | null;
  onSession: (session: GuidedResearchSession) => void;
  onWorkflow: (workflow: GuidedResearchWorkflowProjection | null) => void;
  onNavigate: (step: Step, sessionId?: string) => void;
}) {
  const { t } = useI18n();
  const [brief, setBrief] = React.useState(initialBrief);
  const [sourceMode, setSourceMode] = React.useState<"materials" | "open">("open");
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const optionalErrors = (Object.keys(optionalBriefLabels) as (keyof typeof optionalBriefLabels)[])
    .filter((key) => brief[key].trim().length > briefShape[key].maxLength!);
  const optionalErrorKey = optionalErrors.join(",");
  React.useEffect(() => { if (optionalErrorKey) setDetailsOpen(true); }, [optionalErrorKey]);
  const briefValid = researchContract.GuidedResearchBrief.safeParse({ ...brief, topic: brief.topic.trim() || DEFAULT_RESEARCH_NAME }).success;
  const fieldConstraints = (key: keyof typeof optionalBriefLabels) => ({
    maxLength: Math.max(briefShape[key].maxLength!, brief[key].length),
    "aria-invalid": optionalErrors.includes(key) || undefined,
    "aria-describedby": optionalErrors.includes(key) ? `research-brief-${key}-error` : undefined,
  });
  const authSession = useOptionalSession()?.session;
  const [voicePreview, setVoicePreview] = React.useState("");
  const [voiceBusy, setVoiceBusy] = React.useState(false);
  const [importBusy, setImportBusy] = React.useState(false);
  const [inputError, setInputError] = React.useState<MessageKey | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const appendInput = React.useCallback((text: string) => {
    setBrief((current) => ({ ...current, goal: current.goal ? `${current.goal}\n\n${text}` : text }));
  }, []);
  async function importFile(file: File) {
    setImportBusy(true); setInputError(null);
    try {
      if (!/\.(txt|md|markdown|csv)$/i.test(file.name)) throw new Error("research.intake.fileType");
      if (file.size > 2 * 1024 * 1024) throw new Error("research.intake.fileSize");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (!text.trim()) throw new Error("research.intake.fileEmpty");
      appendInput(text);
    } catch (cause) { setInputError(cause instanceof Error && ["research.intake.fileType", "research.intake.fileSize", "research.intake.fileEmpty"].includes(cause.message) ? cause.message as MessageKey : "research.intake.fileRead"); }
    finally { setImportBusy(false); }
  }
  const baseline = session?.brief ?? initialBrief;
  React.useEffect(() => { onDirtyChange?.(voiceBusy || importBusy || Boolean(voicePreview) || JSON.stringify(brief) !== JSON.stringify(baseline)); }, [brief, baseline, voiceBusy, importBusy, voicePreview, onDirtyChange]);
  const assistant = useIntakeAssistant(brief, setBrief);
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [createDraft] = React.useState<GuidedResearchCreateDraft>(() => {
    try {
      const stored = window.sessionStorage.getItem(CREATE_DRAFT_KEY);
      if (!stored) return { title: DEFAULT_RESEARCH_NAME, tags: [] };
      const parsed = JSON.parse(stored) as Partial<GuidedResearchCreateDraft>;
      return {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : DEFAULT_RESEARCH_NAME,
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 5) : [],
      };
    } catch {
      return { title: DEFAULT_RESEARCH_NAME, tags: [] };
    }
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [submitFailed, setSubmitFailed] = React.useState(false);
  const patch = (key: keyof typeof brief, value: string) => setBrief((current) => ({ ...current, [key]: value }));
  React.useEffect(() => {
    if (session) setBrief({ ...session.brief });
  }, [session]);
  const confirm = async () => {
    if (submitting || voiceBusy || importBusy || !briefValid || brief.goal.length > goalLimit || !brief.goal.trim()) return;
    // Preserve the full requirement as the goal. The saved model brief will supply a topic.
    const confirmedBrief = { ...brief, topic: brief.topic.trim() || DEFAULT_RESEARCH_NAME };
    if (onConfirmBrief) { onConfirmBrief(confirmedBrief); return; }
    setSubmitting(true);
    onPending(true);
    setSubmitFailed(false);
    try {
      if (sessionId && session) {
        const graphVersion = workflowGraphVersion(workflow);
        const updated = graphVersion === null
          ? await confirmResearchBrief(sessionId, { briefVersion: session.briefVersion, brief })
          : await executeGuidedResearchNodeCommand(sessionId, {
            node: "brief",
            action: "confirm",
            requestId: requestId("brief-confirm"),
            expectedGraphVersion: graphVersion,
            nodeState: briefNodeState(session, brief),
          }).then(async (projection) => {
            onWorkflow(projection);
            return getGuidedResearchSession(sessionId);
          });

        onClear?.(sessionId);
        onSession(updated);
        onNavigate("outline", sessionId);
        return;
      }
      const pending = pendingCreateIdempotencyKey({ ...createDraft, brief: confirmedBrief, sourceMode });
      const createdSession = await createGuidedResearchSession({ ...createDraft, title: createDraft.title || DEFAULT_RESEARCH_NAME, tags: [...createDraft.tags], idempotencyKey: pending.key, collaboratorUserIds: [], brief: confirmedBrief });
      if (!active.current) return;
      if (onCreated) {
        await onCreated(createdSession.sessionId);
        if (!active.current) return;
      }
      // Once creation has returned an id, recovery belongs to that session. Never
      // create or replay a model command merely because its response was lost.
      let runtime;
      try {
        runtime = await getResearchRuntime(createdSession.sessionId);
        if (!active.current) return;
      } catch {
        if (!active.current) return;
        try { runtime = await getResearchRuntime(createdSession.sessionId); } catch { /* Live offers read-only recovery. */ }
      }
      if (!active.current) return;
      if (!runtime) throw new Error("RESEARCH_WORKFLOW_UNAVAILABLE");
      if (!(runtime.version > 0 && runtime.sourcePolicy?.mode === sourceMode)) {
        const policyRequest = `source-policy-${createdSession.sessionId}-${runtime.version}-${sourceMode}`;
        runtime = await executeResearchRuntime({ sessionId: createdSession.sessionId, node: runtime.currentNode,
          action: "refine_source_policy", requestId: policyRequest, expectedVersion: runtime.version,
          expectedRevision: runtime.planRevision ?? 0, idempotencyKey: policyRequest,
          sourcePolicy: { mode: sourceMode, domains: runtime.sourcePolicy?.domains ?? [], internalSourceIds: runtime.sourcePolicy?.internalSourceIds ?? [], revision: (runtime.sourcePolicy?.revision ?? 0) + 1 } });
        if (!active.current) return;
        if (runtime.errorCode || runtime.sourcePolicy?.mode !== sourceMode) throw new Error("RESEARCH_SOURCE_POLICY_INVALID");
      }
      window.localStorage.removeItem(pending.storageKey);
      window.sessionStorage.removeItem(CREATE_DRAFT_KEY);
      onClear?.();
      onSession(createdSession);
      const node = runtime?.currentNode;
      onNavigate(runtime?.version === 0 || runtime?.currentNode === "brief" || !runtime ? "outline" : node === "research" ? "search" : node ?? "outline", createdSession.sessionId);
    } catch {
      if (active.current) setSubmitFailed(true);
    } finally {
      if (active.current) {
        setSubmitting(false);
        onPending(false);
      }
    }
  };
  return (
    <GuidedResearchStepLayout
      floatingAssistant
      assistant={renderAssistant ? renderAssistant(brief, setBrief) : assistant}
    >
      {submitting ? <ResearchLoading node="directions" /> : <div className="flex min-w-0 flex-col gap-4" data-density="compact-step">
      {sessionId && <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-12 text-warning-foreground">{t("research.intake.regenerate")}</p>}
      <div className="min-w-0">
        <Card className="flex rounded-xl"><CardContent className="flex w-full flex-col gap-3 p-4 sm:p-5">
          <h2 className="text-xl font-bold">{t("research.intake.heading")}</h2>
          <div className="flex min-h-56 flex-1 flex-col rounded-lg border border-border p-4">
            {!sessionId && <fieldset className="mb-4 flex flex-wrap gap-4 text-sm"><legend className="mb-2 font-medium">研究来源</legend>
              <label><input type="radio" name="research-source-mode" checked={sourceMode === "materials"} onChange={() => setSourceMode("materials")} /> 仅使用本次材料</label>
              <label><input type="radio" name="research-source-mode" checked={sourceMode === "open"} onChange={() => setSourceMode("open")} /> 允许联网检索</label>
              <p className="w-full text-xs text-muted-foreground">仅材料模式需要已关联的可核验资料，不会访问外部网页。输入描述和导入文字仅作为研究需求，不会自动成为可核验来源；资料不足时仅提示证据缺口。</p>
            </fieldset>}
            <Textarea value={voicePreview ? (brief.goal ? `${brief.goal}\n\n${voicePreview}` : voicePreview) : brief.goal} readOnly={voiceBusy || importBusy} maxLength={Math.max(goalLimit, brief.goal.length)} onChange={(event) => patch("goal", event.target.value)} data-testid="research-brief-goal" aria-label={t("research.intake.goal")} aria-invalid={brief.goal.length > goalLimit || undefined} aria-describedby={brief.goal.length > goalLimit ? "research-goal-error" : undefined} className="min-h-48 flex-1 resize-y border-0 p-0 text-sm leading-relaxed shadow-none focus-visible:ring-2" placeholder={t("research.intake.placeholder")} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <InterviewVoiceInput sessionToken={authSession?.sessionToken ?? ""} disabled={submitting || importBusy} onAppend={appendInput} onPreview={setVoicePreview} onBusyChange={setVoiceBusy} />
              <WorkflowActionButton variant="outline" disabled={submitting || voiceBusy || importBusy} onClick={() => fileInput.current?.click()}><Upload className="mr-2 size-4" />{t(importBusy ? "research.intake.importing" : "research.intake.upload")}</WorkflowActionButton>
              <input ref={fileInput} type="file" accept=".txt,.md,.markdown,.csv" aria-label={t("research.intake.uploadLabel")} className="sr-only" disabled={submitting || voiceBusy || importBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} />
              <span className="ml-auto text-xs text-muted-foreground">{brief.goal.length} / {goalLimit}</span>
            </div>
            {inputError && <p role="alert" className="mt-2 text-sm text-destructive">{t(inputError)}</p>}
          </div>
          <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)} className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t("research.intake.details")}</summary><div className="mt-3 space-y-3">
          <Field label={t(optionalBriefLabels.topic)}><Input value={brief.topic} {...fieldConstraints("topic")} onChange={(event) => patch("topic", event.target.value)} data-testid="research-brief-topic" aria-label={t("research.intake.topic")} /></Field>
          <div className="grid gap-4 md:grid-cols-2"><Field label={t(optionalBriefLabels.timeRange)}><Input value={brief.timeRange} {...fieldConstraints("timeRange")} onChange={(event) => patch("timeRange", event.target.value)} data-testid="research-brief-time" aria-label={t("research.intake.timeRange")} /></Field><Field label={t(optionalBriefLabels.region)}><Input value={brief.region} {...fieldConstraints("region")} onChange={(event) => patch("region", event.target.value)} data-testid="research-brief-region" aria-label={t("research.intake.region")} /></Field></div>
          <Field label={t(optionalBriefLabels.focus)}><Textarea value={brief.focus} {...fieldConstraints("focus")} onChange={(event) => patch("focus", event.target.value)} data-testid="research-brief-focus" aria-label={t("research.intake.focus")} /></Field>
          </div></details>
          {optionalErrors.map((key) => <p key={key} id={`research-brief-${key}-error`} role="alert" className="text-sm text-destructive">{t("research.intake.fieldLimit", { field: t(optionalBriefLabels[key]), count: briefShape[key].maxLength! })}</p>)}
          {submitFailed && <p className="text-sm text-destructive" role="alert" data-testid="err-research-create">{t("research.intake.createFailed")}</p>}
          <WorkflowActionBar placement="footer"><WorkflowActionButton variant="primary" disabled={submitting || voiceBusy || importBusy || !briefValid || brief.goal.length > goalLimit || !brief.goal.trim() || Boolean(sessionId && !brief.topic.trim())} onClick={() => void confirm()} data-testid="research-confirm-brief">{t(submitting ? "research.intake.creating" : "research.intake.next")}<ArrowRight className="size-4" aria-hidden /></WorkflowActionButton></WorkflowActionBar>
          {brief.goal.length > goalLimit && <p id="research-goal-error" role="alert" className="text-sm text-destructive">{t("research.intake.goalLimit", { count: goalLimit })}</p>}
        </CardContent></Card>
      </div>
      </div>}
    </GuidedResearchStepLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-12 font-medium text-background-foreground">{label}{hint && <span className="font-normal text-muted-foreground">{hint}</span>}{children}</label>;
}

function useIntakeAssistant(brief: Brief, onApply: (brief: Brief) => void) {
  const { t } = useI18n();
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [proposal, setProposal] = React.useState<Brief | null>(null);
  const [reply, setReply] = React.useState("");
  const [error, setError] = React.useState(false);
  async function send() {
    if (!message.trim() || pending) return;
    setPending(true); setError(false); setProposal(null);
    try {
      // Keep the message as the initial goal; the generated proposal still needs adoption.
      const value = { ...brief, topic: brief.topic.trim() || DEFAULT_RESEARCH_NAME, goal: brief.goal.trim() || message.trim() };
      const result = await runGuidedResearchSkillTurn({ requestId: requestId("intake-skill"), message: message.trim(), draft: { node: "brief", value } });
      setReply(result.assistantMessage);
      if (result.proposal.node === "brief") setProposal(result.proposal.value);
    } catch { setError(true); } finally { setPending(false); }
  }
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">{t("research.assistant.applyHint")}</p><Textarea aria-label={t("research.assistant.discuss")} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} /><Button disabled={pending || !message.trim()} onClick={() => void send()}>{t(pending ? "research.assistant.generating" : "research.assistant.send")}</Button>{error && <p role="alert">{t("research.assistant.failed")}</p>}{reply && <p className="whitespace-pre-wrap">{reply}</p>}{proposal && <Button onClick={() => { onApply(proposal); setProposal(null); }}>{t("research.assistant.apply")}</Button>}</div>;
}
