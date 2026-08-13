"use client";

import * as React from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, Circle,
  Clock3, FileSearch, FileText, Globe2, GripVertical, ListTree, Loader2, Pencil,
  Plus, RotateCcw, Search, Sparkles, Target, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createGuidedResearchSession,
  confirmResearchDirections,
  confirmResearchOutline,
  generateResearchDirections,
  generateResearchOutline,
  getGuidedResearchSession,
  listGuidedResearchSessions,
  type GuidedResearchDirection,
  type GuidedResearchOutlineSection,
  type GuidedResearchSession,
} from "@/lib/guided-research-api";
import {
  GUIDED_REPORT_CITATIONS,
  GUIDED_RESEARCH_BRIEF,
  GUIDED_SEARCH_SOURCES,
  GUIDED_SEARCH_TASKS,
  type GuidedResearchStep,
} from "@/lib/mock/guided-research";

export function GuidedResearchFlow({
  step,
  sessionId,
  onStepChange,
}: {
  step: GuidedResearchStep;
  sessionId?: string;
  onStepChange?: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const [restoredStep, setRestoredStep] = React.useState(step);
  const [activeSessionId, setActiveSessionId] = React.useState(sessionId);
  const [restoreFailed, setRestoreFailed] = React.useState(false);
  const [sessionSnapshot, setSessionSnapshot] = React.useState<GuidedResearchSession | null>(null);
  React.useEffect(() => {
    setRestoredStep(step);
    setActiveSessionId(sessionId);
    setRestoreFailed(false);
    if (!sessionId) return;
    let active = true;
    getGuidedResearchSession(sessionId)
      .then((session) => {
        if (!active) return;
        setRestoredStep(stageToStep(session.resumeStage));
        setActiveSessionId(session.sessionId);
        setSessionSnapshot(session);
      })
      .catch(() => { if (active) setRestoreFailed(true); });
    return () => { active = false; };
  }, [sessionId, step]);

  const navigate = (next: GuidedResearchStep, sessionId?: string) => {
    const targetSessionId = sessionId ?? activeSessionId;
    if (onStepChange) return onStepChange(next, targetSessionId);
    setRestoredStep(next);
    if (sessionId) setActiveSessionId(sessionId);
    const query = new URLSearchParams({ flow: next });
    if (targetSessionId) query.set("session", targetSessionId);
    window.location.assign(`?${query.toString()}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-10" data-testid={`research-flow-${restoredStep}`}>
      {restoreFailed && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-12 text-destructive" data-testid="research-session-restore-error">研究会话恢复失败，请返回首页后重试。</p>}
      {restoredStep !== "home" && <FlowProgress step={restoredStep} onBack={() => navigate(previousStep(restoredStep))} />}
      {restoredStep === "home" && <ResearchHome onNavigate={navigate} />}
      {restoredStep === "brief" && <BriefScreen onNavigate={navigate} />}
      {restoredStep === "directions" && <DirectionsScreen sessionId={activeSessionId} session={sessionSnapshot} onSession={setSessionSnapshot} onNavigate={navigate} />}
      {restoredStep === "outline" && <OutlineScreen sessionId={activeSessionId} session={sessionSnapshot} onSession={setSessionSnapshot} onNavigate={navigate} />}
      {restoredStep === "search" && <SearchScreen />}
      {restoredStep === "report" && <ReportScreen onNavigate={navigate} />}
    </div>
  );
}

function previousStep(step: GuidedResearchStep): GuidedResearchStep {
  const order: GuidedResearchStep[] = ["home", "brief", "directions", "outline", "search", "report"];
  return order[Math.max(0, order.indexOf(step) - 1)]!;
}

function FlowProgress({ step, onBack }: { step: GuidedResearchStep; onBack: () => void }) {
  const steps: Array<{ id: GuidedResearchStep; label: string }> = [
    { id: "brief", label: "确认主题" },
    { id: "directions", label: "研究方向" },
    { id: "outline", label: "报告大纲" },
    { id: "search", label: "资料研究" },
    { id: "report", label: "研究报告" },
  ];
  const current = steps.findIndex((item) => item.id === step);
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3" data-testid="research-flow-progress">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="research-flow-back"><ArrowLeft className="h-4 w-4" />返回</Button>
        <div className="grid min-w-0 flex-1 grid-cols-5 gap-2">
          {steps.map((item, index) => (
            <div key={item.id} className="flex min-w-0 items-center gap-2">
              <span className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-10 transition-colors",
                index < current && "border-primary bg-primary text-primary-foreground",
                index === current && "border-primary bg-accent text-accent-foreground",
                index > current && "border-border text-muted-foreground",
              )}>{index < current ? <Check className="h-3 w-3" /> : index + 1}</span>
              <span className={cn("truncate text-11", index === current ? "font-medium text-foreground" : "text-muted-foreground")}>{item.label}</span>
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

const stageToStep = (stage: GuidedResearchSession["resumeStage"]): GuidedResearchStep =>
  stage === "researching" ? "search" : stage;

function ResearchHome({ onNavigate }: { onNavigate: (step: GuidedResearchStep, sessionId?: string) => void }) {
  const [history, setHistory] = React.useState<GuidedResearchSession[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    listGuidedResearchSessions()
      .then((result) => { if (active) setHistory(result.items); })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, []);
  return (
    <>
      <PageHeading
        eyebrow="Deep Research"
        title="研究"
        description="从一个明确的问题开始，让 AI 帮你拆方向、定大纲、检索资料并生成带引用的完整报告。"
        action={<Button variant="primary" size="md" onClick={() => onNavigate("brief")} data-testid="research-create"><Plus className="h-4 w-4" />创建研究</Button>}
      />
      <Card className="border-primary/20 bg-accent/40">
        <CardContent className="flex flex-col items-start justify-between gap-4 p-5 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-primary p-2 text-primary-foreground"><Sparkles className="h-5 w-5" /></span>
            <div><h2 className="text-15 font-semibold">开始一项新的深度研究</h2><p className="mt-1 text-12 text-muted-foreground">确认主题后，研究方向和报告大纲都可以在执行前编辑。</p></div>
          </div>
          <Button variant="primary" onClick={() => onNavigate("brief")} data-testid="research-create-hero">描述研究主题<ArrowRight className="h-4 w-4" /></Button>
        </CardContent>
      </Card>
      <section className="space-y-3" data-testid="research-history">
        <div className="flex items-center justify-between"><h2 className="text-16 font-semibold">历史研究</h2><span className="text-11 text-muted-foreground">{history?.length ?? 0} 项</span></div>
        {history === null && !loadFailed && <p className="text-12 text-muted-foreground" data-testid="research-history-loading">正在加载历史研究…</p>}
        {loadFailed && <p className="text-12 text-destructive" data-testid="research-history-error">历史研究加载失败，请稍后重试。</p>}
        {history?.length === 0 && <p className="rounded-md border border-dashed p-6 text-center text-12 text-muted-foreground" data-testid="research-history-empty">还没有研究，先创建一项吧。</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {history?.map((item) => (
            <Card key={item.sessionId} className="flex h-full flex-col transition-shadow hover:shadow-md" data-testid={`research-history-${item.sessionId}`}>
              <CardHeader className="space-y-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={item.stage === "report" ? "primary" : item.stage === "researching" ? "warning" : "outline"}>{item.stage === "report" ? "已完成" : item.stage === "researching" ? "研究中" : "待继续"}</Badge>
                  <span className="flex items-center gap-1 text-10 text-muted-foreground"><Clock3 className="h-3 w-3" />{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span>
                </div>
                <CardTitle className="text-16 leading-snug">{item.title}</CardTitle>
                <p className="min-h-10 text-11 leading-relaxed text-muted-foreground">{item.brief.goal}</p>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="space-y-1.5"><div className="flex justify-between text-10 text-muted-foreground"><span>{item.progress}%</span><span>{item.sourceCount} 个来源</span></div><Progress value={item.progress} /></div>
                {item.stage === "report" ? (
                  <Button className="w-full" variant="outline" onClick={() => onNavigate("report", item.sessionId)} data-testid={`research-view-${item.sessionId}`}><FileText className="h-4 w-4" />查看研究</Button>
                ) : (
                  <Button className="w-full" variant="secondary" onClick={() => onNavigate(stageToStep(item.resumeStage), item.sessionId)} data-testid={`research-continue-${item.sessionId}`}><RotateCcw className="h-4 w-4" />继续研究</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

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

function pendingCreateIdempotencyKey(brief: typeof GUIDED_RESEARCH_BRIEF): { key: string; storageKey: string } {
  const now = Date.now();
  cleanStaleCreateIdempotencyKeys(now);
  let tabId = window.sessionStorage.getItem(CREATE_IDEMPOTENCY_TAB_KEY);
  if (!tabId) {
    tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(CREATE_IDEMPOTENCY_TAB_KEY, tabId);
  }
  const intent = JSON.stringify(brief);
  const storageKey = `${CREATE_IDEMPOTENCY_STORAGE_PREFIX}${tabId}.${encodeURIComponent(intent)}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    const stored = JSON.parse(existing) as { key: string; createdAt: number };
    return { key: stored.key, storageKey };
  }
  const generated = `guided-${now}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(storageKey, JSON.stringify({ key: generated, createdAt: now }));
  return { key: generated, storageKey };
}

function BriefScreen({ onNavigate }: { onNavigate: (step: GuidedResearchStep, sessionId?: string) => void }) {
  const [brief, setBrief] = React.useState(GUIDED_RESEARCH_BRIEF);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitFailed, setSubmitFailed] = React.useState(false);
  const patch = (key: keyof typeof brief, value: string) => setBrief((current) => ({ ...current, [key]: value }));
  const confirm = async () => {
    setSubmitting(true);
    setSubmitFailed(false);
    try {
      const pending = pendingCreateIdempotencyKey(brief);
      const session = await createGuidedResearchSession({ idempotencyKey: pending.key, collaboratorUserIds: [], brief });
      window.localStorage.removeItem(pending.storageKey);
      onNavigate("directions", session.sessionId);
    } catch {
      setSubmitFailed(true);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <PageHeading eyebrow="Step 1 · Research brief" title="确认研究主题与范围" description="先把问题边界说清楚。后续生成的研究方向、大纲和检索词都会以这份 brief 为准。" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <Card><CardContent className="space-y-5 p-5">
          <Field label="研究主题" hint="用一句话说明要研究什么"><Input value={brief.topic} onChange={(event) => patch("topic", event.target.value)} data-testid="research-brief-topic" aria-label="研究主题" /></Field>
          <Field label="研究目标" hint="最终希望做出什么判断"><Textarea value={brief.goal} onChange={(event) => patch("goal", event.target.value)} data-testid="research-brief-goal" aria-label="研究目标" /></Field>
          <div className="grid gap-4 md:grid-cols-2"><Field label="时间范围"><Input value={brief.timeRange} onChange={(event) => patch("timeRange", event.target.value)} data-testid="research-brief-time" aria-label="时间范围" /></Field><Field label="地域范围"><Input value={brief.region} onChange={(event) => patch("region", event.target.value)} data-testid="research-brief-region" aria-label="地域范围" /></Field></div>
          <Field label="重点关注"><Textarea value={brief.focus} onChange={(event) => patch("focus", event.target.value)} data-testid="research-brief-focus" aria-label="重点关注" /></Field>
          {submitFailed && <p className="text-11 text-destructive" role="alert">研究创建失败，请重试。再次提交不会重复创建。</p>}
          <div className="flex justify-end"><Button variant="primary" disabled={submitting || !brief.topic.trim() || !brief.goal.trim()} onClick={() => void confirm()} data-testid="research-confirm-brief">{submitting ? "正在创建…" : "确认并生成研究方向"}<ArrowRight className="h-4 w-4" /></Button></div>
        </CardContent></Card>
        <Card className="h-fit"><CardHeader><CardTitle className="flex items-center gap-2 text-14"><Target className="h-4 w-4" />本次研究将回答</CardTitle></CardHeader><CardContent className="space-y-3 text-11 leading-relaxed text-muted-foreground"><p>哪些欧洲市场同时具备增长、政策与并网确定性？</p><p>适合以自建、合资还是渠道合作进入？</p><p>未来 90 天最优先验证哪些假设？</p><div className="rounded-md border border-border bg-muted p-3 text-10">可在下一步逐条修改或删除 AI 建议的研究方向。</div></CardContent></Card>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-12 font-medium text-foreground">{label}{hint && <span className="font-normal text-muted-foreground">{hint}</span>}{children}</label>;
}

function DirectionsScreen({ sessionId, session, onSession, onNavigate }: {
  sessionId?: string; session: GuidedResearchSession | null; onSession: (session: GuidedResearchSession) => void;
  onNavigate?: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const [directions, setDirections] = React.useState<GuidedResearchDirection[]>([]);
  const [candidateVersion, setCandidateVersion] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
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
      void generateResearchDirections(sessionId).then(apply).catch(() => undefined);
    }
  }, [apply, candidateVersion, directions.length, session, sessionId]);
  const patch = (id: string, update: Partial<GuidedResearchDirection>) => setDirections((items) => items.map((item) => item.id === id ? { ...item, ...update } : item));
  const add = () => setDirections((items) => [...items, { id: `d${items.length + 1}`, title: "新的研究方向", description: "补充这个方向需要回答的核心问题。", enabled: true, order: items.length }]);
  const regenerate = async () => { if (!sessionId) return; setSubmitting(true); try { apply(await generateResearchDirections(sessionId)); } finally { setSubmitting(false); } };
  const confirm = async () => {
    if (!sessionId || candidateVersion === null) return;
    setSubmitting(true);
    try {
      const updated = await confirmResearchDirections(sessionId, { candidateVersion, directions: directions.map((item, order) => ({ ...item, order })) });
      apply(updated);
      onNavigate?.("outline", sessionId);
    }
    finally { setSubmitting(false); }
  };
  return (
    <>
      <PageHeading eyebrow="Step 2 · Directions" title="编辑研究方向" description="AI 根据主题生成了互补方向。重新生成只创建候选版本，不会覆盖最近一次人工确认。" action={<Button variant="outline" disabled={submitting || !sessionId} onClick={() => void regenerate()} data-testid="research-regenerate-directions"><Sparkles className="h-4 w-4" />重新生成</Button>} />
      <div className="space-y-3" data-testid="research-directions">
        {directions.map((direction, index) => <Card key={direction.id} className={cn("transition-colors", !direction.enabled && "bg-muted")} data-testid={`research-direction-${direction.id}`}><CardContent className="flex gap-3 p-4"><GripVertical className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" /><Button variant="outline" size="icon" aria-label={`启用方向 ${index + 1}`} onClick={() => patch(direction.id, { enabled: !direction.enabled })} className="mt-1 h-6 w-6 shrink-0">{direction.enabled && <Check className="h-3 w-3" />}</Button><div className="min-w-0 flex-1 space-y-2"><Input value={direction.title} onChange={(event) => patch(direction.id, { title: event.target.value })} data-testid={`research-direction-title-${direction.id}`} aria-label={`研究方向 ${index + 1} 标题`} /><Textarea value={direction.description} onChange={(event) => patch(direction.id, { description: event.target.value })} data-testid={`research-direction-description-${direction.id}`} aria-label={`研究方向 ${index + 1} 描述`} /></div><Button variant="ghost" size="icon" aria-label={`删除方向 ${index + 1}`} onClick={() => setDirections((items) => items.filter((item) => item.id !== direction.id))}><Trash2 className="h-4 w-4" /></Button></CardContent></Card>)}
        <Button variant="outline" className="w-full border-dashed" onClick={add} data-testid="research-add-direction"><Plus className="h-4 w-4" />添加研究方向</Button>
      </div>
      <div className="flex justify-end"><Button variant="primary" disabled={submitting || candidateVersion === null || !directions.some((item) => item.enabled)} onClick={() => void confirm()} data-testid="research-confirm-directions">生成报告大纲<ArrowRight className="h-4 w-4" /></Button></div>
    </>
  );
}

function OutlineScreen({ sessionId, session, onSession, onNavigate }: {
  sessionId?: string; session: GuidedResearchSession | null; onSession: (session: GuidedResearchSession) => void;
  onNavigate?: (step: GuidedResearchStep, sessionId?: string) => void;
}) {
  const [sections, setSections] = React.useState<GuidedResearchOutlineSection[]>([]);
  const [candidateVersion, setCandidateVersion] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
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
      void generateResearchOutline(sessionId).then(apply).catch(() => undefined);
    }
  }, [apply, candidateVersion, sections.length, session, sessionId]);
  const patchTitle = (id: string, title: string) => setSections((items) => items.map((item) => item.id === id ? { ...item, title } : item));
  const add = () => setSections((items) => [...items, { id: `o${items.length + 1}`, title: "新增章节", questions: ["这一章需要回答什么？"], enabled: true, order: items.length }]);
  const regenerate = async () => { if (!sessionId) return; setSubmitting(true); try { apply(await generateResearchOutline(sessionId)); } finally { setSubmitting(false); } };
  const confirm = async () => {
    if (!sessionId || candidateVersion === null) return;
    setSubmitting(true);
    try {
      const updated = await confirmResearchOutline(sessionId, { candidateVersion, outline: sections.map((item, order) => ({ ...item, order })) });
      apply(updated);
      onNavigate?.("search", sessionId);
    }
    finally { setSubmitting(false); }
  };
  return (
    <>
      <PageHeading eyebrow="Step 3 · Outline" title="确认报告大纲" description="大纲决定 Web Search 的任务拆分与报告结构。重新生成不会覆盖最近一次人工确认。" action={<Button variant="outline" disabled={submitting || !sessionId} onClick={() => void regenerate()} data-testid="research-regenerate-outline"><Sparkles className="h-4 w-4" />重新生成</Button>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3" data-testid="research-outline">
          {sections.map((section, index) => <Card key={section.id} data-testid={`research-outline-${section.id}`}><CardContent className="flex gap-3 p-4"><GripVertical className="mt-2 h-4 w-4 text-muted-foreground" /><span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-10 font-semibold">{index + 1}</span><div className="min-w-0 flex-1 space-y-2"><Input value={section.title} onChange={(event) => patchTitle(section.id, event.target.value)} data-testid={`research-outline-title-${section.id}`} aria-label={`大纲章节 ${index + 1}`} /><div className="flex flex-wrap gap-1.5">{section.questions.map((question) => <Badge key={question} tone="outline">{question}</Badge>)}</div></div><Pencil className="mt-2 h-4 w-4 text-muted-foreground" /></CardContent></Card>)}
          <Button variant="outline" className="w-full border-dashed" onClick={add} data-testid="research-add-outline"><Plus className="h-4 w-4" />添加章节</Button>
        </div>
        <Card className="h-fit"><CardHeader><CardTitle className="flex items-center gap-2 text-14"><ListTree className="h-4 w-4" />研究计划摘要</CardTitle></CardHeader><CardContent className="space-y-3 text-11 text-muted-foreground"><div className="flex justify-between"><span>报告章节</span><strong className="text-foreground">{sections.length}</strong></div><div className="flex justify-between"><span>研究问题</span><strong className="text-foreground">{sections.reduce((sum, item) => sum + item.questions.length, 0)}</strong></div><div className="flex justify-between"><span>预计检索</span><strong className="text-foreground">20–30 个来源</strong></div><p className="rounded-md bg-muted p-3 text-10 leading-relaxed">开始后系统会按章节并行搜索，过程中可离开页面，稍后从研究首页继续。</p></CardContent></Card>
      </div>
      <div className="flex justify-end"><Button variant="primary" disabled={submitting || candidateVersion === null || !sections.some((item) => item.enabled && item.title.trim())} onClick={() => void confirm()} data-testid="research-start-search"><Search className="h-4 w-4" />按此大纲开始研究</Button></div>
    </>
  );
}

function SearchScreen() {
  return (
    <>
      <PageHeading eyebrow="Step 4 · Web Search" title="正在检索与交叉验证" description="你可以离开此页面。任务进度、已找到的来源和当前查询都会保存，回来后可继续查看。" action={<Badge tone="warning"><Loader2 className="mr-1 h-3 w-3 animate-spin" />研究进行中</Badge>} />
      <Card><CardContent className="space-y-4 p-5"><div className="flex items-end justify-between"><div><p className="text-12 text-muted-foreground">整体进度</p><p className="text-24 font-semibold">68%</p></div><p className="text-11 text-muted-foreground">已分析 27 个来源 · 预计还需 6–8 分钟</p></div><div data-testid="research-search-progress" data-progress="68"><Progress value={68} /></div><div className="flex items-start gap-3 rounded-md border border-primary/20 bg-accent p-3"><Globe2 className="mt-0.5 h-4 w-4 text-primary" /><div><p className="text-10 uppercase tracking-wide text-muted-foreground">当前查询</p><p className="mt-1 text-12 font-medium" data-testid="research-current-query">Germany utility-scale battery storage market 2025</p></div></div></CardContent></Card>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card><CardHeader><CardTitle className="text-14">按大纲执行</CardTitle></CardHeader><CardContent className="space-y-2">{GUIDED_SEARCH_TASKS.map((task) => <div key={task.id} className="flex items-center gap-3 rounded-md border border-border p-3" data-testid={`research-task-${task.id}`}>{task.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-success" /> : task.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}<div className="min-w-0 flex-1"><p className="text-12 font-medium">{task.label}</p><p className="text-10 text-muted-foreground">{task.status === "completed" ? "已完成交叉验证" : task.status === "running" ? "正在搜索并提取证据" : "等待前置章节"}</p></div><Badge tone="outline">{task.sources} 来源</Badge></div>)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-14"><FileSearch className="h-4 w-4" />最新来源</CardTitle></CardHeader><CardContent className="space-y-3">{GUIDED_SEARCH_SOURCES.map((source) => <article key={source.id} className="space-y-1 border-b border-border pb-3 last:border-0 last:pb-0" data-testid={`research-source-${source.id}`}><div className="flex items-center justify-between gap-2"><span className="text-10 text-primary">{source.domain}</span><Badge tone="outline">{source.confidence}可信</Badge></div><p className="text-11 font-medium leading-relaxed">{source.title}</p><span className="text-10 text-muted-foreground">{source.kind}</span></article>)}</CardContent></Card>
      </div>
      <p className="text-center text-11 text-muted-foreground">研究完成后会自动生成报告，并保留每条关键结论的来源引用。</p>
    </>
  );
}

function ReportScreen({ onNavigate }: { onNavigate: (step: GuidedResearchStep) => void }) {
  return (
    <>
      <PageHeading eyebrow="Step 5 · Final report" title="研究报告已完成" description="报告按确认过的大纲生成，关键判断可追溯到原始来源。" action={<div className="flex gap-2"><Button variant="outline" onClick={() => onNavigate("home")}>返回研究首页</Button><Button variant="primary"><BookOpen className="h-4 w-4" />导出报告</Button></div>} />
      <div className="grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)_19rem]" data-testid="research-report">
        <Card className="h-fit"><CardHeader><CardTitle className="text-13">目录</CardTitle></CardHeader><CardContent className="space-y-1">{["执行摘要", "市场规模与商业模式", "政策与并网", "竞争格局", "进入建议"].map((item, index) => <a key={item} href={`#report-${index}`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-11 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><span>{index + 1}. {item}</span><ChevronRight className="h-3 w-3" /></a>)}</CardContent></Card>
        <article className="space-y-6 rounded-lg border border-border bg-card p-6">
          <header className="space-y-3 border-b border-border pb-5"><Badge tone="primary">研究完成</Badge><h2 className="text-24 font-semibold leading-tight">欧洲储能市场进入策略研究报告</h2><div className="flex flex-wrap gap-3 text-10 text-muted-foreground"><span>2026 年 8 月 12 日</span><span>约 18 分钟阅读</span><span>41 个来源</span></div></header>
          <ReportSection id="report-0" title="执行摘要"><p>欧洲储能市场正在从补贴驱动转向由电价波动、容量机制与并网约束共同驱动。德国仍是规模最大的优先市场，但进入策略应从单纯设备销售转向与本地开发商或聚合商合作。</p><div className="rounded-md border-l-4 border-primary bg-accent p-4"><p className="text-12 font-semibold">核心判断</p><p className="mt-1 text-12 leading-relaxed">优先顺序建议为德国、意大利、西班牙；英国适合作为交易与聚合能力验证市场，而不是第一阶段重资产进入。</p></div></ReportSection>
          <ReportSection id="report-1" title="市场规模与商业模式"><p>电池储能新增装机仍维持两位数增长，但不同国家的收入结构差异显著。德国工商业侧的峰谷价差和灵活性服务同时改善，具备更好的收入组合韧性。</p></ReportSection>
          <ReportSection id="report-2" title="政策、并网与收入机制"><p>政策方向总体利好，但并网队列和许可周期是项目落地的主要摩擦。进入决策应同时评估政策支持和真实并网能力，避免只看名义市场规模。</p></ReportSection>
          <ReportSection id="report-3" title="竞争格局与进入建议"><p>建议采用“本地开发合作 + 统一技术与运营平台”的两层模式，用 90 天完成伙伴筛选、两个示范项目和收入压力测试。</p></ReportSection>
        </article>
        <Card className="h-fit"><CardHeader><CardTitle className="text-13">来源与引用</CardTitle></CardHeader><CardContent className="space-y-3">{GUIDED_REPORT_CITATIONS.map((citation, index) => <div key={citation.id} className="rounded-md border border-border p-3" data-testid={`research-citation-${citation.id}`}><div className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-10">{index + 1}</span><div><p className="text-10 font-medium leading-relaxed">{citation.label}</p><p className="mt-1 text-10 text-primary">{citation.url}</p></div></div></div>)}</CardContent></Card>
      </div>
    </>
  );
}

function ReportSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="space-y-3"><h3 className="text-17 font-semibold">{title}</h3><div className="space-y-3 text-13 leading-7 text-foreground">{children}</div></section>;
}
