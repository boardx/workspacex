"use client";
import * as React from "react";
import { ArrowRight, Mic, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ResearchPrototypeTips } from "./research-prototype-tips";
import { ResearchLoading } from "./guided-research-presentation";
import { GuidedResearchStepLayout } from "./guided-research-step-layout";
import type { GuidedResearchCreateDraft } from "./create-guided-research-dialog";
import { createGuidedResearchSession, getResearchRuntime, executeResearchRuntime, confirmResearchBrief, executeGuidedResearchNodeCommand, getGuidedResearchSession, runGuidedResearchSkillTurn, type GuidedResearchSession, type GuidedResearchWorkflowProjection } from "@/lib/guided-research-api";
type Brief = GuidedResearchSession["brief"];
type Step = "home" | "brief" | "directions" | "outline" | "search" | "report";
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

function pendingCreateIdempotencyKey(intent: GuidedResearchCreateDraft & { brief: Brief }): { key: string; storageKey: string } {
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
  const [brief, setBrief] = React.useState(initialBrief);
  const baseline = session?.brief ?? initialBrief;
  React.useEffect(() => { onDirtyChange?.(JSON.stringify(brief) !== JSON.stringify(baseline)); }, [brief, baseline, onDirtyChange]);
  const assistant = useIntakeAssistant(brief, setBrief);
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [createDraft] = React.useState<GuidedResearchCreateDraft>(() => {
    try {
      const stored = window.sessionStorage.getItem(CREATE_DRAFT_KEY);
      if (!stored) return { title: initialBrief.topic, tags: [] };
      const parsed = JSON.parse(stored) as Partial<GuidedResearchCreateDraft>;
      return {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : initialBrief.topic,
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 5) : [],
      };
    } catch {
      return { title: initialBrief.topic, tags: [] };
    }
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [submitFailed, setSubmitFailed] = React.useState(false);
  const patch = (key: keyof typeof brief, value: string) => setBrief((current) => ({ ...current, [key]: value }));
  React.useEffect(() => {
    if (session) setBrief({ ...session.brief });
  }, [session]);
  const confirm = async () => {
    if (submitting || !brief.goal.trim()) return;
    // The import screen asks for one description. Until the next screen refines
    // the topic, use the user's words, not an invented model suggestion.
    const confirmedBrief = { ...brief, topic: brief.topic.trim() || brief.goal.trim().slice(0, 200) };
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
        onNavigate("directions", sessionId);
        return;
      }
      const pending = pendingCreateIdempotencyKey({ ...createDraft, brief: confirmedBrief });
      const createdSession = await createGuidedResearchSession({ ...createDraft, title: createDraft.title || confirmedBrief.topic, tags: [...createDraft.tags], idempotencyKey: pending.key, collaboratorUserIds: [], brief: confirmedBrief });
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
        if (runtime.version === 0 && runtime.currentNode === "brief" && !runtime.busy && !runtime.legacyCheckpoint) {
          runtime = await executeResearchRuntime({
            sessionId: createdSession.sessionId, node: "brief", action: "confirm",
            requestId: requestId("brief-confirm"), expectedVersion: runtime.version,
            draft: { node: "brief", value: confirmedBrief },
          });
        }
      } catch {
        if (!active.current) return;
        try { runtime = await getResearchRuntime(createdSession.sessionId); } catch { /* Live offers read-only recovery. */ }
      }
      if (!active.current) return;
      window.localStorage.removeItem(pending.storageKey);
      window.sessionStorage.removeItem(CREATE_DRAFT_KEY);
      onClear?.();
      onSession(createdSession);
      const node = runtime?.currentNode;
      onNavigate(node === "research" ? "search" : node ?? "brief", createdSession.sessionId);
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
      {sessionId && <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-12 text-warning-foreground">重新确认后，后续演示结果将重新生成。</p>}
      <div className="grid items-stretch gap-4 lg:min-h-[calc(100dvh-17rem)] lg:grid-cols-[minmax(0,2.05fr)_minmax(19rem,1fr)]">
        <Card className="flex rounded-xl"><CardContent className="flex w-full flex-col gap-3 p-5">
          <h2 className="text-xl font-bold">告诉 AI 你想研究什么</h2>
          <div className="flex min-h-56 flex-1 flex-col rounded-lg border border-border p-4">
            <Textarea value={brief.goal} maxLength={2000} onChange={(event) => patch("goal", event.target.value)} data-testid="research-brief-goal" aria-label="研究目标" className="min-h-48 flex-1 resize-y border-0 p-0 text-sm leading-relaxed shadow-none focus-visible:ring-2" placeholder={"请描述你的研究需求，例如：\n\n• 研究目标：你希望解决什么问题？\n• 研究区域 / 对象：研究的行业、地区、人群或具体对象是？\n• 时间范围：关注的时间段是什么？\n• 重点关注：你最关心哪些方面？\n• 关键问题：你希望从研究中获得哪些核心结论或答案？\n\n你也可以直接粘贴相关文档内容。"} />
            <div className="mt-3 flex flex-wrap items-center gap-2"><Button variant="outline" className="h-9 px-4 text-sm" disabled title="当前环境尚未配置实时录音"><Mic className="mr-2 size-4" />录音</Button><Button variant="outline" className="h-9 px-4 text-sm" disabled title="当前环境尚未配置文件导入"><Upload className="mr-2 size-4" />上传文件</Button><span className="ml-auto text-xs text-muted-foreground">{brief.goal.length} / 2000</span></div>
          </div>
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">完善研究信息</summary><div className="mt-4 space-y-4">
          <Field label="研究主题"><Input value={brief.topic} onChange={(event) => patch("topic", event.target.value)} data-testid="research-brief-topic" aria-label="研究主题" /></Field>
          <div className="grid gap-4 md:grid-cols-2"><Field label="时间范围"><Input value={brief.timeRange} onChange={(event) => patch("timeRange", event.target.value)} data-testid="research-brief-time" aria-label="时间范围" /></Field><Field label="地域范围"><Input value={brief.region} onChange={(event) => patch("region", event.target.value)} data-testid="research-brief-region" aria-label="地域范围" /></Field></div>
          <Field label="重点关注"><Textarea value={brief.focus} onChange={(event) => patch("focus", event.target.value)} data-testid="research-brief-focus" aria-label="重点关注" /></Field>
          </div></details>
          {submitFailed && <p className="text-11 text-destructive" role="alert">研究创建失败，请重试。再次提交不会重复创建。</p>}
          <div className="mt-auto flex justify-end"><Button variant="primary" className="h-9 px-5 text-sm" disabled={submitting || !brief.goal.trim() || Boolean(sessionId && !brief.topic.trim())} onClick={() => void confirm()} data-testid="research-confirm-brief">{submitting ? "正在创建…" : "下一步：确认研究主题"}<ArrowRight className="size-4" aria-hidden /></Button></div>
        </CardContent></Card>
        <ResearchPrototypeTips />
      </div>
      </div>}
    </GuidedResearchStepLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-12 font-medium text-background-foreground">{label}{hint && <span className="font-normal text-muted-foreground">{hint}</span>}{children}</label>;
}

function useIntakeAssistant(brief: Brief, onApply: (brief: Brief) => void) {
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [proposal, setProposal] = React.useState<Brief | null>(null);
  const [reply, setReply] = React.useState("");
  const [error, setError] = React.useState(false);
  async function send() {
    if (!message.trim() || pending) return;
    setPending(true); setError(false); setProposal(null);
    try {
      // An empty intake has no saved topic yet. Use only the user's own words
      // as provisional context; the generated proposal still needs adoption.
      const value = { ...brief, topic: brief.topic.trim() || message.trim().slice(0, 200), goal: brief.goal.trim() || message.trim() };
      const result = await runGuidedResearchSkillTurn({ requestId: requestId("intake-skill"), message: message.trim(), draft: { node: "brief", value } });
      setReply(result.assistantMessage);
      if (result.proposal.node === "brief") setProposal(result.proposal.value);
    } catch { setError(true); } finally { setPending(false); }
  }
  return <div className="space-y-4"><h2 className="font-semibold">研究助手</h2><p className="text-sm text-muted-foreground">建议只有点击应用后才会修改研究内容。</p><Textarea aria-label="和研究助手讨论" maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} /><Button disabled={pending || !message.trim()} onClick={() => void send()}>{pending ? "正在生成…" : "发送"}</Button>{error && <p role="alert">助手暂时不可用，请重试。</p>}{reply && <p className="whitespace-pre-wrap">{reply}</p>}{proposal && <Button onClick={() => { onApply(proposal); setProposal(null); }}>应用建议</Button>}</div>;
}
