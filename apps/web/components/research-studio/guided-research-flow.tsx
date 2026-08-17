"use client";

import * as React from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Circle,
  Clock3, FileSearch, FileText, Globe2, GripVertical, ListTree, Loader2, Pencil,
  LockKeyhole, Plus, RotateCcw, Search, Sparkles, Target, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { CreateGuidedResearchDialog, type GuidedResearchCreateDraft } from "./create-guided-research-dialog";
import { cn } from "@/lib/utils";
import {
  createGuidedResearchSession,
  confirmResearchBrief,
  confirmResearchDirections,
  confirmResearchOutline,
  generateResearchDirections,
  generateResearchOutline,
  getGuidedResearchSession,
  getGuidedResearchWorkflow,
  executeGuidedResearchNodeCommand,
  listGuidedResearchSessions,
  finishGuidedResearchCollection,
  completeGuidedResearchSession,
  type GuidedResearchDirection,
  type GuidedResearchOutlineSection,
  type GuidedResearchSession,
  type GuidedResearchWorkflowProjection,
} from "@/lib/guided-research-api";
import {
  GUIDED_REPORT_CITATIONS,
  GUIDED_RESEARCH_BRIEF,
  GUIDED_RESEARCH_OUTLINE,
  GUIDED_SEARCH_SOURCES,
  GUIDED_SEARCH_TASKS,
  type GuidedResearchStep,
} from "@/lib/mock/guided-research";
import {
  advanceDemoTask,
  clearGuidedResearchDemoState,
  decideDemoSource,
  loadGuidedResearchDemoState,
  saveGuidedResearchDemoState,
  type GuidedResearchDemoState,
} from "@/lib/mock/guided-research-demo-state";
import { clampGuidedResearchStep, maxGuidedResearchStep } from "@/lib/guided-research-stage";
import { clearResearchSkillState } from "@/lib/guided-research-skill-state";
import { GuidedResearchSkillAssistant } from "./guided-research-skill-assistant";
import { GuidedResearchStepLayout } from "./guided-research-step-layout";

const SESSION_REQUIRED_STEPS: readonly GuidedResearchStep[] = ["directions", "outline", "search", "report"];
const WORKFLOW_STEP_INDEX: Record<Exclude<GuidedResearchStep, "home">, number> = {
  brief: 1,
  directions: 2,
  outline: 3,
  search: 4,
  report: 5,
};

function clampSessionlessStep(step: GuidedResearchStep, sessionId?: string): GuidedResearchStep {
  return !sessionId && SESSION_REQUIRED_STEPS.includes(step) ? "home" : step;
}

function progressLabel(step: Exclude<GuidedResearchStep, "home">): string {
  return `${WORKFLOW_STEP_INDEX[step]}/5`;
}

function stageToStep(stage: GuidedResearchSession["resumeStage"]): GuidedResearchStep {
  return stage === "researching" ? "search" : stage;
}

function requestId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function workflowGraphVersion(workflow: GuidedResearchWorkflowProjection | null): number | null {
  return typeof workflow?.graphVersion === "number" ? workflow.graphVersion : null;
}

function briefNodeState(session: GuidedResearchSession | null, brief: typeof GUIDED_RESEARCH_BRIEF) {
  return {
    name: session?.title ?? brief.topic,
    tags: session?.tags ?? [],
    topic: brief.topic,
    objective: brief.goal,
    timeRange: brief.timeRange,
    geography: brief.region,
    focus: brief.focus,
  };
}

function outlineNodeState(sections: GuidedResearchOutlineSection[]) {
  return {
    sections: sections.map((item, order) => ({
      id: item.id,
      title: item.title,
      description: "",
      researchQuestions: [...item.questions],
      order,
    })),
  };
}

function researchNodeState(demoState: GuidedResearchDemoState) {
  const acceptedSourceIds: string[] = [];
  const excludedSourceIds: string[] = [];
  for (const [sourceId, decision] of Object.entries(demoState.sourceDecisions)) {
    if (decision === "accepted") acceptedSourceIds.push(sourceId);
    if (decision === "excluded") excludedSourceIds.push(sourceId);
  }
  return { acceptedSourceIds, excludedSourceIds };
}

async function restoreWorkflow(sessionId: string): Promise<GuidedResearchWorkflowProjection | null> {
  try {
    return await getGuidedResearchWorkflow(sessionId);
  } catch {
    return null;
  }
}

export function GuidedResearchFlow({
  step,
  sessionId,
  onStepChange,
}: {
  step: GuidedResearchStep;
  sessionId?: string;
  onStepChange?: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const [restoredStep, setRestoredStep] = React.useState(() => clampSessionlessStep(step, sessionId));
  const [activeSessionId, setActiveSessionId] = React.useState(sessionId);
  const [restoreFailed, setRestoreFailed] = React.useState(false);
  const [sessionSnapshot, setSessionSnapshot] = React.useState<GuidedResearchSession | null>(null);
  const [workflowSnapshot, setWorkflowSnapshot] = React.useState<GuidedResearchWorkflowProjection | null>(null);
  React.useEffect(() => {
    setRestoredStep(clampSessionlessStep(step, sessionId));
    setActiveSessionId(sessionId);
    setRestoreFailed(false);
    setSessionSnapshot(null);
    setWorkflowSnapshot(null);
    if (!sessionId) return;
    let active = true;
    Promise.all([getGuidedResearchSession(sessionId), restoreWorkflow(sessionId)])
      .then(([session, workflow]) => {
        if (!active) return;
        const requestedStep = step === "home" ? stageToStep(session.resumeStage) : step;
        const allowedStep = clampGuidedResearchStep(requestedStep, session);
        setRestoredStep(allowedStep);
        setActiveSessionId(session.sessionId);
        setSessionSnapshot(session);
        setWorkflowSnapshot(workflow);
      })
      .catch(() => { if (active) setRestoreFailed(true); });
    return () => { active = false; };
  }, [sessionId, step]);

  const navigate = (next: GuidedResearchStep, sessionId?: string) => {
    const targetSessionId = next === "home" ? undefined : sessionId ?? activeSessionId;
    if (onStepChange) return onStepChange(next, targetSessionId);
    setRestoredStep(next);
    setActiveSessionId(targetSessionId);
    window.history.replaceState({}, "", targetSessionId ? `/research?session=${encodeURIComponent(targetSessionId)}` : "/research");
  };

  const hasCurrentSessionSnapshot = sessionSnapshot?.sessionId === sessionId;
  const restoringSession = Boolean(sessionId) && !hasCurrentSessionSnapshot && !restoreFailed;
  const restorationBlocked = restoringSession || restoreFailed;

  return (
    <div
      className="mx-auto flex w-full max-w-none flex-col gap-4 pb-8"
      data-testid={restorationBlocked ? "research-session-restore" : `research-flow-${restoredStep}`}
      data-layout="signed-desktop"
    >
      {restoringSession ? (
        <p className="rounded-md border border-border bg-muted p-3 text-12 text-muted-foreground" data-testid="research-session-restore-loading" role="status">正在恢复研究会话…</p>
      ) : restoreFailed ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-12 text-destructive" data-testid="research-session-restore-error">研究会话恢复失败，请返回首页后重试。</p>
      ) : (
        <>
          {restoredStep !== "home" && (
            <div
              className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
              data-testid="research-progress-shell"
              data-layout="right-aligned-progress"
            >
              <div aria-hidden className="hidden lg:block" />
              <FlowProgress step={restoredStep} maxStep={sessionSnapshot ? maxGuidedResearchStep(sessionSnapshot) : restoredStep} onBack={() => navigate("home")} onNavigate={navigate} />
            </div>
          )}
          {restoredStep === "home" && <ResearchHome onNavigate={navigate} />}
          {restoredStep === "brief" && <BriefScreen sessionId={activeSessionId} session={sessionSnapshot} workflow={workflowSnapshot} onSession={setSessionSnapshot} onWorkflow={setWorkflowSnapshot} onNavigate={navigate} />}
          {restoredStep === "directions" && <DirectionsScreen sessionId={activeSessionId} session={sessionSnapshot} workflow={workflowSnapshot} onSession={setSessionSnapshot} onWorkflow={setWorkflowSnapshot} onNavigate={navigate} />}
          {restoredStep === "outline" && <OutlineScreen sessionId={activeSessionId} session={sessionSnapshot} workflow={workflowSnapshot} onSession={setSessionSnapshot} onWorkflow={setWorkflowSnapshot} onNavigate={navigate} />}
          {restoredStep === "search" && <SearchScreen sessionId={activeSessionId} session={sessionSnapshot} workflow={workflowSnapshot} onSession={setSessionSnapshot} onWorkflow={setWorkflowSnapshot} onNavigate={navigate} />}
          {restoredStep === "report" && <ReportScreen sessionId={activeSessionId} session={sessionSnapshot} workflow={workflowSnapshot} onSession={setSessionSnapshot} onWorkflow={setWorkflowSnapshot} onNavigate={navigate} />}
        </>
      )}
    </div>
  );
}

function FlowProgress({ step, maxStep, onBack, onNavigate }: {
  step: GuidedResearchStep;
  maxStep: GuidedResearchStep;
  onBack: () => void;
  onNavigate: (step: GuidedResearchStep) => void;
}) {
  const steps: Array<{ id: GuidedResearchStep; label: string }> = [
    { id: "brief", label: "确认主题" },
    { id: "directions", label: "研究方向" },
    { id: "outline", label: "报告大纲" },
    { id: "search", label: "资料研究" },
    { id: "report", label: "研究报告" },
  ];
  const current = steps.findIndex((item) => item.id === step);
  const maximum = steps.findIndex((item) => item.id === maxStep);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2" data-density="compact" data-testid="research-flow-progress">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="research-flow-back"><ArrowLeft className="h-4 w-4" />返回</Button>
        <div className="grid min-w-0 flex-1 grid-cols-5 gap-2">
          {steps.map((item, index) => (
            <div key={item.id} className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                disabled={index > maximum}
                aria-current={index === current ? "step" : undefined}
                onClick={() => onNavigate(item.id)}
                className={cn(
                  "flex min-w-0 items-center gap-2 text-left disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
                  index === current ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                <span className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-10 transition-colors",
                  index < current && "border-primary bg-primary text-primary-foreground",
                  index === current && "border-primary bg-accent text-accent-foreground",
                  index > current && "border-border text-muted-foreground",
                )}>{index < current ? <Check className="h-3 w-3" /> : index > maximum ? <LockKeyhole className="h-3 w-3" aria-hidden /> : index + 1}</span>
                <span className="truncate text-11">{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div className="space-y-1">
        <p className="text-11 font-medium uppercase tracking-wider text-primary">{eyebrow}</p>
        <h1 className="text-24 font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="max-w-2xl text-13 leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function ResearchHome({ onNavigate }: { onNavigate: (step: GuidedResearchStep, sessionId?: string) => void }) {
  const [history, setHistory] = React.useState<GuidedResearchSession[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    listGuidedResearchSessions()
      .then((result) => { if (active) setHistory(result.items); })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, []);
  return (
    <section data-testid="research-home-page" className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-5 py-6 md:px-8 lg:px-10">
      <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <p className="text-11 font-medium text-muted-foreground">Studio&nbsp;&nbsp;/&nbsp;&nbsp;研究</p>
          <h1 className="text-24 font-semibold tracking-tight text-foreground">研究</h1>
          <p className="max-w-2xl text-12 leading-relaxed text-muted-foreground">从一个明确的问题开始，让 AI 帮你拆方向、定大纲、检索资料并生成带引用的完整报告。</p>
        </div>
        <Button variant="primary" size="lg" onClick={() => setCreateOpen(true)} data-testid="research-create"><Plus className="h-4 w-4" />创建研究</Button>
      </header>
      <Card className="border-primary/20 bg-accent/40">
        <CardContent className="flex flex-col items-start justify-between gap-4 p-5 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-primary p-2 text-primary-foreground"><Sparkles className="h-5 w-5" /></span>
            <div><h2 className="text-15 font-semibold">开始一项新的深度研究</h2><p className="mt-1 text-12 text-muted-foreground">确认主题后，研究方向和报告大纲都可以在执行前编辑。</p></div>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)} data-testid="research-create-hero">描述研究主题<ArrowRight className="h-4 w-4" /></Button>
        </CardContent>
      </Card>
      <section className="space-y-3" data-testid="research-history">
        <div className="flex items-center justify-between"><h2 className="text-16 font-semibold">历史研究</h2><span className="text-11 text-muted-foreground">{history?.length ?? 0} 项</span></div>
        {history === null && !loadFailed && <p className="text-12 text-muted-foreground" data-testid="research-history-loading">正在加载历史研究…</p>}
        {loadFailed && <p className="rounded-lg border border-destructive bg-card p-6 text-12 text-destructive" data-testid="research-history-error">历史研究加载失败，请稍后重试。</p>}
        {history?.length === 0 && <p className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-6 text-center text-12 text-muted-foreground" data-testid="research-history-empty">还没有研究，先创建一项吧。</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {history?.map((item) => (
            <Card key={item.sessionId} className="flex min-h-64 h-full flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" data-testid={`research-history-${item.sessionId}`}>
              <CardHeader className="space-y-3 p-0 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={item.status === "completed" ? "primary" : item.stage === "researching" ? "warning" : "outline"}>{item.status === "completed" ? "已完成" : item.stage === "researching" ? "研究中" : "待继续"}</Badge>
                  <span className="flex items-center gap-1 text-10 text-muted-foreground"><Clock3 className="h-3 w-3" />{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span>
                </div>
                <CardTitle className="text-16 leading-snug">{item.title}</CardTitle>
                {item.tags?.length > 0 && <div className="flex flex-wrap gap-1.5">{item.tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}</div>}
                <p className="min-h-10 text-11 leading-relaxed text-muted-foreground">{item.brief.goal}</p>
              </CardHeader>
              <CardContent className="mt-auto space-y-3 p-0 pt-2">
                <div className="space-y-1.5"><div className="flex justify-between text-10 text-muted-foreground"><span>{item.progress}%</span><span>{item.sourceCount} 个来源</span></div><Progress value={item.progress} /></div>
                {item.status === "completed" ? (
                  <Button className="w-full" variant="outline" onClick={() => onNavigate("report", item.sessionId)} data-testid={`research-view-${item.sessionId}`}><FileText className="h-4 w-4" />查看报告</Button>
                ) : (
                  <Button className="w-full" variant="secondary" onClick={() => onNavigate(stageToStep(item.resumeStage), item.sessionId)} data-testid={`research-continue-${item.sessionId}`}><RotateCcw className="h-4 w-4" />继续研究</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <CreateGuidedResearchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onContinue={(draft) => {
          clearResearchSkillState("pending-brief");
          window.sessionStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(draft));
          onNavigate("brief");
        }}
      />
    </section>
  );
}

const CREATE_DRAFT_KEY = "wsx.guidedResearch.createDraft";
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

function pendingCreateIdempotencyKey(intent: GuidedResearchCreateDraft & { brief: typeof GUIDED_RESEARCH_BRIEF }): { key: string; storageKey: string } {
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

function BriefScreen({ sessionId, session, workflow, onSession, onWorkflow, onNavigate }: {
  sessionId?: string;
  session: GuidedResearchSession | null;
  workflow: GuidedResearchWorkflowProjection | null;
  onSession: (session: GuidedResearchSession) => void;
  onWorkflow: (workflow: GuidedResearchWorkflowProjection | null) => void;
  onNavigate: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const [brief, setBrief] = React.useState(GUIDED_RESEARCH_BRIEF);
  const [createDraft] = React.useState<GuidedResearchCreateDraft>(() => {
    try {
      const stored = window.sessionStorage.getItem(CREATE_DRAFT_KEY);
      if (!stored) return { title: GUIDED_RESEARCH_BRIEF.topic, tags: [] };
      const parsed = JSON.parse(stored) as Partial<GuidedResearchCreateDraft>;
      return {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : GUIDED_RESEARCH_BRIEF.topic,
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 5) : [],
      };
    } catch {
      return { title: GUIDED_RESEARCH_BRIEF.topic, tags: [] };
    }
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [submitFailed, setSubmitFailed] = React.useState(false);
  const patch = (key: keyof typeof brief, value: string) => setBrief((current) => ({ ...current, [key]: value }));
  React.useEffect(() => {
    if (session) setBrief({ ...session.brief });
  }, [session]);
  const confirm = async () => {
    setSubmitting(true);
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
        clearGuidedResearchDemoState(sessionId);
        onSession(updated);
        onNavigate("directions", sessionId);
        return;
      }
      const pending = pendingCreateIdempotencyKey({ ...createDraft, brief });
      const createdSession = await createGuidedResearchSession({ ...createDraft, tags: [...createDraft.tags], idempotencyKey: pending.key, collaboratorUserIds: [], brief });
      window.localStorage.removeItem(pending.storageKey);
      window.sessionStorage.removeItem(CREATE_DRAFT_KEY);
      clearResearchSkillState("pending-brief");
      onSession(createdSession);
      onNavigate("directions", createdSession.sessionId);
    } catch {
      setSubmitFailed(true);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <GuidedResearchStepLayout
      assistant={
        <GuidedResearchSkillAssistant
          step="brief"
          progressLabel={progressLabel("brief")}
          sessionKey={sessionId ? `${sessionId}:brief` : "pending-brief"}
          snapshot={{ step: "brief", value: brief }}
          onSnapshotChange={(next) => {
            if (next.step === "brief") setBrief(next.value);
          }}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-density="compact-step">
      <PageHeading eyebrow="Step 1 · Research brief" title="确认研究主题与范围" description="先把问题边界说清楚。后续生成的研究方向、大纲和检索词都会以这份 brief 为准。" />
      {sessionId && <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-12 text-warning-foreground">重新确认后，后续演示结果将重新生成。</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <Card><CardContent className="space-y-4 p-4">
          <Field label="研究主题" hint="用一句话说明要研究什么"><Input value={brief.topic} onChange={(event) => patch("topic", event.target.value)} data-testid="research-brief-topic" aria-label="研究主题" /></Field>
          <Field label="研究目标" hint="最终希望做出什么判断"><Textarea value={brief.goal} onChange={(event) => patch("goal", event.target.value)} data-testid="research-brief-goal" aria-label="研究目标" /></Field>
          <div className="grid gap-4 md:grid-cols-2"><Field label="时间范围"><Input value={brief.timeRange} onChange={(event) => patch("timeRange", event.target.value)} data-testid="research-brief-time" aria-label="时间范围" /></Field><Field label="地域范围"><Input value={brief.region} onChange={(event) => patch("region", event.target.value)} data-testid="research-brief-region" aria-label="地域范围" /></Field></div>
          <Field label="重点关注"><Textarea value={brief.focus} onChange={(event) => patch("focus", event.target.value)} data-testid="research-brief-focus" aria-label="重点关注" /></Field>
          {submitFailed && <p className="text-11 text-destructive" role="alert">研究创建失败，请重试。再次提交不会重复创建。</p>}
          <div className="flex justify-end"><Button variant="primary" disabled={submitting || !brief.topic.trim() || !brief.goal.trim()} onClick={() => void confirm()} data-testid="research-confirm-brief">{submitting ? "正在创建…" : "确认并生成研究方向"}<ArrowRight className="h-4 w-4" /></Button></div>
        </CardContent></Card>
        <Card className="h-fit"><CardHeader><CardTitle className="flex items-center gap-2 text-14"><Target className="h-4 w-4" />本次研究将回答</CardTitle></CardHeader><CardContent className="space-y-3 text-11 leading-relaxed text-muted-foreground"><p>哪些欧洲市场同时具备增长、政策与并网确定性？</p><p>适合以自建、合资还是渠道合作进入？</p><p>未来 90 天最优先验证哪些假设？</p><div className="rounded-md border border-border bg-muted p-3 text-10">可在下一步逐条修改或删除 AI 建议的研究方向。</div></CardContent></Card>
      </div>
      </div>
    </GuidedResearchStepLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-12 font-medium text-foreground">{label}{hint && <span className="font-normal text-muted-foreground">{hint}</span>}{children}</label>;
}

function DirectionsScreen({ sessionId, session, workflow, onSession, onWorkflow, onNavigate }: {
  sessionId?: string; session: GuidedResearchSession | null; workflow: GuidedResearchWorkflowProjection | null; onSession: (session: GuidedResearchSession) => void; onWorkflow: (workflow: GuidedResearchWorkflowProjection | null) => void;
  onNavigate?: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const [directions, setDirections] = React.useState<GuidedResearchDirection[]>([]);
  const [candidateVersion, setCandidateVersion] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const apply = React.useCallback((next: GuidedResearchSession) => {
    onSession(next);
    const version = next.directions.versions.find((item) => item.version === next.directions.candidateVersion)
      ?? next.directions.versions.find((item) => item.version === next.directions.confirmedVersion);
    setCandidateVersion(next.directions.candidateVersion);
    setDirections((version?.items ?? []).map((item) => ({ ...item })));
  }, [onSession]);
  React.useEffect(() => {
    if (!sessionId || !session) return;
    if (session.directions.candidateVersion !== null) {
      if (candidateVersion !== session.directions.candidateVersion) apply(session);
      return;
    }
    if (candidateVersion === null && directions.length === 0) {
      void (async () => {
        const graphVersion = workflowGraphVersion(workflow);
        if (graphVersion === null || directions.length === 0) return generateResearchDirections(sessionId);
        const projection = await executeGuidedResearchNodeCommand(sessionId, {
          node: "directions",
          action: "generate",
          requestId: requestId("directions-generate"),
          expectedGraphVersion: graphVersion,
          nodeState: { directions: [] },
        });
        onWorkflow(projection);
        return getGuidedResearchSession(sessionId);
      })().then(apply).catch(() => undefined);
    }
  }, [apply, candidateVersion, directions.length, onWorkflow, session, sessionId, workflow]);
  const patch = (id: string, update: Partial<GuidedResearchDirection>) => setDirections((items) => items.map((item) => item.id === id ? { ...item, ...update } : item));
  const add = () => setDirections((items) => [...items, { id: `d${items.length + 1}`, title: "新的研究方向", description: "补充这个方向需要回答的核心问题。", enabled: true, order: items.length }]);
  const regenerate = async () => {
    if (!sessionId) return;
    setSubmitting(true);
    try {
      const graphVersion = workflowGraphVersion(workflow);
      if (graphVersion === null) {
        apply(await generateResearchDirections(sessionId));
      } else {
        const projection = await executeGuidedResearchNodeCommand(sessionId, {
          node: "directions",
          action: "generate",
          requestId: requestId("directions-generate"),
          expectedGraphVersion: graphVersion,
          nodeState: { directions: directions.map((item, order) => ({ ...item, order })) },
        });
        onWorkflow(projection);
        apply(await getGuidedResearchSession(sessionId));
      }
    } finally { setSubmitting(false); }
  };
  const confirm = async () => {
    if (!sessionId || candidateVersion === null) return;
    setSubmitting(true);
    setSaveFailed(false);
    try {
      const nodeState = { directions: directions.map((item, order) => ({ ...item, order })) };
      const graphVersion = workflowGraphVersion(workflow);
      const updated = graphVersion === null
        ? await confirmResearchDirections(sessionId, { candidateVersion, directions: nodeState.directions })
        : await executeGuidedResearchNodeCommand(sessionId, {
          node: "directions",
          action: "confirm",
          requestId: requestId("directions-confirm"),
          expectedGraphVersion: graphVersion,
          nodeState,
        }).then(async (projection) => {
          onWorkflow(projection);
          return getGuidedResearchSession(sessionId);
        });
      apply(updated);
      clearGuidedResearchDemoState(sessionId);
      onNavigate?.("outline", sessionId);
    }
    catch { setSaveFailed(true); }
    finally { setSubmitting(false); }
  };
  return (
    <GuidedResearchStepLayout
      assistant={
        <GuidedResearchSkillAssistant
          step="directions"
          progressLabel={progressLabel("directions")}
          sessionKey={`${sessionId ?? "pending"}:directions`}
          snapshot={{ step: "directions", value: directions }}
          onSnapshotChange={(next) => {
            if (next.step === "directions") setDirections(next.value);
          }}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-density="compact-step">
      <PageHeading eyebrow="Step 2 · Directions" title="编辑研究方向" description="AI 根据主题生成了互补方向。重新生成只创建候选版本，不会覆盖最近一次人工确认。" action={<Button variant="outline" disabled={submitting || !sessionId} onClick={() => void regenerate()} data-testid="research-regenerate-directions"><Sparkles className="h-4 w-4" />重新生成</Button>} />
      {session && maxGuidedResearchStep(session) !== "directions" && <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-12 text-warning-foreground">重新确认后，后续演示结果将重新生成。</p>}
      <div className="space-y-3" data-testid="research-directions">
        {directions.map((direction, index) => <Card key={direction.id} className={cn("transition-colors", !direction.enabled && "bg-muted")} data-testid={`research-direction-${direction.id}`}><CardContent className="flex gap-3 p-4"><GripVertical className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" /><Button variant="outline" size="icon" aria-label={`启用方向 ${index + 1}`} onClick={() => patch(direction.id, { enabled: !direction.enabled })} className="mt-1 h-6 w-6 shrink-0">{direction.enabled && <Check className="h-3 w-3" />}</Button><div className="min-w-0 flex-1 space-y-2"><Input value={direction.title} onChange={(event) => patch(direction.id, { title: event.target.value })} data-testid={`research-direction-title-${direction.id}`} aria-label={`研究方向 ${index + 1} 标题`} /><Textarea value={direction.description} onChange={(event) => patch(direction.id, { description: event.target.value })} data-testid={`research-direction-description-${direction.id}`} aria-label={`研究方向 ${index + 1} 描述`} /></div><Button variant="ghost" size="icon" aria-label={`删除方向 ${index + 1}`} onClick={() => setDirections((items) => items.filter((item) => item.id !== direction.id))}><Trash2 className="h-4 w-4" /></Button></CardContent></Card>)}
        <Button variant="outline" className="w-full border-dashed" onClick={add} data-testid="research-add-direction"><Plus className="h-4 w-4" />添加研究方向</Button>
      </div>
      {saveFailed && <p className="text-12 text-destructive" role="alert">研究方向保存失败，请重试。</p>}
      <div className="flex justify-end"><Button variant="primary" disabled={submitting || candidateVersion === null || !directions.some((item) => item.enabled)} onClick={() => void confirm()} data-testid="research-confirm-directions">生成报告大纲<ArrowRight className="h-4 w-4" /></Button></div>
      </div>
    </GuidedResearchStepLayout>
  );
}

function OutlineScreen({ sessionId, session, workflow, onSession, onWorkflow, onNavigate }: {
  sessionId?: string; session: GuidedResearchSession | null; workflow: GuidedResearchWorkflowProjection | null; onSession: (session: GuidedResearchSession) => void; onWorkflow: (workflow: GuidedResearchWorkflowProjection | null) => void;
  onNavigate?: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const [sections, setSections] = React.useState<GuidedResearchOutlineSection[]>([]);
  const [candidateVersion, setCandidateVersion] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const apply = React.useCallback((next: GuidedResearchSession) => {
    onSession(next);
    const version = next.outline.versions.find((item) => item.version === next.outline.candidateVersion)
      ?? next.outline.versions.find((item) => item.version === next.outline.confirmedVersion);
    setCandidateVersion(next.outline.candidateVersion);
    setSections((version?.items ?? []).map((item) => ({ ...item, questions: [...item.questions] })));
  }, [onSession]);
  React.useEffect(() => {
    if (!sessionId || !session) return;
    if (session.outline.candidateVersion !== null) {
      if (candidateVersion !== session.outline.candidateVersion) apply(session);
      return;
    }
    if (candidateVersion === null && sections.length === 0) {
      void (async () => {
        const graphVersion = workflowGraphVersion(workflow);
        if (graphVersion === null || sections.length === 0) return generateResearchOutline(sessionId);
        const projection = await executeGuidedResearchNodeCommand(sessionId, {
          node: "outline",
          action: "generate",
          requestId: requestId("outline-generate"),
          expectedGraphVersion: graphVersion,
          nodeState: outlineNodeState(sections),
        });
        onWorkflow(projection);
        return getGuidedResearchSession(sessionId);
      })().then(apply).catch(() => undefined);
    }
  }, [apply, candidateVersion, onWorkflow, sections, sections.length, session, sessionId, workflow]);
  const patchTitle = (id: string, title: string) => setSections((items) => items.map((item) => item.id === id ? { ...item, title } : item));
  const add = () => setSections((items) => [...items, { id: `o${items.length + 1}`, title: "新增章节", questions: ["这一章需要回答什么？"], enabled: true, order: items.length }]);
  const regenerate = async () => {
    if (!sessionId) return;
    setSubmitting(true);
    try {
      const graphVersion = workflowGraphVersion(workflow);
      if (graphVersion === null || sections.length === 0) {
        apply(await generateResearchOutline(sessionId));
      } else {
        const projection = await executeGuidedResearchNodeCommand(sessionId, {
          node: "outline",
          action: "generate",
          requestId: requestId("outline-generate"),
          expectedGraphVersion: graphVersion,
          nodeState: outlineNodeState(sections),
        });
        onWorkflow(projection);
        apply(await getGuidedResearchSession(sessionId));
      }
    } finally { setSubmitting(false); }
  };
  const confirm = async () => {
    if (!sessionId || candidateVersion === null) return;
    setSubmitting(true);
    setSaveFailed(false);
    try {
      const legacyOutline = sections.map((item, order) => ({ ...item, order }));
      const graphVersion = workflowGraphVersion(workflow);
      const updated = graphVersion === null
        ? await confirmResearchOutline(sessionId, { candidateVersion, outline: legacyOutline })
        : await executeGuidedResearchNodeCommand(sessionId, {
          node: "outline",
          action: "confirm",
          requestId: requestId("outline-confirm"),
          expectedGraphVersion: graphVersion,
          nodeState: outlineNodeState(legacyOutline),
        }).then(async (projection) => {
          onWorkflow(projection);
          return getGuidedResearchSession(sessionId);
        });
      apply(updated);
      clearGuidedResearchDemoState(sessionId);
      onNavigate?.("search", sessionId);
    }
    catch { setSaveFailed(true); }
    finally { setSubmitting(false); }
  };
  return (
    <GuidedResearchStepLayout
      assistant={
        <GuidedResearchSkillAssistant
          step="outline"
          progressLabel={progressLabel("outline")}
          sessionKey={`${sessionId ?? "pending"}:outline`}
          snapshot={{ step: "outline", value: sections }}
          onSnapshotChange={(next) => {
            if (next.step === "outline") setSections(next.value);
          }}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-density="compact-step">
      <PageHeading eyebrow="Step 3 · Outline" title="确认报告大纲" description="大纲决定 Web Search 的任务拆分与报告结构。重新生成不会覆盖最近一次人工确认。" action={<Button variant="outline" disabled={submitting || !sessionId} onClick={() => void regenerate()} data-testid="research-regenerate-outline"><Sparkles className="h-4 w-4" />重新生成</Button>} />
      {session && maxGuidedResearchStep(session) !== "outline" && <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-12 text-warning-foreground">重新确认后，后续演示结果将重新生成。</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3" data-testid="research-outline">
          {sections.map((section, index) => <Card key={section.id} data-testid={`research-outline-${section.id}`}><CardContent className="flex gap-3 p-4"><GripVertical className="mt-2 h-4 w-4 text-muted-foreground" /><span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-10 font-semibold">{index + 1}</span><div className="min-w-0 flex-1 space-y-2"><Input value={section.title} onChange={(event) => patchTitle(section.id, event.target.value)} data-testid={`research-outline-title-${section.id}`} aria-label={`大纲章节 ${index + 1}`} /><div className="flex flex-wrap gap-1.5">{section.questions.map((question) => <Badge key={question} tone="outline">{question}</Badge>)}</div></div><Pencil className="mt-2 h-4 w-4 text-muted-foreground" /></CardContent></Card>)}
          <Button variant="outline" className="w-full border-dashed" onClick={add} data-testid="research-add-outline"><Plus className="h-4 w-4" />添加章节</Button>
        </div>
        <Card className="h-fit"><CardHeader><CardTitle className="flex items-center gap-2 text-14"><ListTree className="h-4 w-4" />研究计划摘要</CardTitle></CardHeader><CardContent className="space-y-3 text-11 text-muted-foreground"><div className="flex justify-between"><span>报告章节</span><strong className="text-foreground">{sections.length}</strong></div><div className="flex justify-between"><span>研究问题</span><strong className="text-foreground">{sections.reduce((sum, item) => sum + item.questions.length, 0)}</strong></div><div className="flex justify-between"><span>预计检索</span><strong className="text-foreground">20–30 个来源</strong></div><p className="rounded-md bg-muted p-3 text-10 leading-relaxed">开始后系统会按章节并行搜索，过程中可离开页面，稍后从研究首页继续。</p></CardContent></Card>
      </div>
      {saveFailed && <p className="text-12 text-destructive" role="alert">报告大纲保存失败，请重试。</p>}
      <div className="flex justify-end"><Button variant="primary" disabled={submitting || candidateVersion === null || !sections.some((item) => item.enabled && item.title.trim())} onClick={() => void confirm()} data-testid="research-start-search"><Search className="h-4 w-4" />按此大纲开始研究</Button></div>
      </div>
    </GuidedResearchStepLayout>
  );
}

function SearchScreen({
  sessionId,
  session,
  workflow,
  onSession,
  onWorkflow,
  onNavigate,
}: {
  sessionId?: string;
  session: GuidedResearchSession | null;
  workflow: GuidedResearchWorkflowProjection | null;
  onSession: (session: GuidedResearchSession) => void;
  onWorkflow: (workflow: GuidedResearchWorkflowProjection | null) => void;
  onNavigate: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const sessionKey = sessionId ?? "demo-search";
  const [demoState, setDemoState] = React.useState<GuidedResearchDemoState>(() => loadGuidedResearchDemoState(sessionKey));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setDemoState(loadGuidedResearchDemoState(sessionKey));
    setSubmitting(false);
    setError(null);
  }, [sessionKey]);

  const persist = (next: GuidedResearchDemoState) => {
    setDemoState(next);
    saveGuidedResearchDemoState(next);
  };
  const incompleteTasks = GUIDED_SEARCH_TASKS.filter((task) => !demoState.completedTaskIds.includes(task.id));
  const completedTaskCount = GUIDED_SEARCH_TASKS.length - incompleteTasks.length;
  const progress = sessionId ? Math.round((completedTaskCount / GUIDED_SEARCH_TASKS.length) * 100) : 68;
  const acceptedSourceCount = Object.values(demoState.sourceDecisions).filter((decision) => decision === "accepted").length;
  const completeCollection = async () => {
    if (!sessionId || incompleteTasks.length > 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const graphVersion = workflowGraphVersion(workflow);
      const nextSession = graphVersion === null
        ? await finishGuidedResearchCollection(sessionId, { sourceCount: acceptedSourceCount })
        : await executeGuidedResearchNodeCommand(sessionId, {
          node: "research",
          action: "complete",
          requestId: requestId("research-complete"),
          expectedGraphVersion: graphVersion,
          nodeState: researchNodeState(demoState),
        }).then(async (projection) => {
          onWorkflow(projection);
          return getGuidedResearchSession(sessionId);
        });
      onSession(nextSession);
      onNavigate("report", sessionId);
    } catch {
      setError("生成演示研究报告失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <GuidedResearchStepLayout
      assistant={
        <GuidedResearchSkillAssistant
          step="search"
          progressLabel={progressLabel("search")}
          sessionKey={`${sessionKey}:search`}
          snapshot={{ step: "search", value: demoState }}
          onSnapshotChange={(next) => { if (next.step === "search") persist(next.value); }}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-density="compact-step">
      <PageHeading eyebrow="Step 4 · Web Search" title="正在检索与交叉验证" description="你可以离开此页面。任务进度、已找到的来源和当前查询都会保存，回来后可继续查看。" action={<Badge tone="warning"><Loader2 className="mr-1 h-3 w-3 animate-spin" />研究进行中</Badge>} />
      <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-12 text-warning-foreground">演示检索结果，不代表真实 Web Search</p>
      <Card data-testid="research-search-summary"><CardContent className="space-y-4 p-5"><div className="flex items-end justify-between"><div><p className="text-12 text-muted-foreground">整体进度</p><p className="text-24 font-semibold">{progress}%</p></div><p className="text-11 text-muted-foreground">已完成 {completedTaskCount} / {GUIDED_SEARCH_TASKS.length} 项演示任务</p></div><div data-testid="research-search-progress" data-progress={progress}><Progress value={progress} /></div><div className="flex items-start gap-3 rounded-md border border-primary/20 bg-accent p-3"><Globe2 className="mt-0.5 h-4 w-4 text-primary" /><div><p className="text-10 uppercase tracking-wide text-muted-foreground">当前查询</p><p className="mt-1 text-12 font-medium" data-testid="research-current-query">Germany utility-scale battery storage market 2025</p></div></div></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card><CardHeader><CardTitle className="text-14">按大纲执行</CardTitle></CardHeader><CardContent className="space-y-2">{GUIDED_SEARCH_TASKS.map((task) => { const complete = demoState.completedTaskIds.includes(task.id); return <div key={task.id} className="flex items-center gap-3 rounded-md border border-border p-3" data-testid={`research-task-${task.id}`}>{complete ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-muted-foreground" />}<div className="min-w-0 flex-1"><p className="text-12 font-medium">{task.label}</p><p className="text-10 text-muted-foreground">{complete ? "已完成演示检索" : "等待完成演示检索"}</p></div>{complete ? <Badge tone="outline">已完成</Badge> : <Button type="button" size="sm" variant="outline" onClick={() => persist(advanceDemoTask(demoState, task.id))}>完成演示检索</Button>}</div>; })}</CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-14"><FileSearch className="h-4 w-4" />演示来源</CardTitle></CardHeader><CardContent className="space-y-3">{GUIDED_SEARCH_SOURCES.map((source) => { const decision = demoState.sourceDecisions[source.id]; return <article key={source.id} className="space-y-2 border-b border-border pb-3 last:border-0 last:pb-0" data-testid={`research-source-${source.id}`}><div className="flex items-center justify-between gap-2"><span className="text-10 text-primary">{source.domain}</span><Badge tone="outline">{source.confidence}可信</Badge></div><p className="text-11 font-medium leading-relaxed">{source.title}</p><div className="flex items-center justify-between gap-2"><span className="text-10 text-muted-foreground">{source.kind}</span>{decision ? <Badge tone={decision === "accepted" ? "primary" : "neutral"}>{decision === "accepted" ? "已保留" : "已排除"}</Badge> : <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => persist(decideDemoSource(demoState, source.id, "excluded"))}>排除</Button><Button size="sm" variant="outline" onClick={() => persist(decideDemoSource(demoState, source.id, "accepted"))}>保留</Button></div>}</div></article>; })}</CardContent></Card>
      </div>
      {error && <p className="text-center text-12 text-destructive" role="alert">{error}</p>}
      <div className="flex justify-end"><Button variant="primary" disabled={!sessionId || incompleteTasks.length > 0 || submitting} onClick={() => void completeCollection()}>生成演示研究报告<ArrowRight className="h-4 w-4" /></Button></div>
      </div>
    </GuidedResearchStepLayout>
  );
}

function latestConfirmedOutline(session: GuidedResearchSession | null): GuidedResearchOutlineSection[] {
  const confirmedVersion = session?.outline.confirmedVersion;
  return session?.outline.versions.find((version) => version.version === confirmedVersion)?.items ?? GUIDED_RESEARCH_OUTLINE;
}

function ReportScreen({
  sessionId,
  session,
  workflow,
  onSession,
  onWorkflow,
  onNavigate,
}: {
  sessionId?: string;
  session: GuidedResearchSession | null;
  workflow: GuidedResearchWorkflowProjection | null;
  onSession: (session: GuidedResearchSession) => void;
  onWorkflow: (workflow: GuidedResearchWorkflowProjection | null) => void;
  onNavigate: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const sessionKey = sessionId ?? "demo-report";
  const [demoState, setDemoState] = React.useState<GuidedResearchDemoState>(() => loadGuidedResearchDemoState(sessionKey));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [completed, setCompleted] = React.useState(session?.status === "completed");
  React.useEffect(() => {
    setDemoState(loadGuidedResearchDemoState(sessionKey));
    setSubmitting(false);
    setError(null);
    setCompleted(session?.status === "completed");
  }, [sessionKey, session?.status]);
  const finishReport = async () => {
    if (!sessionId || completed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const title = `${session?.brief.topic ?? GUIDED_RESEARCH_BRIEF.topic}研究报告`;
      const graphVersion = workflowGraphVersion(workflow);
      const nextSession = graphVersion === null
        ? await completeGuidedResearchSession(sessionId)
        : await executeGuidedResearchNodeCommand(sessionId, {
          node: "report",
          action: "complete",
          requestId: requestId("report-complete"),
          expectedGraphVersion: graphVersion,
          nodeState: { title, revisionInstruction: demoState.reportSummary },
        }).then(async (projection) => {
          onWorkflow(projection);
          return getGuidedResearchSession(sessionId);
        });
      onSession(nextSession);
      setCompleted(true);
    } catch {
      setError("完成研究失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };
  const outline = latestConfirmedOutline(session);
  const acceptedCitations = GUIDED_REPORT_CITATIONS.filter(
    (citation) => demoState.sourceDecisions[citation.id] === "accepted",
  );
  const title = `${session?.brief.topic ?? GUIDED_RESEARCH_BRIEF.topic}研究报告`;
  return (
    <GuidedResearchStepLayout
      wideMain
      assistant={
        <GuidedResearchSkillAssistant
          step="report"
          progressLabel={progressLabel("report")}
          sessionKey={`${sessionId ?? "pending"}:report`}
          snapshot={{ step: "report", value: { reportSummary: demoState.reportSummary } }}
          onSnapshotChange={(next) => {
            if (next.step === "report") setDemoState((current) => ({ ...current, ...next.value }));
          }}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-density="compact-report">
      <PageHeading eyebrow="Step 5 · Final report" title={completed ? "研究已完成" : "演示研究报告"} description="报告按确认过的大纲生成，关键判断可追溯到演示引用。" action={<div className="flex gap-2"><Button variant="outline" onClick={() => onNavigate("search", sessionId)}>返回资料研究</Button><Button variant="outline" onClick={() => onNavigate("home", sessionId)}>返回研究首页</Button></div>} />
      <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-12 text-warning-foreground">演示报告，不作为真实研究结论</p>
      <div className="space-y-4" data-testid="research-report" data-layout="full-width-report">
        <Card className="h-fit">
          <CardHeader className="pb-2"><CardTitle className="text-13">目录</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">{outline.map((item, index) => <a key={item.id} href={`#report-${index}`} className="rounded-md border border-border px-3 py-2 text-11 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{index + 1}. {item.title}</a>)}</CardContent>
        </Card>
        <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_18rem]">
          <article className="min-w-0 space-y-6 rounded-lg border border-border bg-card p-6">
            <header className="space-y-3 border-b border-border pb-5"><Badge tone={completed ? "primary" : "warning"}>{completed ? "研究已完成" : "待完成"}</Badge><h2 className="text-24 font-semibold leading-tight">{title}</h2><div className="flex flex-wrap gap-3 text-10 text-muted-foreground"><span>演示报告</span><span>{session?.sourceCount ?? 0} 个已记录来源</span></div></header>
            {outline.map((section, index) => <ReportSection key={section.id} id={`report-${index}`} title={section.title}><p>{index === 0 ? `本演示报告围绕“${session?.brief.goal ?? GUIDED_RESEARCH_BRIEF.goal}”整理了固定演示资料与结论结构。` : "此章节基于确认后的报告大纲保留为演示内容，不代表真实检索或研究判断。"}</p>{index === 0 && <div className="rounded-md border-l-4 border-primary bg-accent p-4"><p className="text-12 font-semibold">演示摘要</p><p className="mt-1 text-12 leading-relaxed">{demoState.reportSummary || "演示摘要会根据资料研究阶段已保留的来源生成。"}</p></div>}</ReportSection>)}
          </article>
          <Card className="h-fit"><CardHeader><CardTitle className="text-13">来源与引用</CardTitle></CardHeader><CardContent className="space-y-3">{acceptedCitations.length === 0 ? <p className="text-11 text-muted-foreground">没有已保留的演示来源</p> : acceptedCitations.map((citation, index) => <div key={citation.id} className="rounded-md border border-border p-3" data-testid={`research-citation-${citation.id}`}><div className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-10">{index + 1}</span><div className="min-w-0"><p className="text-10 font-medium leading-relaxed">{citation.label}</p><p className="mt-1 break-all text-10 text-primary">{citation.url}</p></div></div></div>)}</CardContent></Card>
        </div>
      </div>
      {error && <p className="text-center text-12 text-destructive" role="alert">{error}</p>}
      {!completed && <div className="flex justify-end"><Button variant="primary" disabled={!sessionId || submitting} onClick={() => void finishReport()}>完成研究<BookOpen className="h-4 w-4" /></Button></div>}
      </div>
    </GuidedResearchStepLayout>
  );
}

function ReportSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="space-y-3"><h3 className="text-17 font-semibold">{title}</h3><div className="space-y-3 text-13 leading-7 text-foreground">{children}</div></section>;
}
