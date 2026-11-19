"use client";
import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtPersonalCheckpointPanel } from "./aidt-personal-checkpoint-panel";
import { AidtSharedStagePanel } from "./aidt-shared-stage-panel";
import { useAidtSharedStages, aidtSharedDraftSignature } from "../lib/use-aidt-shared-stages";
import { useAidtPersonalCheckpoints, aidtCheckpointKey } from "../lib/use-aidt-personal-checkpoints";
import type { AidtPersonalStageCheckpoint, AidtPersonalStageScope } from "../lib/aidt-stage-persistence";
import type { AidtSavedContextReference } from "../lib/aidt-chat-saved-context";
import { isAidtModuleEnabled } from "../lib/aidt-module-config";
import { emptyAidtUiDrafts, aidtUiReportMarkdown, aidtUiStageSummary, type AidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtDraftScope, aidtResourceScope, hasAidtIdentity } from "@/features/aidt/lib/aidt-state-scope";
import { AidtStageJourney, type AidtReviewCheckpoint } from "@/features/aidt/components/aidt-stage-journey";
import { AidtStageNavigation } from "@/features/aidt/components/aidt-stage-navigation";
import { AidtAssistantPanel } from "@/features/aidt/components/aidt-assistant-panel";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { aidtReportChatHref } from "../lib/aidt-report-task";
import { AidtStageBridge } from "@/features/aidt/components/aidt-stage-bridge";
import { AidtMaterials } from "@/features/aidt/components/aidt-materials";
import { offerComposerDraft, type ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import { Button } from "@/components/ui/button";
import { AIDT_STEPS, aidtHref, aidtStep } from "@/features/aidt/lib/project-aidt";
import { listProjectResources, type ProjectResourceKind } from "@/lib/live-project-resources";
import { AidtEvidenceGuide, AidtDecisionGuide, AidtLearningStart } from "@/features/aidt/components/aidt-learning-guide";
import { AidtDashboard } from "@/features/aidt/components/project-aidt-dashboard";
import { ProjectConversations } from "@/components/project/project-conversations";
import { ProjectResourceSection, projectResourceHref, describeProjectResourceFailure } from "@/components/project/project-resource-section";
import { ProjectEvidenceSection } from "@/components/project/project-evidence-section";
import type { ProjectResearchSub } from "@/components/project/project-links";

import { AidtArtifactShelf } from "./aidt-artifact-shelf";
import { AidtStageHistory } from "./aidt-stage-history";
import { AidtNextRound } from "./aidt-next-round";
import { AidtRoundNavigation } from "./aidt-round-navigation";
import { aidtStageContextReferences } from "../lib/aidt-native-context-selector";
import { getAidtPrototypeGenerationReadiness } from "../lib/aidt-verification-loop";

const loading = () => <p role="status" className="p-4 text-12 text-muted-foreground">正在加载工作区…</p>;
const Chat = dynamic(() => import("@/features/aidt/components/project-aidt-chat").then((m) => m.ProjectAidtChat), { loading });
const Transcription = dynamic(() => import("@/components/rec/transcription-history").then((m) => m.TranscriptionHistory), { loading });
const Design = dynamic(() => import("@/features/aidt/components/aidt-design-workspace").then((m) => m.AidtDesignWorkspace), { loading });

const TOOLS = {
  outcome: "本步成果", context: "阶段交接", report: "小组报告", chat: "讨论与产出物", sources: "真实证据", transcript: "转录资料", record: "个人录音笔记",
  whiteboard: "白板", design: "原型设计", research: "资料研究", itv: "AI 模拟访谈",
} as const;
type Tool = keyof typeof TOOLS;
const STEP_TOOLS: Record<number, readonly Tool[]> = {
  1: ["chat", "outcome", "context", "whiteboard"],
  2: ["chat", "outcome", "context", "sources", "transcript", "record"],
  3: ["chat", "outcome", "context", "sources", "whiteboard"],
  4: ["chat", "outcome", "context", "whiteboard", "design"],
  5: ["chat", "outcome", "context", "design", "whiteboard"],
  6: ["chat", "outcome", "context", "report", "sources", "transcript", "record", "design"],
};

export function ProjectAidt({ projectId, sub, canWrite }: { projectId: string; sub: string | null; canWrite: boolean }) {
  const identity = useOptionalSession()?.session;
  const authenticated = hasAidtIdentity(identity);
  const uiScope = aidtDraftScope(identity, projectId);
  const latestUiScope = React.useRef(uiScope); latestUiScope.current = uiScope;
  // Actor keys can recur (A -> B -> A). Old local reads belong to the earlier
  // lifecycle even when the returning actor and default candidate IDs match.
  const uiLifecycle = React.useRef({ scope: uiScope, generation: 0 });
  if (uiLifecycle.current.scope !== uiScope) uiLifecycle.current = { scope: uiScope, generation: uiLifecycle.current.generation + 1 };
  const uiGeneration = uiLifecycle.current.generation;
  const uiLifecycleKey = JSON.stringify([uiScope, uiGeneration]);
  const latestCanWrite = React.useRef(canWrite); latestCanWrite.current = canWrite;
  type UiState = { scope: string; drafts: AidtUiDrafts; checkpoints: Record<number, AidtReviewCheckpoint[]>; revision: number; report: { text: string; sourceRevision: number } | null };
  const freshUi = React.useCallback((): UiState => ({ scope: uiScope, drafts: emptyAidtUiDrafts(), checkpoints: {}, revision: 0, report: null }), [uiScope]);
  const [ui, setUi] = React.useState<UiState>(freshUi);
  const currentUi = ui.scope === uiScope ? ui : freshUi();
  React.useEffect(() => { setUi((old) => old.scope === uiScope ? old : freshUi()); }, [uiScope, freshUi]);
  function updateStage(id: number, mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) {
    const expectedScope = uiScope;
    setUi((old) => {
      if (latestUiScope.current !== expectedScope || uiLifecycle.current.generation !== uiGeneration || !latestCanWrite.current) return old;
      const base = old.scope === expectedScope ? old : freshUi();
      return { ...base, revision: base.revision + 1, drafts: { ...base.drafts, [id]: mutate(base.drafts[id]!) } };
    });
  }
  function changeReport(text?: string) {
    const expectedScope = uiScope;
    setUi((old) => {
      if (latestUiScope.current !== expectedScope || uiLifecycle.current.generation !== uiGeneration || !latestCanWrite.current) return old;
      const base = old.scope === expectedScope ? old : freshUi();
      return { ...base, report: { text: text ?? aidtUiReportMarkdown(base.drafts, { discoveryCardsRevision: shared.stages[2] && aidtSharedDraftSignature(base.drafts[2]!) === aidtSharedDraftSignature(shared.stages[2].content.draft) ? shared.stages[2].revision : undefined }), sourceRevision: text === undefined ? base.revision : base.report?.sourceRevision ?? base.revision } };
    });
  }
  function keepCheckpoint(id: number) {
    if (!canWrite) return;
    const expectedScope = uiScope;
    setUi((old) => {
      if (latestUiScope.current !== expectedScope || uiLifecycle.current.generation !== uiGeneration || old.scope !== expectedScope || !latestCanWrite.current) return old;
      const text = aidtUiStageSummary(id, old.drafts[id]!);
      if (!text) return old;
      const previous = old.checkpoints[id] ?? [];
      if (previous[previous.length - 1]?.text === text) return old;
      return { ...old, checkpoints: { ...old.checkpoints, [id]: [...previous, { number: previous.length + 1, text }] } };
    });
  }
  const shelfTrigger = React.useRef<HTMLButtonElement>(null);
  const [shelfPreference, setShelfPreference] = React.useState<{ scope: string; open: boolean } | null>(null);
  const [historyScope, setHistoryScope] = React.useState<string | null>(null);
  const [assistantScope, setAssistantScope] = React.useState<string | null>(null);
  const assistantOpen = assistantScope === uiLifecycleKey;
  const assistantTrigger = React.useRef<HTMLButtonElement>(null);
  const closeAssistant = React.useCallback(() => { setAssistantScope(null); assistantTrigger.current?.focus(); }, []);
  const search = useSearchParams();
  const router = useRouter();
  const step = aidtStep(sub);
  const thread = search.get("thread");
  const resource = search.get("resource");
  const returnRevision = search.get("returnRevision");
  const allowed = step ? STEP_TOOLS[step.id] ?? ["chat"] : [];
  const requested = search.get("tool") as Tool | null;
  const explicitResourceView = Boolean(resource && (requested === "design" || requested === "transcript"));
  const tool: Tool = !canWrite && requested === "record" && allowed.includes("transcript") ? "transcript" : requested && (allowed.includes(requested) || requested === "sources" || explicitResourceView) ? requested : "chat";
  const reportMode = step?.id === 6 && (tool === "chat" || tool === "report") && search.get("summary") === "1";
  const summaryThread = search.get("summaryThread");
  const prototypeGate = getAidtPrototypeGenerationReadiness(currentUi.drafts[5]!);
  const designAllowed = step?.id !== 5 || Boolean(returnRevision) || prototypeGate.ready;
  const href = (nextTool: Tool, id?: string) => reportMode && (nextTool === "chat" || nextTool === "report") ? aidtReportChatHref(projectId, { tool: nextTool, threadId: summaryThread, stageThread: thread, returnRevision }) : aidtHref(projectId, step?.id, { tool: nextTool, resource: id, thread, returnRevision });
  const threadResolutionScope = JSON.stringify([uiLifecycleKey, step?.id, reportMode ? summaryThread : thread, reportMode]);
  const [resolvedThread, setResolvedThread] = React.useState<{ scope: string; id: string } | null>(null);
  const onResolvedThread = React.useCallback((id: string) => {
    if (latestUiScope.current !== uiScope || uiLifecycle.current.generation !== uiGeneration) return;
    setResolvedThread({ scope: threadResolutionScope, id });
  }, [uiScope, uiGeneration, threadResolutionScope]);
  const checkpointThread = canWrite ? resolvedThread?.scope === threadResolutionScope ? resolvedThread.id : null : thread;
  const checkpointScope: AidtPersonalStageScope | null = authenticated && identity?.currentOrgId && identity.userId && identity.sessionToken ? { orgId: identity.currentOrgId, userId: identity.userId, projectId, sessionToken: identity.sessionToken } : null;
  const shared = useAidtSharedStages({ enabled: isAidtModuleEnabled(), scope: checkpointScope, lifecycleKey: uiLifecycleKey, stageId: step?.id ?? null, drafts: currentUi.drafts, canWrite, reportText: currentUi.report?.text ?? null, onHydrateReport: (markdown) => {
    setUi(old => {
      if (latestUiScope.current !== uiScope || uiLifecycle.current.generation !== uiGeneration) return old;
      const base = old.scope === uiScope ? old : freshUi();
      return { ...base, report: { text: markdown, sourceRevision: base.revision } };
    });
  }, onHydrate: (id, draft) => {
    // Loading authorized server content is a read projection, including in read-only projects.
    // The hook only hydrates untouched forms; explicit restore remains a separate student action.
    setUi(old => {
      if (latestUiScope.current !== uiScope || uiLifecycle.current.generation !== uiGeneration) return old;
      const base = old.scope === uiScope ? old : freshUi();
      return { ...base, revision: base.revision + 1, drafts: { ...base.drafts, [id]: draft } };
    });
  } });
  const sharedContextRefs = React.useMemo(() => shared.read?.phase === "ready" && step ? aidtStageContextReferences(step.id, shared.stages) : [], [shared.read, shared.stages, step]);
  const personal = useAidtPersonalCheckpoints({ enabled: isAidtModuleEnabled(), scope: checkpointScope, lifecycleKey: uiLifecycleKey, threadId: checkpointThread, stageId: step?.id ?? null, draft: step ? currentUi.drafts[step.id]! : null, canWrite, onRestore: (draft) => { if (step) updateStage(step.id, () => draft); } });
  const latestCheckpointKey = React.useRef(personal.key); latestCheckpointKey.current = personal.key;
  const [disclosure, setDisclosure] = React.useState<{ key: string; reference: AidtSavedContextReference } | null>(null);
  React.useEffect(() => { setDisclosure(null); }, [personal.key]);
  const savedContextRefs = React.useMemo(() => disclosure?.key === personal.key ? [disclosure.reference] : [], [disclosure, personal.key]);
  function sharePersonalCheckpoint(checkpoint: AidtPersonalStageCheckpoint | null) {
    if (latestCheckpointKey.current !== personal.key || latestUiScope.current !== uiScope || uiLifecycle.current.generation !== uiGeneration) return;
    if (!checkpoint) { setDisclosure(null); return; }
    if (!canWrite || !latestCanWrite.current || checkpoint.savedBy !== identity?.userId || checkpoint.threadId !== checkpointThread || checkpoint.stageId !== step?.id || !personal.load?.result.checkpoints.some(item => aidtCheckpointKey(item) === aidtCheckpointKey(checkpoint))) return;
    setDisclosure({ key: personal.key, reference: { stageNumber: checkpoint.stageId, threadId: checkpoint.threadId, artifactId: checkpoint.artifactId, expectedImmutableRevision: checkpoint.immutableRevision, includePrivateDraft: true } });
  }
  // A native resource may open here only after its project association is read back.
  const selected = resource && (tool === "design" || tool === "transcript") ? resource : null;
  const [access, setAccess] = React.useState<{ key: string; error: string | null; allowed: boolean } | null>(null);
  const [retry, setRetry] = React.useState(0);
  const accessKey = aidtResourceScope(identity, projectId, tool, selected, canWrite);
  React.useEffect(() => {
    if (!selected || !authenticated) return;
    let active = true;
    setAccess(null);
    void listProjectResources(projectId).then((out) => {
      if (!active) return;
      const found = out.items.some((it) => it.id === selected && it.kind === (tool === "design" ? "design" : "personal_transcription"));
      setAccess({ key: accessKey, allowed: found, error: found ? null : "该资源未关联当前项目，或你没有访问权限。" });
    }).catch((e: unknown) => { if (active) setAccess({ key: accessKey, allowed: false, error: describeProjectResourceFailure(e) }); });
    return () => { active = false; };
  }, [projectId, tool, selected, accessKey, retry, authenticated]);

  function toChat(text: string): ComposerOfferResult {
    if (!canWrite || !latestCanWrite.current || latestUiScope.current !== uiScope || uiLifecycle.current.generation !== uiGeneration || !identity || !step) return "unavailable";
    const currentThread = new URLSearchParams(window.location.search).get(reportMode ? "summaryThread" : "thread");
    const result = offerComposerDraft({ orgId: identity.currentOrgId, userId: identity.userId, projectId, threadId: currentThread }, text);
    if (result === "accepted" && tool !== "chat") router.push(reportMode ? aidtReportChatHref(projectId, { threadId: currentThread, stageThread: thread, returnRevision }) : aidtHref(projectId, step.id, { tool: "chat", thread: currentThread, returnRevision }));
    return result;
  }
  if (!step) return <div className="space-y-6 overflow-y-auto p-4"><AidtDashboard href={(id) => aidtHref(projectId, id)} drafts={currentUi.drafts} shared={{ phase: shared.read?.phase ?? (shared.available ? "loading" : "error"), stages: shared.stages, error: shared.read?.error ?? (shared.available ? undefined : "登录后可读取本组已保存成果。"), reload: shared.reload }} /><AidtMaterials key={uiScope} projectId={projectId} /></div>;
  function resourceHref(kind: ProjectResourceKind, id: string) {
    if (kind === "design") return href("design", id);
    if (kind === "personal_transcription") return href("transcript", id);
    const url = new URL(projectResourceHref(kind, id, projectId), "https://workspace.invalid");
    url.searchParams.set("aidtStep", String(step!.id));
    if (thread) url.searchParams.set("aidtThread", thread);
    if (returnRevision) url.searchParams.set("aidtReturnRevision", returnRevision);
    return `${url.pathname}${url.search}`;
  }
  function createdHref(raw: string) {
    const url = new URL(raw, "https://workspace.invalid");
    if (tool === "design") return href("design", decodeURIComponent(url.pathname.split("/").pop() ?? ""));
    url.searchParams.set("aidtStep", String(step!.id));
    if (thread) url.searchParams.set("aidtThread", thread);
    if (returnRevision) url.searchParams.set("aidtReturnRevision", returnRevision);
    return `${url.pathname}${url.search}`;
  }
  const outcomeStatus = !shared.available ? null : !shared.read || shared.read.phase === "loading" ? "读取中" : shared.read.phase === "error" ? "读取失败" : shared.write.phase === "conflict" ? "需核对版本" : shared.write.phase === "error" ? "保存未确认" : shared.matchesServer ? `V${shared.server?.revision} 已保存` : shared.server || aidtUiStageSummary(step.id, currentUi.drafts[step.id]!) ? "有未保存修改" : null;
  const nextStep = AIDT_STEPS.find(({ id }) => id === step.id + 1);
  function navigateWorkspace(event: React.MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return;
    const target = new URL(link.href);
    const current = new URL(window.location.href);
    if (target.origin !== current.origin || target.pathname !== current.pathname || target.hash) return;
    if (!link.hasAttribute("data-aidt-reset-thread") && target.searchParams.get("step") === current.searchParams.get("step")) {
      for (const key of ["thread", ...(target.searchParams.has("summary") ? ["summaryThread"] : [])]) {
        const value = current.searchParams.get(key);
        if (value && !target.searchParams.has(key)) target.searchParams.set(key, value);
      }
    }
    // Commit same-page navigation before background Chat resolution can update the URL.
    event.preventDefault();
    if (target.href !== current.href) window.history.pushState(null, "", target);
  }
  const sideTool = tool === "outcome" || tool === "context" || tool === "report";
  const shelfOpen = shelfPreference?.scope === uiLifecycleKey ? shelfPreference.open : undefined;
  function closeShelf() {
    setShelfPreference({ scope: uiLifecycleKey, open: false });
    shelfTrigger.current?.focus();
  }
  const reportHref = canWrite ? aidtReportChatHref(projectId, { stageThread: step.id === 6 ? thread : null, threadId: summaryThread, returnRevision }) : aidtHref(projectId, 6, { tool: "report" });
  const sharedProblem = shared.available && (shared.read?.phase === "error" || shared.write.phase === "error" || shared.write.phase === "conflict");
  return <section className="flex min-h-0 flex-1 flex-col" data-testid="aidt-workspace" onClickCapture={navigateWorkspace}>
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row xl:gap-3 xl:bg-background xl:p-3">
    <div className="shrink-0 px-3 xl:w-44 xl:px-0">
      <Link href={aidtHref(projectId)} className="block rounded-lg px-2 py-2 text-12 text-muted-foreground transition-colors hover:bg-muted">← 六步研究</Link>
      <AidtStageNavigation stageNumber={step.id} href={(id) => aidtHref(projectId, id)} reportHref={reportHref} reportActive={tool === "report" || reportMode} />
    </div>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex shrink-0 flex-col gap-2 rounded-t-xl border-b border-border-subtle bg-card p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><h1 className="sr-only font-semibold md:not-sr-only md:text-20">{reportMode || tool === "report" ? "总结归档" : `${step.id}. ${step.title}`}</h1>
      <details className="text-12 text-muted-foreground"><summary className="cursor-pointer">本步目标与学习提示</summary><p className="mt-2">{step.task}</p><p className="mt-1">本步产出：{step.outcome}</p><p className="mt-1">步骤完成与小组确认暂未记录。</p><AidtLearningStart step={step} /><AidtDecisionGuide key={step.id} step={step} />{step.id === 6 && <nav className="mt-3 flex flex-wrap gap-2" aria-label="迭代返回步骤"><p className="w-full">由本组决定下一假设，再回到相应步骤：</p>{AIDT_STEPS.filter((it) => it.id >= 1 && it.id <= 5).map((it) => <Link className="rounded border border-border px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring" key={it.id} href={aidtHref(projectId, it.id)}>回到 {it.id}. {it.title}</Link>)}</nav>}</details></div>
      {!canWrite && <p role="status" className="text-12 text-muted-foreground" data-testid="aidt-readonly">当前项目只读。可查看已关联资料，不能在此发起对话、录音或设计编辑。</p>}
      <div className="flex flex-wrap items-center gap-2">{tool === "chat" && <Button ref={shelfTrigger} type="button" variant="outline" size="sm" aria-controls="aidt-artifact-shelf" aria-pressed={shelfOpen} onClick={() => setShelfPreference({ scope: uiLifecycleKey, open: shelfOpen === undefined ? !window.matchMedia("(min-width: 1280px)").matches : !shelfOpen })}>小组成果</Button>}{tool !== "chat" && <Button className={sideTool ? "xl:hidden" : undefined} ref={assistantTrigger} size="sm" variant="outline" aria-expanded={assistantOpen} onClick={() => setAssistantScope((value) => value === uiLifecycleKey ? null : uiLifecycleKey)}>AI 引导师</Button>}<Button asChild size="sm" variant={tool === "outcome" ? "primary" : "outline"}><Link href={href("outcome")} data-testid="aidt-open-output" title="聊天发送与本步成果保存分别处理">本步任务{outcomeStatus && <span className="text-11"> · {outcomeStatus}</span>}</Link></Button>{step.id === 6 && <Button asChild size="sm" variant={tool === "report" ? "primary" : "outline"}><Link href={href("report")} data-testid="aidt-open-report">整理小组研究报告</Link></Button>}<Button asChild size="sm" variant={tool === "context" ? "primary" : "outline"}><Link href={href("context")}>阶段交接</Link></Button>{tool !== "chat" && <Button asChild size="sm" variant="outline"><Link href={href("chat")}>返回本步对话</Link></Button>}<details data-testid="aidt-tools"><summary className="cursor-pointer rounded-md border border-border px-3 py-2 text-12">资料与工具{tool !== "chat" ? ` · ${TOOLS[tool]}` : ""}</summary><div className="mt-2 max-h-80 space-y-3 overflow-y-auto"><nav className="flex flex-wrap gap-2" aria-label="本步工作区">{allowed.filter((key) => key !== "chat" && key !== "outcome" && key !== "context" && key !== "report" && (canWrite || key !== "record")).map((key) => <Button asChild key={key} size="sm" variant={tool === key ? "primary" : "outline"}><Link href={href(key)} aria-current={tool === key ? "page" : undefined}>{TOOLS[key]}</Link></Button>)}</nav><details className="border-t border-border py-1 text-12"><summary className="cursor-pointer text-muted-foreground">高级：个人检查点</summary><AidtPersonalCheckpointPanel key={personal.key} stageNumber={step.id} controller={personal} readOnly={!canWrite} onShare={sharePersonalCheckpoint} sharedCheckpointKey={savedContextRefs[0] ? JSON.stringify([savedContextRefs[0].artifactId, savedContextRefs[0].expectedImmutableRevision]) : undefined} /></details></div></details></div>
    </header>
    {tool !== "outcome" && tool !== "report" && sharedProblem && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-12" data-testid="aidt-shared-chat-alert"><span>{shared.read?.phase === "error" ? "本步成果读取失败。" : shared.write.phase === "conflict" ? "本步成果有版本冲突，本页修改仍保留。" : "本步成果保存尚未确认，本页修改仍保留。"}</span><Link className="text-primary underline" href={href("outcome")}>进入成果核对</Link>{shared.read?.phase === "error" && <Button size="sm" variant="outline" onClick={shared.reload}>重试读取</Button>}</div>}
    <div className="relative flex min-h-0 flex-1 overflow-hidden xl:gap-3 xl:pt-3">
      <AidtAssistantPanel open={assistantOpen} fullPage={tool === "chat"} docked={sideTool} onClose={closeAssistant}>
        {canWrite ? <div className="min-h-0 flex-1" data-testid="aidt-native-chat"><Chat key={`${uiScope}:${step.id}:${reportMode ? "report" : "stage"}`} projectId={projectId} step={step} thread={reportMode ? summaryThread : thread} purpose={reportMode ? "report" : undefined} returnRevision={returnRevision} taskHref={href(reportMode ? "report" : "outcome")} onResolvedThread={onResolvedThread} savedContextRefs={savedContextRefs} sharedContextRefs={sharedContextRefs} sharedContextReady={shared.read?.phase === "ready"} /></div> : <ProjectConversations key={uiScope} projectId={projectId} canWrite={false} />}
      </AidtAssistantPanel>
      {tool === "chat" && <aside id="aidt-artifact-shelf" aria-label="小组成果" onKeyDown={event => { if (event.key === "Escape") closeShelf(); }} className={`${shelfOpen === false ? "hidden" : shelfOpen ? "flex" : "hidden xl:flex"} absolute inset-y-0 right-0 z-30 w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-2xl border border-border-subtle bg-card p-4 shadow-lg xl:static xl:w-80 xl:shrink-0 xl:shadow-sm`}>
        <div className="flex items-center justify-between gap-2"><h2 className="text-16 font-semibold">小组成果</h2><Button size="xs" variant="ghost" onClick={closeShelf}>关闭成果</Button></div>
        <AidtArtifactShelf key={uiLifecycleKey} stages={shared.stages} stageId={step.id} projectId={projectId} sessionToken={checkpointScope?.sessionToken ?? null} phase={shared.read?.phase ?? (shared.available ? "loading" : "error")} retry={shared.available ? shared.reload : undefined} onReference={canWrite && !reportMode ? (version) => {
          const result = toChat(`我想参考第 ${version.stageId} 步已保存成果 V${version.revision}。以下是小组记录，请协助核对：\n${aidtUiStageSummary(version.stageId, version.content.draft)}`);
          if (result === "accepted" && !window.matchMedia("(min-width: 1280px)").matches) setShelfPreference({ scope: uiLifecycleKey, open: false });
          return result;
        } : undefined} />
      </aside>}
      {tool !== "chat" && <aside className={`flex w-full shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-border-subtle bg-card p-4 ${sideTool ? "xl:w-2/5 xl:min-w-0 xl:max-w-lg xl:shadow-sm" : ""}`} aria-label={TOOLS[tool]} data-testid="aidt-tool-panel">
        <div className="flex items-center justify-between gap-3"><h2 className="text-14 font-semibold">{TOOLS[tool]}</h2><Link className="rounded-md border border-border px-3 py-2 text-12 focus-visible:ring-2 focus-visible:ring-ring" href={href("chat")}>关闭工具，回到对话</Link></div>
        {tool === "outcome" && <AidtSharedStagePanel key={shared.writeKey} stageNumber={step.id} controller={shared} readOnly={!canWrite} />}
        {(tool === "sources" || tool === "transcript" || tool === "record") && <AidtEvidenceGuide />}
        {tool === "outcome" ? <>
          <section className="space-y-2 rounded-lg border border-border p-4 text-13" aria-label="当前学习任务">
            <p>{step.task}</p>
            {step.id > 1 && <details>
              <summary className="cursor-pointer font-medium">{shared.stages[step.id - 1] ? `查看上一步已保存成果 · V${shared.stages[step.id - 1]!.revision}` : "查看上一步材料状态"}</summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{shared.stages[step.id - 1] ? aidtUiStageSummary(step.id - 1, shared.stages[step.id - 1]!.content.draft) : shared.read?.phase === "ready" ? "上一步还没有小组保存版本。" : "上一步材料尚未读取成功。"}</p>
              <Link className="mt-2 inline-block text-primary underline" href={href("context")}>查看阶段交接</Link>
            </details>}
          </section>
          <AidtStageOutput key={`${uiScope}:${step.id}`} projectId={projectId} thread={checkpointThread} step={step} draft={currentUi.drafts[step.id]!} availableCards={shared.stages[2]?.content.draft.discoveryCards ?? []} availableCardsRevision={shared.stages[2]?.revision} previousPrototype={shared.stages[5]?.content.draft} previousPrototypeRevision={shared.stages[5]?.revision} update={(mutate) => updateStage(step.id, mutate)} readOnly={!canWrite} toolHref={(key) => href(key as Tool)} toChat={toChat} />
          {shared.matchesServer && nextStep && <div className="flex justify-end">
            <Button asChild><Link href={aidtHref(projectId, nextStep.id)}>打开第{nextStep.id}步 · {nextStep.title}</Link></Button>
          </div>}
          <AidtRoundNavigation projectId={projectId} stageNumber={step.id} draft={currentUi.drafts[step.id]!} savedRound={shared.stages[6]} matchesServer={shared.matchesServer} returnRevision={search.get("returnRevision")} sessionToken={checkpointScope?.sessionToken ?? null} />
          {step.id === 6 && <AidtNextRound draft={currentUi.drafts[6]!} savedRevision={shared.stages[6]?.revision} matchesServer={shared.matchesServer} readOnly={!canWrite} onStart={() => updateStage(6, old => ({ ...old, fields: {} }))} />}
          <details className="mt-4 border-t border-border pt-3 text-12" onToggle={event => setHistoryScope(event.currentTarget.open ? `${uiLifecycleKey}:${step.id}` : null)} data-testid="aidt-history-disclosure"><summary className="cursor-pointer font-medium">查看本步历史版本</summary>{historyScope === `${uiLifecycleKey}:${step.id}` && <AidtStageHistory projectId={projectId} stageId={step.id} sessionToken={checkpointScope?.sessionToken ?? null} currentRevision={shared.stages[step.id]?.revision} />}</details>
          <AidtStageJourney key={`journey:${uiScope}:${step.id}`} stageNumber={step.id}
          inputText={step.id > 1 ? `前序当前草稿（供参考，未自动继承或验证）：\n${aidtUiStageSummary(step.id - 1, currentUi.drafts[step.id - 1]!) || "尚缺前序填写"}` : "先记录本组自己的观察、问题、人群与场景。聊天内容由学生主动整理进成果。"}
          currentOutput={aidtUiStageSummary(step.id, currentUi.drafts[step.id]!)} checkpoints={currentUi.checkpoints[step.id] ?? []}
          onKeepCheckpoint={() => keepCheckpoint(step.id)} readOnly={!canWrite}
          reportNote="原生报告当前整理本页最新草稿；这里的对照记录未自动写入共享报告。" />
</>
        : tool === "context" ? <><AidtStageBridge key={`${uiScope}:${step.id}`} projectId={projectId} stageNumber={step.id} drafts={currentUi.drafts} discoveryCardsRevision={shared.stages[2] && aidtSharedDraftSignature(currentUi.drafts[2]!) === aidtSharedDraftSignature(shared.stages[2].content.draft) ? shared.stages[2].revision : undefined} toChat={toChat} readOnly={!canWrite} /><AidtMaterials key={uiScope} projectId={projectId} stageNumber={step.id} thread={thread} returnRevision={returnRevision} /></>
        : tool === "report" ? <AidtReportPreview key={uiScope} drafts={currentUi.drafts} discoveryCardsRevision={shared.stages[2] && aidtSharedDraftSignature(currentUi.drafts[2]!) === aidtSharedDraftSignature(shared.stages[2].content.draft) ? shared.stages[2].revision : undefined} text={currentUi.report?.text ?? null} sourceRevision={currentUi.report?.sourceRevision ?? currentUi.revision} revision={currentUi.revision} onChange={(text) => changeReport(text)} regenerate={() => changeReport()} readOnly={!canWrite} toChat={toChat} shared={shared.report} onOpenSummary={() => router.push(aidtReportChatHref(projectId, { threadId: summaryThread, stageThread: thread, returnRevision }))} summaryThread={reportMode ? summaryThread : null} historyScope={checkpointScope ? { ...checkpointScope, lifecycleKey: uiLifecycleKey } : undefined} />
        : tool === "sources" ? <ProjectEvidenceSection key={uiScope} projectId={projectId} />
        : tool === "record" ? canWrite ? <div data-testid="aidt-native-recording"><p className="px-4 text-12 text-muted-foreground">个人录音笔记只用于自己的思考。不得借此绕过项目访谈的参与者同意校验；项目访谈同意采集入口尚未集成。</p><Transcription key={uiScope} uiState="default" projectId={projectId} /></div> : null
        : selected ? !authenticated ? <p role="status" className="p-4 text-12 text-muted-foreground">登录后可查看关联资源。</p> : access?.key !== accessKey ? loading() : access.error ? <div role="alert" data-testid="aidt-resource-error" className="p-4"><p>{access.error}</p><Button variant="outline" onClick={() => setRetry((n) => n + 1)}>重试</Button></div>
          : access.allowed && canWrite ? tool === "design" ? !designAllowed ? <div className="space-y-3 p-4 text-13" data-testid="aidt-design-question-required"><p>{prototypeGate.reason}</p><Button asChild variant="outline"><Link href={href("outcome")}>回到验证问题卡</Link></Button><p className="text-12 text-muted-foreground">原有设计资料仍保留，可在项目资料中查看。本教学入口在学生确认问题后继续原型制作。</p></div> : <Design key={`${uiLifecycleKey}:${step.id}:${selected}`} projectId={selected} teachingProjectId={projectId} stageId={step.id} lifecycleKey={uiLifecycleKey} sessionToken={checkpointScope?.sessionToken ?? null} returnRevision={returnRevision} onBack={() => router.push(href("design"))} onNextDesign={() => router.push(href("design"))} /> : <Transcription key={selected} uiState="default" projectId={projectId} initialSessionId={selected} />
          : <p className="p-4 text-12 text-muted-foreground">项目只读，请返回资料列表查看资源摘要。</p>
        : tool === "design" && !designAllowed ? <div className="space-y-3 p-4 text-13" data-testid="aidt-design-question-required"><p>{prototypeGate.reason}</p><Button asChild variant="outline"><Link href={href("outcome")}>回到验证问题卡</Link></Button><p className="text-12 text-muted-foreground">原有设计资料仍保留，可在项目资料中查看。本教学入口在学生确认问题后继续原型制作。</p></div>
        : <ProjectResourceSection key={`${uiScope}:${tool}`} projectId={projectId} kind={tool as ProjectResearchSub} canWrite={canWrite} resourceHref={resourceHref} transformCreateHref={createdHref} />}
      </aside>}
    </div>
    </div>
    </div>
  </section>;
}
