"use client";
import { aidtInterviewTitle } from "@repo/contracts/aidt-stages";
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
import { useAidtInterviewReconcile } from "../lib/use-aidt-interview-reconcile";
import { AidtInterviewSaveState } from "./aidt-interview-save-state";
import { AidtInterviewConversation } from "./aidt-interview-conversation";
import { AidtInterviewWorkspace } from "./aidt-interview-workspace";
import { AidtDefinitionChatArtifact, AidtDefinitionDirectory, AidtDefinitionOutput } from "./aidt-definition";
import { AidtIdeaConversation } from "./aidt-idea-conversation";
import { AidtIdeaOutput } from "./aidt-idea-output";
import { AidtIdeaDirectory } from "./aidt-idea-directory";
import { AidtPrototypeDirectory } from "./aidt-prototype-directory";
import { AidtTestConversation, AidtTestGroupOutput } from "./aidt-test-conversation";
import type { AidtTestProposal } from "../lib/aidt-test-proposal";
import { AidtTestGroupDirectory } from "./aidt-test-group-directory";
import { listAidtConfirmedPrototypeEntities } from "../lib/aidt-prototype-handoff";
import { aidtInterviewHandoffReady, isAidtInterviewArchived, readAidtInterviews, savedAidtInterviewArtifactTitle } from "../lib/aidt-interviews";
import { readAidtDefinitionSelection } from "../lib/aidt-definition";
import { readAidtStageRevision, type AidtSharedStage } from "../lib/live-aidt-stages";
import { AidtProblemDirectory } from "./aidt-problem-directory";
import { listAidtProblems, readAidtProblemEntityDraft, updateAidtProblemEntity } from "../lib/aidt-problem-entities";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AidtReportDirectory } from "./aidt-report-directory";
import { AidtReportConversation } from "./aidt-report-conversation";
import { AidtReportOutput } from "./aidt-report-output";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { aidtReportChatHref } from "../lib/aidt-report-task";
import { AidtStageBridge } from "@/features/aidt/components/aidt-stage-bridge";
import { AidtMaterials } from "@/features/aidt/components/aidt-materials";
import { offerComposerDraft, type ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AIDT_STEPS, aidtHref, aidtStep } from "@/features/aidt/lib/project-aidt";
import { listProjectResources, type ProjectResourceKind } from "@/lib/live-project-resources";
import { AidtEvidenceGuide } from "@/features/aidt/components/aidt-learning-guide";
import { AidtDashboard } from "@/features/aidt/components/project-aidt-dashboard";
import { ProjectConversations } from "@/components/project/project-conversations";
import { ProjectResourceSection, projectResourceHref, describeProjectResourceFailure } from "@/components/project/project-resource-section";
import { ProjectEvidenceSection } from "@/components/project/project-evidence-section";
import type { ProjectResearchSub } from "@/components/project/project-links";

import { AidtArtifactShelf } from "./aidt-artifact-shelf";
import { AidtStageHistory } from "./aidt-stage-history";
import { resetAidtTestRound } from "../lib/aidt-test-groups";
import { AidtNextRound } from "./aidt-next-round";
import { AidtRoundNavigation } from "./aidt-round-navigation";
import { ArrowLeft } from "lucide-react";
import { ChatHostConversationContext } from "@/components/chat/chat-host-panel";
import { AidtProblemChatReview } from "./aidt-problem-chat-review";
import { AidtProblemWorkspace } from "./aidt-problem-workspace";
import { useAidtConfirmedStages } from "../lib/use-aidt-confirmed-stages";
import { useAidtReportReview } from "../lib/use-aidt-report-review";
import { AidtRoundCompletion } from "./aidt-round-completion";
import { aidtStageContextReferences } from "../lib/aidt-native-context-selector";
import { getAidtPrototypeGenerationReadiness } from "../lib/aidt-verification-loop";
import { AidtPrototypeConversation, AidtPrototypeEntityOutput } from "./aidt-prototype-handoff";
import { aidtPrototypePreparationError, readAidtConfirmedPrototypeHandoff, readAidtPrototypeEntityDraft } from "../lib/aidt-prototype-handoff";

const loading = () => <p role="status" className="p-4 text-12 text-muted-foreground">正在加载工作区…</p>;
const Chat = dynamic(() => import("@/features/aidt/components/project-aidt-chat").then((m) => m.ProjectAidtChat), { loading });
const Transcription = dynamic(() => import("@/components/rec/transcription-history").then((m) => m.TranscriptionHistory), { loading });
const Design = dynamic(() => import("@/features/aidt/components/aidt-design-workspace").then((m) => m.AidtDesignWorkspace), { loading });

const wideViewport = "(min-width: 1024px)";
function subscribeViewport(listener: () => void) {
  const query = window.matchMedia?.(wideViewport);
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}
const isWide = () => Boolean(window.matchMedia?.(wideViewport).matches);
const serverViewport = () => false;

const TOOLS = {
  outcome: "成果", context: "资料", report: "小组报告", chat: "讨论与产出物", sources: "真实证据", transcript: "转录资料", record: "个人录音笔记",
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

function readInterviewProblemSource(fields: Record<string, string>, interviewId: string) {
  const raw = fields["interviewRecord:" + interviewId];
  if (!raw) return undefined;
  try {
    const record = JSON.parse(raw) as { id?: string; problemEntityId?: string; topicRevision?: number };
    if (record?.id === interviewId && typeof record.problemEntityId === "string"
      && Number.isInteger(record.topicRevision) && record.topicRevision! > 0) {
      return { id: record.problemEntityId, revision: record.topicRevision! };
    }
  } catch {
    return undefined;
  }
}

function AidtOpenOnNewTurn({ messages, loading, open }: {
  messages: readonly { id: string; role: string; content?: unknown }[];
  loading: boolean;
  open: () => void;
}) {
  const seen = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (loading) return;
    const ids = messages.filter(message => (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string" && message.content.trim()).map(message => message.id);
    const previous = seen.current;
    seen.current = new Set(ids);
    if (previous && ids.some(id => !previous.has(id))) open();
  }, [messages, loading, open]);
  return null;
}

export function ProjectAidt({ projectId, projectName, sub, canWrite, activePrototypeId, activeEntityId }: { projectId: string; projectName?: string; sub: string | null; canWrite: boolean; activePrototypeId?: string; activeEntityId?: string }) {
  const identity = useOptionalSession()?.session;
  const authenticated = hasAidtIdentity(identity);
  const search = useSearchParams();
  const reportEntityId = activeEntityId === "group-report" ? undefined : search.get("step") === "6" && search.get("summary") === "1" ? search.get("entity") ?? undefined : undefined;
  const reportDraftKey = reportEntityId && reportEntityId !== "group-report" ? `entity:${reportEntityId}` : "legacy";
  const uiScope = aidtDraftScope(identity, projectId);
  const latestUiScope = React.useRef(uiScope); latestUiScope.current = uiScope;
  // Actor keys can recur (A -> B -> A). Old local reads belong to the earlier
  // lifecycle even when the returning actor and default candidate IDs match.
  const uiLifecycle = React.useRef({ scope: uiScope, generation: 0 });
  if (uiLifecycle.current.scope !== uiScope) uiLifecycle.current = { scope: uiScope, generation: uiLifecycle.current.generation + 1 };
  const uiGeneration = uiLifecycle.current.generation;
  const uiLifecycleKey = JSON.stringify([uiScope, uiGeneration]);
  const latestCanWrite = React.useRef(canWrite); latestCanWrite.current = canWrite;
  type UiState = { scope: string; drafts: AidtUiDrafts; checkpoints: Record<number, AidtReviewCheckpoint[]>; revision: number; reports: Record<string, { text: string; sourceRevision: number }> };
  const freshUi = React.useCallback((): UiState => ({ scope: uiScope, drafts: emptyAidtUiDrafts(), checkpoints: {}, revision: 0, reports: {} }), [uiScope]);
  const [ui, setUi] = React.useState<UiState>(freshUi);
  const currentUi = ui.scope === uiScope ? ui : freshUi();
  React.useEffect(() => { setUi((old) => old.scope === uiScope ? old : freshUi()); }, [uiScope, freshUi]);
  function updateStage(id: number, mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) {
    const expectedScope = uiScope;
    setUi((old) => {
      if (latestUiScope.current !== expectedScope || uiLifecycle.current.generation !== uiGeneration || !latestCanWrite.current) return old;
      const base = old.scope === expectedScope ? old : freshUi();
      return { ...base, revision: base.revision + 1, drafts: { ...base.drafts, [id]: id === 1 && activeEntityId ? updateAidtProblemEntity(base.drafts[id]!, activeEntityId, mutate) : mutate(base.drafts[id]!) } };
    });
  }
  function changeReport(text?: string) {
    const expectedScope = uiScope;
    setUi((old) => {
      if (latestUiScope.current !== expectedScope || uiLifecycle.current.generation !== uiGeneration || !latestCanWrite.current) return old;
      const base = old.scope === expectedScope ? old : freshUi();
      const entry = {
        text: text ?? aidtUiReportMarkdown(base.drafts, { discoveryCardsRevision: shared.stages[2] && aidtSharedDraftSignature(base.drafts[2]!) === aidtSharedDraftSignature(shared.stages[2].content.draft) ? shared.stages[2].revision : undefined }),
        sourceRevision: text === undefined ? base.revision : base.reports[reportDraftKey]?.sourceRevision ?? base.revision,
      };
      return { ...base, reports: { ...base.reports, [reportDraftKey]: entry } };
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
  const [referencePanel, setReferencePanel] = React.useState<HTMLDivElement | null>(null);
  const [historyScope, setHistoryScope] = React.useState<string | null>(null);
  const [toolsScope, setToolsScope] = React.useState<string | null>(null);
  const router = useRouter();
  const step = aidtStep(sub);
  const problemStep = step?.id === 1;

  const wide = React.useSyncExternalStore(subscribeViewport, isWide, serverViewport);
  const [interviewEditScope, setInterviewEditScope] = React.useState<string | null>(null);
  const thread = search.get("thread");
  const resource = search.get("resource");
  const returnRevision = search.get("returnRevision");
  const allowed = step ? STEP_TOOLS[step.id] ?? ["chat"] : [];
  const rawTool = search.get("tool") as Tool | null;
  const isEntityReport = Boolean(activeEntityId && step?.id === 6 && search.get("summary") === "1");
  const requested = !activeEntityId || rawTool === "chat" || rawTool === "outcome"
    || (step?.id === 5 && rawTool === "design" && resource === activeEntityId)
    || (isEntityReport && rawTool === "report") ? rawTool : "chat";
  const explicitResourceView = Boolean(resource && (requested === "design" || requested === "transcript"));
  const tool: Tool = !canWrite && requested === "record" && allowed.includes("transcript") ? "transcript" : requested && (allowed.includes(requested) || requested === "sources" || explicitResourceView) ? requested : problemStep && canWrite && !requested && wide ? "outcome" : "chat";
  const reportMode = step?.id === 6 && (tool === "chat" || tool === "report") && search.get("summary") === "1";
  const summaryThread = search.get("summaryThread");
  const prototypeEntityId = step?.id === 5 ? activeEntityId ?? activePrototypeId : undefined;
  const prototypeDraft = currentUi.drafts[5]!;
  const entityPrototypeDraft = prototypeEntityId ? readAidtPrototypeEntityDraft(prototypeDraft, prototypeEntityId) : null;
  const entityPrototypeGate = entityPrototypeDraft ? aidtPrototypePreparationError(entityPrototypeDraft) : "请先保存这份原型的验证问题和制作说明。";
  const prototypeGate = prototypeEntityId ? { ready: !entityPrototypeGate, reason: entityPrototypeGate } : getAidtPrototypeGenerationReadiness(prototypeDraft);
  const designAllowed = step?.id !== 5 || Boolean(returnRevision) || prototypeGate.ready;
  const ideaRevision = search.get("ideaRevision");
  const hmwRevision = step?.id === 4 ? search.get("hmwRevision") : null;
  const href = (nextTool: Tool, id?: string) => {
    const base = reportMode && (nextTool === "chat" || nextTool === "report")
      ? aidtReportChatHref(projectId, { tool: nextTool, threadId: summaryThread, stageThread: activeEntityId ? null : thread, entityId: reportEntityId, returnRevision })
      : aidtHref(projectId, step?.id, { tool: nextTool, resource: nextTool === "design" && prototypeEntityId ? prototypeEntityId : id, thread, returnRevision });
    if (!activeEntityId) return search.get("history") === "1" ? base + "&history=1" : base;
    const [pathname, query] = base.split("?");
    const params = new URLSearchParams(query);
    params.set("entity", activeEntityId);
    for (const key of ["entityRevision", "hmwRevision", "ideaRevision", "prototypeEntity", "prototypeRevision", "sourceId", "timestamp", "problemEntity", "problemRevision"]) {
      const value = search.get(key);
      if (value) params.set(key, value);
    }
    return pathname + "?" + params;
  };
  const activeInterview = step?.id === 2 && activeEntityId ? readAidtInterviews(currentUi.drafts[2]!.fields).find(item => item.id === activeEntityId) : undefined;
  const sourceProblem = step?.id === 2 && activeEntityId
    ? readInterviewProblemSource(currentUi.drafts[2]!.fields, activeEntityId)
    : undefined;
  const threadResolutionScope = JSON.stringify([uiLifecycleKey, step?.id, activeEntityId ?? (reportMode ? summaryThread : thread), reportMode]);
  const [resolvedThread, setResolvedThread] = React.useState<{ scope: string; id: string } | null>(null);
  const onResolvedThread = React.useCallback((id: string) => {
    if (latestUiScope.current !== uiScope || uiLifecycle.current.generation !== uiGeneration) return;
    setResolvedThread({ scope: threadResolutionScope, id });
  }, [uiScope, uiGeneration, threadResolutionScope]);
  const checkpointThread = canWrite ? resolvedThread?.scope === threadResolutionScope ? resolvedThread.id : null : thread;
  const checkpointScope: AidtPersonalStageScope | null = authenticated && identity?.currentOrgId && identity.userId && identity.sessionToken ? { orgId: identity.currentOrgId, userId: identity.userId, projectId, sessionToken: identity.sessionToken } : null;
  const shared = useAidtSharedStages({ enabled: isAidtModuleEnabled(), scope: checkpointScope, lifecycleKey: uiLifecycleKey, stageId: step?.id ?? null, drafts: currentUi.drafts, canWrite, reportEntityId, reportText: currentUi.reports[reportDraftKey]?.text ?? null, onHydrateReport: (markdown) => {
    setUi(old => {
      if (latestUiScope.current !== uiScope || uiLifecycle.current.generation !== uiGeneration) return old;
      const base = old.scope === uiScope ? old : freshUi();
      return { ...base, reports: { ...base.reports, [reportDraftKey]: { text: markdown, sourceRevision: base.revision } } };
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
  const savedProblemStage = shared.stages[1];
  const savedProblem = savedProblemStage?.content.draft ?? emptyAidtUiDrafts()[1]!;
  const problemDraft = activeEntityId ? readAidtProblemEntityDraft(savedProblem, activeEntityId) : savedProblem;
  const interviewReadback = useAidtInterviewReconcile(projectId, activeInterview?.id, canWrite ? identity?.sessionToken ?? undefined : undefined, shared.matchesServer && shared.read?.phase === "ready" && shared.write.phase !== "saving", () => shared.refreshCurrentStage({ fallbackToReload: false }));
  const [testProposal, setTestProposal] = React.useState<{ scope: string; proposal: AidtTestProposal | null }>();
  const [reportProposal, setReportProposal] = React.useState<{ scope: string; markdown: string }>();
  const reportHistoryScope = checkpointScope ? { ...checkpointScope, lifecycleKey: uiLifecycleKey } : undefined;
  const reportText = currentUi.reports[reportDraftKey]?.text ?? null;
  const [pendingEntitySave, setPendingEntitySave] = React.useState<string | null>(null);
  const entitySaveScope = JSON.stringify([shared.writeKey, activeEntityId]);
  function requestEntitySave() {
    if (canWrite && step) setPendingEntitySave(entitySaveScope);
  }
  React.useEffect(() => {
    if (pendingEntitySave === null) return;
    if (pendingEntitySave !== entitySaveScope || !canWrite || shared.needsBaseReview) {
      setPendingEntitySave(null);
      return;
    }
    if (!shared.canSave) return;
    setPendingEntitySave(null);
    if (!shared.matchesServer) void shared.saveCurrent();
  }, [pendingEntitySave, entitySaveScope, canWrite, shared]);
  const latestHmwStage = shared.stages[3];
  const hmwSessionToken = checkpointScope?.sessionToken;
  const reportReview = useAidtReportReview({
    scope: JSON.stringify([uiLifecycleKey, identity?.sessionToken ?? null, reportDraftKey, activeEntityId ?? null, tool === "report", canWrite]),
    serverRevision: shared.report.serverRevision,
    markdown: currentUi.reports[reportDraftKey]?.text ?? aidtUiReportMarkdown(currentUi.drafts, {
      discoveryCardsRevision: shared.stages[2] && aidtSharedDraftSignature(currentUi.drafts[2]!) === aidtSharedDraftSignature(shared.stages[2].content.draft) ? shared.stages[2].revision : undefined,
    }),
    sources: shared.report.sourceStageRevisions ?? [], selectedSources: shared.report.selectedSources ?? [],
    canConfirm: Boolean(shared.report.canConfirm), initialPreview: reportMode,
  });
  const hmwScope = JSON.stringify([uiLifecycleKey, hmwSessionToken, hmwRevision]);
  const [historicalHmw, setHistoricalHmw] = React.useState<{ scope: string; stage: AidtSharedStage | null }>();
  React.useEffect(() => {
    if (hmwRevision === null || String(latestHmwStage?.revision) === hmwRevision || !hmwSessionToken) return;
    const revision = Number(hmwRevision);
    if (!Number.isInteger(revision) || revision < 1 || revision > 2147483647 || String(revision) !== hmwRevision) return;
    const controller = new AbortController();
    void readAidtStageRevision(projectId, 3, revision, hmwSessionToken, controller.signal)
      .then(stage => { if (!controller.signal.aborted) setHistoricalHmw({ scope: hmwScope, stage }); })
      .catch(() => { if (!controller.signal.aborted) setHistoricalHmw({ scope: hmwScope, stage: null }); });
    return () => controller.abort();
  }, [hmwRevision, latestHmwStage?.revision, hmwSessionToken, hmwScope, projectId]);
  const sharedContextRefs = React.useMemo(() => !activeEntityId && shared.read?.phase === "ready" && step ? aidtStageContextReferences(step.id, shared.stages) : [], [activeEntityId, shared.read, shared.stages, step]);
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
  const selected = tool === "design" && prototypeEntityId ? prototypeEntityId : resource && (tool === "design" || tool === "transcript") ? resource : null;
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

  const completedStages = useAidtConfirmedStages(shared.stages, shared.read?.phase === "ready" ? uiLifecycleKey : null);
  function toChat(text: string, closePanel = true): ComposerOfferResult {
    if (!canWrite || !latestCanWrite.current || latestUiScope.current !== uiScope || uiLifecycle.current.generation !== uiGeneration || !identity || !step) return "unavailable";
    const currentThread = new URLSearchParams(window.location.search).get(reportMode ? "summaryThread" : "thread");
    const result = offerComposerDraft({ orgId: identity.currentOrgId, userId: identity.userId, projectId, threadId: currentThread }, text);
    if (result === "accepted" && closePanel && tool !== "chat") setWorkspaceToolsOpen(false);
    return result;
  }
  if (!step) return <div className="min-h-0 flex-1 overflow-y-auto"><AidtDashboard href={(id) => aidtHref(projectId, id)} drafts={currentUi.drafts} completed={completedStages} shared={{ phase: shared.read?.phase ?? (shared.available ? "loading" : "error"), stages: shared.stages, error: shared.read?.error ?? (shared.available ? undefined : "登录后可读取本组已保存成果。"), reload: shared.reload }} /></div>;
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
  const nextStep = AIDT_STEPS.find(({ id }) => id === step.id + 1);
  function pushWorkspaceUrl(target: URL, current: URL, preserveThread = true) {
    if (preserveThread && target.searchParams.get("step") === current.searchParams.get("step") && target.searchParams.get("entity") === current.searchParams.get("entity")) {
      for (const key of ["thread", ...(target.searchParams.has("summary") ? ["summaryThread"] : [])]) {
        const value = current.searchParams.get(key);
        if (value && !target.searchParams.has(key)) target.searchParams.set(key, value);
      }
    }
    setToolsScope(null);
    // Commit same-page navigation before background Chat resolution can update the URL.
    if (target.href !== current.href) window.history.pushState(null, "", target);
  }
  function navigateWorkspace(event: React.MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return;
    const target = new URL(link.href);
    const current = new URL(window.location.href);
    if (target.origin !== current.origin || target.pathname !== current.pathname || target.hash) return;
    event.preventDefault();
    pushWorkspaceUrl(target, current, !link.hasAttribute("data-aidt-reset-thread"));
  }
  function setWorkspaceToolsOpen(open: boolean) {
    const current = new URL(window.location.href);
    const target = new URL(href(open ? reportMode ? "report" : "outcome" : "chat"), current);
    pushWorkspaceUrl(target, current);
  }
  const reportHref = search.get("history") !== "1" ? aidtHref(projectId, 6) + "&summary=1" : canWrite ? aidtReportChatHref(projectId, { stageThread: step.id === 6 ? thread : null, threadId: summaryThread, returnRevision }) : aidtHref(projectId, 6, { tool: "report" });
  const directoryContext = new URLSearchParams();
  for (const key of ["summary", "problemEntity", "problemRevision", "hmwRevision", "ideaRevision", "prototypeEntity", "prototypeRevision"]) {
    const value = search.get(key);
    if (value) directoryContext.set(key, value);
  }
  const directoryUrl = aidtHref(projectId, step.id);
  const directoryHref = directoryContext.size ? directoryUrl + "&" + directoryContext : directoryUrl;
  const entityHref = (id: string) => directoryHref + "&entity=" + encodeURIComponent(id);
  const currentStage = shared.stages[step.id];
  const activeProblem = problemStep && activeEntityId && currentStage
    ? listAidtProblems(currentStage.content.draft).find(item => item.id === activeEntityId && !item.archived) : undefined;
  const entityHeading = activeInterview ? aidtInterviewTitle(activeInterview.code, activeInterview.displayName) : activeProblem?.title ?? projectName;
  const hmwStage = hmwRevision === null || String(latestHmwStage?.revision) === hmwRevision
    ? latestHmwStage : historicalHmw?.scope === hmwScope ? historicalHmw.stage : undefined;
  const selectedHmw = hmwStage && readAidtDefinitionSelection(hmwStage.content.draft.fields);
  const ideaHandoff = {
    hmw: selectedHmw && hmwStage ? { revision: hmwStage.revision, ...selectedHmw } : undefined,
    savedRevision: shared.stages[4]?.revision,
    matchesServer: shared.matchesServer && Boolean(completedStages?.has(4)),
    nextHref: aidtHref(projectId, 5) + (shared.stages[4] ? "&ideaRevision=" + shared.stages[4].revision : ""),
  };
  // Existing first-party report links select the shared report directly, without an entity.
  const legacyReportEntry = step.id === 6 && tool === "report" && search.get("summary") !== "1";
  const stageFinished = Boolean(completedStages?.has(step.id));
  const prototypeHandoff = step.id === 5 && currentStage ? readAidtConfirmedPrototypeHandoff(currentStage.content.draft) : null;
  const nextStageHref = !stageFinished || !currentStage || reportMode ? null
    : step.id === 1
      ? currentStage.content.draft.fields.problemHandoffEntity
        ? aidtHref(projectId, 2) + "&" + new URLSearchParams({ problemEntity: currentStage.content.draft.fields.problemHandoffEntity, problemRevision: String(currentStage.revision) })
        : aidtHref(projectId, 2)
      : step.id === 3 ? aidtHref(projectId, 4) + "&hmwRevision=" + currentStage.revision
      : step.id === 4 ? aidtHref(projectId, 5) + "&ideaRevision=" + currentStage.revision
      : step.id === 5 ? prototypeHandoff ? aidtHref(projectId, 6) + "&" + new URLSearchParams({ prototypeEntity: prototypeHandoff.id, prototypeRevision: String(currentStage.revision) }) : null
      : step.id === 6 ? reportHref : aidtHref(projectId, 3);
  const advance = nextStageHref ? <Button asChild variant="primary"><Link href={nextStageHref} data-testid="aidt-stage-next">{step.id === 6 ? "进入小组报告" : "进入下一步"}</Link></Button> : null;
  const definitionProps = {
    projectId, draft: currentUi.drafts[3]!, update: (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => updateStage(3, mutate),
    readOnly: !canWrite, availableCards: shared.stages[2]?.content.draft.discoveryCards ?? [],
    availableCardsRevision: shared.stages[2]?.revision, discoveryCardFields: shared.stages[2]?.content.draft.fields,
  };
  const prototypeWorkflow = { ideas: shared.stages[4], savedPrototype: shared.stages[5], matchesServer: shared.matchesServer };
  if (!activeEntityId && search.get("history") !== "1" && !legacyReportEntry) {
    const draft = currentUi.drafts[step.id]!;
    const update = (mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) => updateStage(step.id, mutate);
    const hasSummary = step.id === 6 && search.get("summary") === "1";
    const savedDraft = currentStage?.content.draft;
    const save = <AidtSharedStagePanel key={shared.writeKey} stageNumber={step.id} controller={shared} readOnly={!canWrite}
      showSave={step.id !== 1 || (!shared.matchesServer && shared.canSave)} />;
    return <section className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="aidt-step-entity-directory">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href={aidtHref(projectId)} className="inline-flex items-center gap-2 rounded-control px-2 py-1 text-12 text-muted-foreground transition-colors hover:bg-muted"><ArrowLeft aria-hidden className="h-4 w-4" />项目总览</Link>
        <h1 className="text-16 font-semibold">{hasSummary ? "小组报告" : step.title}</h1>
      </header>
      <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
        {shared.read?.phase === "error"
          ? <div role="alert" className="space-y-2"><p>小组产物读取失败。</p><Button variant="outline" onClick={shared.reload}>重试</Button></div>
          : shared.read?.phase !== "ready" && <p role="status">正在读取小组产物…</p>}
        {shared.read?.phase === "ready" && (hasSummary
          ? <AidtReportDirectory stage={shared.stages[6]} href={entityHref} />
          : step.id === 1 ? <><AidtProblemDirectory key={`problems:${shared.writeKey}`} draft={savedDraft ?? emptyAidtUiDrafts()[1]!} href={entityHref} controller={shared} readOnly={!canWrite} />{save}</>
          : step.id === 2 ? <>
              <AidtInterviewWorkspace projectId={projectId} draft={draft} update={update} readOnly={!canWrite} entityId={null}
                problemEntityId={search.get("problemEntity") ?? undefined}
                problemRevision={search.has("problemRevision") ? Number(search.get("problemRevision")) : undefined}
                savedIds={new Set(readAidtInterviews(savedDraft?.fields ?? {}).map(record => record.id))}
                onCreate={() => undefined} onOpen={id => {
                  if (savedDraft && readAidtInterviews(savedDraft.fields).some(record => record.id === id)) router.push(entityHref(id));
                }} />
              {save}

            </>
          : step.id === 3 ? <>
              <AidtDefinitionDirectory projectId={projectId} draft={draft} savedDraft={savedDraft} update={update} readOnly={!canWrite} nativeChat requestSave={requestEntitySave}
                availableCards={shared.stages[2]?.content.draft.discoveryCards ?? []} availableCardsRevision={shared.stages[2]?.revision}
                discoveryCardFields={shared.stages[2]?.content.draft.fields} entityHref={entityHref} />
              {save}

            </>
          : step.id === 4 ? <>
              <AidtIdeaDirectory draft={draft} saved={savedDraft} href={entityHref} update={update} readOnly={!canWrite} saveDraft={shared.saveDraft} />
              {save}
            </>
          : step.id === 5 ? <AidtPrototypeDirectory projectId={projectId} canWrite={canWrite} ideaRevision={ideaRevision} draft={savedDraft ?? draft} saveDraft={shared.saveDraft} mutationBusy={shared.write.phase === "saving" || shared.needsBaseReview} />
          : <><AidtTestGroupDirectory projectId={projectId} draft={draft} savedDraft={savedDraft} update={update} readOnly={!canWrite}
              canSave={shared.canSave} save={shared.saveCurrent} previousPrototype={shared.stages[5]?.content.draft}
              previousPrototypeRevision={shared.stages[5]?.revision} prototypeRevision={search.get("prototypeRevision")}
              prototypeEntity={search.get("prototypeEntity")} readPrototypeEntity={readAidtPrototypeEntityDraft}
              prototypeEntities={listAidtConfirmedPrototypeEntities(currentUi.drafts[5]!)} />
              </>)}
        {!hasSummary && (advance ?? <p role="status" className="text-12 text-muted-foreground">全部当前产物确认后可进入下一步。</p>)}
        <Link className="text-12 text-muted-foreground underline" href={aidtHref(projectId, step.id) + (hasSummary ? "&summary=1" : "") + "&history=1"}>打开早期阶段对话</Link>
      </div>
    </section>;
  }
  const sharedProblem = shared.available && (shared.read?.phase === "error" || shared.write.phase === "error" || shared.write.phase === "conflict");

  const interviewScope = JSON.stringify([uiLifecycleKey, activeInterview?.id]);
  const updateInterview = (mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) => {
    if (!activeInterview || !canWrite || shared.read?.phase !== "ready") return;
    setInterviewEditScope(interviewScope);
    updateStage(2, old => isAidtInterviewArchived(old.fields, activeInterview.id) ? old : mutate(old));
  };
  const toolContent = <div className="space-y-4 p-4" data-testid="aidt-tool-panel">
    {tool === "outcome" && !problemStep && !activeEntityId && <AidtSharedStagePanel key={shared.writeKey} stageNumber={step.id} controller={shared} readOnly={!canWrite} />}
        {(tool === "sources" || tool === "transcript" || tool === "record") && <AidtEvidenceGuide />}
        {tool === "outcome" && step.id === 6 && activeEntityId ? <AidtTestGroupOutput projectId={projectId} draft={currentUi.drafts[6]!} savedDraft={shared.stages[6]?.content.draft} activeEntityId={activeEntityId} readPrototypeEntity={readAidtPrototypeEntityDraft} proposal={testProposal?.scope === threadResolutionScope ? testProposal.proposal : null} /> : tool === "outcome" && step.id === 3 && activeEntityId ? <AidtDefinitionOutput {...definitionProps} entityId={activeEntityId} /> : tool === "outcome" && step.id === 4 && activeEntityId ? <AidtIdeaOutput projectId={projectId} entityId={activeEntityId} draft={currentUi.drafts[4]!} savedDraft={shared.stages[4]?.content.draft} savedRevision={shared.stages[4]?.revision} /> : tool === "outcome" ? <>
          {prototypeEntityId ? <AidtPrototypeEntityOutput key={prototypeEntityId} projectId={projectId} designId={prototypeEntityId} ideaRevision={ideaRevision} stageDraft={prototypeDraft} update={mutate => updateStage(5, mutate)} workflow={prototypeWorkflow} presentationOnly={Boolean(activeEntityId)} readOnly={!canWrite} /> : <>
          {problemStep ? <AidtProblemWorkspace draft={problemDraft} revision={savedProblemStage?.revision} confirmed={Boolean(problemDraft.fields.roundCompletion && problemDraft.fields.problemReflectionConfirmed === "true")} /> : <AidtStageOutput key={`${uiScope}:${step.id}:${activeEntityId ?? ""}`} entityId={step.id === 2 ? activeEntityId : undefined} ideaEntityId={step.id === 4 ? activeEntityId : undefined} ideaHandoff={step.id === 4 ? ideaHandoff : undefined} activeTestEntityId={step.id === 6 ? activeEntityId : undefined} readTestPrototypeEntity={readAidtPrototypeEntityDraft} projectId={projectId} thread={checkpointThread} step={step} draft={currentUi.drafts[step.id]!} availableCards={shared.stages[2]?.content.draft.discoveryCards ?? []} availableCardsRevision={shared.stages[2]?.revision} discoveryCardFields={shared.stages[2]?.content.draft.fields} activeDefinitionEntityId={step.id === 3 ? activeEntityId : null} previousPrototype={shared.stages[5]?.content.draft} previousPrototypeRevision={shared.stages[5]?.revision} update={(mutate) => updateStage(step.id, mutate)} readOnly={!canWrite} toolHref={(key) => href(key as Tool)} toChat={toChat} />}
          {(!activeEntityId && !problemStep) && <AidtRoundCompletion key={shared.writeKey} projectId={projectId} step={step} draft={currentUi.drafts[step.id]!} controller={shared} readOnly={!canWrite} onConfirm={record => updateStage(step.id, old => ({ ...old, fields: { ...old.fields, roundCompletion: record } }))} nextHref={activeEntityId ? nextStageHref : nextStep ? aidtHref(projectId, nextStep.id) : reportHref} />}
          </>}
          {!activeEntityId && <AidtRoundNavigation projectId={projectId} stageNumber={step.id} draft={currentUi.drafts[step.id]!} savedRound={shared.stages[6]} matchesServer={shared.matchesServer} returnRevision={search.get("returnRevision")} sessionToken={checkpointScope?.sessionToken ?? null} />}
          {!activeEntityId && step.id === 6 && <AidtNextRound draft={currentUi.drafts[6]!} savedRevision={shared.stages[6]?.revision} matchesServer={shared.matchesServer} readOnly={!canWrite} onStart={() => updateStage(6, resetAidtTestRound)} />}
          {!activeEntityId && <details className="mt-4 border-t border-border pt-3 text-12" onToggle={event => setHistoryScope(event.currentTarget.open ? `${uiLifecycleKey}:${step.id}` : null)} data-testid="aidt-history-disclosure"><summary className="cursor-pointer font-medium">查看本步历史版本</summary>{historyScope === `${uiLifecycleKey}:${step.id}` && <AidtStageHistory projectId={projectId} stageId={step.id} sessionToken={checkpointScope?.sessionToken ?? null} currentRevision={shared.stages[step.id]?.revision} />}</details>}
          {!problemStep && !activeEntityId && <AidtStageJourney key={`journey:${uiScope}:${step.id}`} stageNumber={step.id}
          inputText={step.id > 1 ? `前序当前草稿（供参考，未自动继承或验证）：\n${aidtUiStageSummary(step.id - 1, currentUi.drafts[step.id - 1]!) || "尚缺前序填写"}` : "先记录本组自己的观察、问题、人群与场景。聊天内容由学生主动整理进成果。"}
          currentOutput={aidtUiStageSummary(step.id, currentUi.drafts[step.id]!)} checkpoints={currentUi.checkpoints[step.id] ?? []}
          onKeepCheckpoint={() => keepCheckpoint(step.id)} readOnly={!canWrite}
          reportNote="原生报告当前整理本页最新草稿；这里的对照记录未自动写入共享报告。" />}
</>
        : tool === "context" ? <><AidtStageBridge key={`${uiScope}:${step.id}`} projectId={projectId} stageNumber={step.id} drafts={currentUi.drafts} discoveryCardsRevision={shared.stages[2] && aidtSharedDraftSignature(currentUi.drafts[2]!) === aidtSharedDraftSignature(shared.stages[2].content.draft) ? shared.stages[2].revision : undefined} toChat={toChat} readOnly={!canWrite} /><AidtMaterials key={uiScope} projectId={projectId} stageNumber={step.id} thread={thread} returnRevision={returnRevision} /></>
        : tool === "report" && isEntityReport ? <AidtReportOutput text={reportText} proposalText={reportProposal?.scope === threadResolutionScope ? reportProposal.markdown : undefined} shared={shared.report} historyScope={reportHistoryScope} reportEntityId={reportEntityId} />
        : tool === "report" ? <AidtReportPreview reviewView={reportReview} initialPreview={reportMode} key={reportDraftKey + uiScope} reportEntityId={reportEntityId} drafts={currentUi.drafts} discoveryCardsRevision={shared.stages[2] && aidtSharedDraftSignature(currentUi.drafts[2]!) === aidtSharedDraftSignature(shared.stages[2].content.draft) ? shared.stages[2].revision : undefined} text={currentUi.reports[reportDraftKey]?.text ?? null} sourceRevision={currentUi.reports[reportDraftKey]?.sourceRevision ?? currentUi.revision} revision={currentUi.revision} onChange={(text) => changeReport(text)} regenerate={() => changeReport()} readOnly={!canWrite} toChat={toChat} shared={shared.report} onOpenSummary={() => router.push(aidtReportChatHref(projectId, { threadId: summaryThread, stageThread: thread, entityId: reportEntityId, returnRevision }))} summaryThread={reportMode ? summaryThread : null} historyScope={checkpointScope ? { ...checkpointScope, lifecycleKey: uiLifecycleKey } : undefined} />
        : tool === "sources" ? <ProjectEvidenceSection key={uiScope} projectId={projectId} />
        : tool === "record" ? canWrite ? <div data-testid="aidt-native-recording"><p className="px-4 text-12 text-muted-foreground">个人录音笔记只用于自己的思考。不得借此绕过项目访谈的参与者同意校验；项目访谈同意采集入口尚未集成。</p><Transcription key={uiScope} uiState="default" projectId={projectId} /></div> : null
        : selected ? !authenticated ? <p role="status" className="p-4 text-12 text-muted-foreground">登录后可查看关联资源。</p> : access?.key !== accessKey ? loading() : access.error ? <div role="alert" data-testid="aidt-resource-error" className="p-4"><p>{access.error}</p><Button variant="outline" onClick={() => setRetry((n) => n + 1)}>重试</Button></div>
          : access.allowed && canWrite ? tool === "design" ? !designAllowed ? <div className="space-y-3 p-4 text-13" data-testid="aidt-design-question-required"><p>{prototypeGate.reason}</p><Button asChild variant="outline"><Link href={href("outcome")}>回到验证问题卡</Link></Button><p className="text-12 text-muted-foreground">原有设计资料仍保留，可在项目资料中查看。本教学入口在学生确认问题后继续原型制作。</p></div> : <Design key={`${uiLifecycleKey}:${step.id}:${selected}`} projectId={selected} teachingProjectId={projectId} stageId={step.id} lifecycleKey={uiLifecycleKey} sessionToken={checkpointScope?.sessionToken ?? null} returnRevision={returnRevision} prototypeEntityId={prototypeEntityId} onBack={() => router.push(href(prototypeEntityId ? "outcome" : "design"))} onNextDesign={() => router.push(href("design"))} /> : <Transcription key={selected} uiState="default" projectId={projectId} initialSessionId={selected} />
          : <p className="p-4 text-12 text-muted-foreground">项目只读，请返回资料列表查看资源摘要。</p>
        : tool === "design" && !designAllowed ? <div className="space-y-3 p-4 text-13" data-testid="aidt-design-question-required"><p>{prototypeGate.reason}</p><Button asChild variant="outline"><Link href={href("outcome")}>回到验证问题卡</Link></Button><p className="text-12 text-muted-foreground">原有设计资料仍保留，可在项目资料中查看。本教学入口在学生确认问题后继续原型制作。</p></div>
        : <ProjectResourceSection contained key={`${uiScope}:${tool}`} projectId={projectId} kind={tool as ProjectResearchSub} canWrite={canWrite} resourceHref={resourceHref} transformCreateHref={createdHref} />}
  </div>;
  const workspaceTools = <>
    {!activeEntityId && <nav className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-subtle p-3" aria-label="学习工具">
      <Button asChild size="sm" variant={tool === "outcome" ? "secondary" : "ghost"}><Link href={href(isEntityReport ? "report" : "outcome")} data-testid="aidt-open-output">{problemStep ? "问题与依据" : "成果"}</Link></Button>
      {!activeEntityId && <Button asChild size="sm" variant={tool === "context" ? "secondary" : "ghost"}><Link href={href("context")}>资料</Link></Button>}
      {!activeEntityId && <DropdownMenu open={toolsScope === `${uiLifecycleKey}:${step.id}`} onOpenChange={open => setToolsScope(open ? `${uiLifecycleKey}:${step.id}` : null)}><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" data-testid="aidt-tools">更多工具</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{allowed.filter(key => !["chat", "outcome", "context"].includes(key) && (canWrite || key !== "record")).map(key => <DropdownMenuItem asChild key={key}><Link href={key === "report" ? aidtReportChatHref(projectId, {tool:"report",stageThread:thread,threadId:summaryThread,entityId:reportEntityId,returnRevision}) : href(key)}>{TOOLS[key]}</Link></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
    </nav>}
    {tool !== "chat" && toolContent}
    {tool === "context" && <div className="space-y-4 border-t border-border-subtle p-4">
      <details className="text-12"><summary className="cursor-pointer text-muted-foreground">已保存成果与引用</summary><div ref={setReferencePanel} className="empty:hidden" /><AidtArtifactShelf key={uiLifecycleKey} stages={shared.stages} stageId={step.id} projectId={projectId} sessionToken={checkpointScope?.sessionToken ?? null} phase={shared.read?.phase ?? (shared.available ? "loading" : "error")} retry={shared.available ? shared.reload : undefined} onReference={canWrite && !reportMode ? version => toChat(`我想参考第 ${version.stageId} 步已保存成果 V${version.revision}。以下是小组记录，请协助核对：\n${aidtUiStageSummary(version.stageId, version.content.draft)}`) : undefined} /></details>
      <details className="text-12"><summary className="cursor-pointer text-muted-foreground">个人保存记录</summary><AidtPersonalCheckpointPanel key={personal.key} stageNumber={step.id} controller={personal} readOnly={!canWrite} onShare={sharePersonalCheckpoint} sharedCheckpointKey={savedContextRefs[0] ? JSON.stringify([savedContextRefs[0].artifactId, savedContextRefs[0].expectedImmutableRevision]) : undefined} /></details>
    </div>}
  </>;
  return <section className="flex min-h-0 flex-1 flex-col" data-testid="aidt-workspace" onClickCapture={navigateWorkspace}>
    <div className={problemStep || activeEntityId ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-col xl:flex-row xl:gap-3 xl:p-3"}>
      <div className={problemStep || activeEntityId ? "flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-2 lg:px-6" : "shrink-0 px-3 xl:w-44 xl:px-0"}>
        <Link href={activeEntityId ? directoryHref : aidtHref(projectId)} className="inline-flex shrink-0 items-center gap-2 rounded-control px-2 py-1 text-12 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft aria-hidden className="h-3.5 w-3.5" />{activeInterview ? "返回访谈列表" : activeEntityId ? problemStep ? "返回问题列表" : "返回产物列表" : "项目总览"}</Link>
        {problemStep || activeEntityId ? entityHeading && <span className="truncate border-l border-border-subtle pl-3 text-13 font-medium">{entityHeading}</span>
          : <AidtStageNavigation stageNumber={step.id} href={id => aidtHref(projectId, id) + (search.get("history") === "1" ? "&history=1" : "")} reportHref={reportHref} reportActive={tool === "report" || reportMode} completed={completedStages} />}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className={canWrite ? "sr-only" : "flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2"} data-testid="aidt-workspace-toolbar"><h1 className="text-16 font-semibold">{reportMode || tool === "report" ? "小组报告" : activeProblem?.title ?? step.title}</h1>{!canWrite && <><Button asChild size="sm" variant="ghost"><Link href={href("outcome")}>查看成果</Link></Button><p role="status" className="w-full text-12 text-muted-foreground" data-testid="aidt-readonly">当前项目只读，可查看已关联资料。</p></>}</header>
        {tool !== "outcome" && tool !== "report" && sharedProblem && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-12" data-testid="aidt-shared-chat-alert"><span>{shared.read?.phase === "error" ? "本步成果读取失败。" : shared.write.phase === "conflict" ? "本步成果有版本冲突，本页修改仍保留。" : "本步成果保存尚未确认，本页修改仍保留。"}</span><Link className="text-primary underline" href={href("outcome")}>进入成果核对</Link>{shared.read?.phase === "error" && <Button size="sm" variant="outline" onClick={shared.reload}>重试读取</Button>}</div>}
        {activeInterview && interviewReadback.failed && <p role="alert" className="px-4 text-12">访谈产物暂未同步。<Button size="xs" variant="ghost" onClick={interviewReadback.retry}>重试同步</Button></p>}
        {activeInterview && canWrite && <AidtInterviewSaveState key={interviewScope} controller={shared} editPending={interviewEditScope === interviewScope} signature={aidtSharedDraftSignature(currentUi.drafts[2]!)} />}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AidtAssistantPanel open fullPage onClose={() => undefined}>
            {canWrite ? <div className="min-h-0 flex-1" data-testid="aidt-native-chat">
              <ChatHostConversationContext.Provider value={isEntityReport && activeEntityId ? {
                render: (messages, loading, running) => <>
                  <AidtOpenOnNewTurn key={threadResolutionScope} messages={messages} loading={loading} open={() => setWorkspaceToolsOpen(true)} />
                  <AidtReportConversation key={activeEntityId} messages={messages} loading={loading} running={running}
                    projectId={projectId} entityId={activeEntityId} threadId={checkpointThread} text={reportText} onChange={changeReport}
                    shared={shared.report} historyScope={reportHistoryScope} readOnly={!canWrite} onDraftReady={markdown => {
                      setReportProposal({ scope: threadResolutionScope, markdown });
                      setWorkspaceToolsOpen(true);
                    }} />
                </>,
              } : step.id === 3 && activeEntityId ? {
                render: (messages, loading, running) => <>
                  <AidtOpenOnNewTurn key={threadResolutionScope} messages={messages} loading={loading} open={() => setWorkspaceToolsOpen(true)} />
                  <AidtDefinitionChatArtifact key={activeEntityId} {...definitionProps} entityId={activeEntityId} messages={messages} loading={loading} running={running}
                    savedDraft={shared.stages[3]?.content.draft} requestSave={requestEntitySave} />
                  {advance}
                </>,
              } : step.id === 5 && prototypeEntityId && activeEntityId ? {
                render: (messages, loading, running) => <>
                  <AidtOpenOnNewTurn key={threadResolutionScope} messages={messages} loading={loading} open={() => setWorkspaceToolsOpen(true)} />
                  <AidtPrototypeConversation key={prototypeEntityId} projectId={projectId} designId={prototypeEntityId} ideaRevision={ideaRevision}
                    stageDraft={prototypeDraft} update={mutate => updateStage(5, mutate)} workflow={prototypeWorkflow}
                    messages={messages} loading={loading} running={running} readOnly={!canWrite} requestSave={requestEntitySave} />
                  {advance}
                </>,
              } : step.id === 6 && activeEntityId ? {
                render: (messages, loading, running) => <>
                  <AidtOpenOnNewTurn key={threadResolutionScope} messages={messages} loading={loading} open={() => setWorkspaceToolsOpen(true)} />
                  <AidtTestConversation key={activeEntityId} projectId={projectId} entityId={activeEntityId}
                    draft={currentUi.drafts[6]!} savedDraft={shared.stages[6]?.content.draft} messages={messages}
                    loading={loading} running={running} update={mutate => updateStage(6, mutate)} readOnly={!canWrite}
                    canSave={shared.read?.phase === 'ready' && shared.write.phase !== 'saving' && !shared.needsBaseReview}
                    requestSave={requestEntitySave} onProposal={proposal => setTestProposal(previous =>
                      previous?.scope === threadResolutionScope && previous.proposal?.messageId === proposal?.messageId
                        ? previous : { scope: threadResolutionScope, proposal })} />
                  {advance}
                </>,
              } : step.id === 4 && activeEntityId ? {
                render: (messages, loading, running) => <>
                  <AidtOpenOnNewTurn key={threadResolutionScope} messages={messages} loading={loading} open={() => setWorkspaceToolsOpen(true)} />
                  <AidtIdeaConversation key={activeEntityId} projectId={projectId} entityId={activeEntityId}
                    draft={currentUi.drafts[4]!} savedDraft={shared.stages[4]?.content.draft} readOnly={!canWrite}
                    messages={messages} loading={loading} running={running} update={mutate => updateStage(4, mutate)}
                    requestSave={requestEntitySave} handoff={ideaHandoff} onProposalReady={() => setWorkspaceToolsOpen(true)} />
                </>,
              } : problemStep && canWrite && checkpointScope ? { target: null, render: (messages, loading, running) => <AidtProblemChatReview key={threadResolutionScope} projectId={projectId} entityId={activeEntityId} stage={savedProblemStage} sessionToken={checkpointScope.sessionToken} threadId={checkpointThread} messages={messages} loading={loading} running={running} onRefresh={shared.refreshCurrentStage} /> } : activeInterview && shared.read?.phase === "ready" && !isAidtInterviewArchived(currentUi.drafts[2]!.fields, activeInterview.id) ? {
                target: null, render: (messages, loading, running) => <>
                  <AidtOpenOnNewTurn key={threadResolutionScope} messages={messages} loading={loading} open={() => setWorkspaceToolsOpen(true)} />
                  <AidtInterviewConversation key={activeInterview.id} interview={activeInterview} projectId={projectId} draft={currentUi.drafts[2]!} messages={messages} loading={loading} running={running} update={updateInterview} onSettled={interviewReadback.onSettled} />
                  {advance}
                </>
              } : null}>
              <Chat interviewPhase={activeInterview ? activeInterview.guideConfirmed || activeInterview.consent ? "fieldwork" : activeInterview.original ? "revision" : "initial" : undefined} offerInitial={problemStep ? text => toChat(text, false) : undefined} key={`${uiScope}:${step.id}:${reportMode ? "report" : "stage"}:${activeEntityId ?? ""}`} entityId={activeEntityId} entityRevision={activeEntityId ? shared.stages[step.id]?.revision : undefined} sourceEntityId={sourceProblem?.id} sourceRevision={sourceProblem?.revision} projectId={projectId} step={step} thread={reportMode ? summaryThread : thread} purpose={reportMode ? "report" : undefined} returnRevision={returnRevision} taskHref={href(reportMode ? "report" : "outcome")} onResolvedThread={onResolvedThread} savedContextRefs={activeEntityId ? [] : savedContextRefs} sharedContextRefs={sharedContextRefs} sharedContextReady={shared.read?.phase === "ready"} referencePanel={referencePanel} hostPanel={{ scope: `${uiLifecycleKey}:${step.id}:${activeEntityId ?? ""}`, title: problemStep ? "工作坊问题" : "成果", placement: problemStep || activeEntityId ? "artifacts" : undefined, open: tool !== "chat", content: workspaceTools, savedArtifactTitle: activeInterview && shared.read?.phase === "ready" ? savedAidtInterviewArtifactTitle(shared.stages[2]?.content.draft, activeInterview.id) : undefined, materialsContent: activeInterview ? <div className="p-4"><AidtInterviewWorkspace projectId={projectId} draft={currentUi.drafts[2]!} entityId={activeInterview.id} readOnly={!canWrite} surface="materials" update={updateInterview} /></div> : undefined, onOpenChange: setWorkspaceToolsOpen }} />
              </ChatHostConversationContext.Provider>
            </div> : <ProjectConversations key={uiScope} projectId={projectId} canWrite={false} />}
          </AidtAssistantPanel>
          {!canWrite && tool !== "chat" && <aside className="w-full max-w-lg shrink-0 overflow-y-auto border-l border-border bg-card" aria-label={TOOLS[tool]}><Link href={href("chat")} className="block border-b border-border-subtle px-4 py-3 text-12 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">返回对话</Link>{workspaceTools}</aside>}
        </div>
      </div>
    </div>
  </section>;
}
