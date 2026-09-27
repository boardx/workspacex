"use client";
import { GuidedResearchReportTimeline } from "./guided-research-report-timeline";
import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { research as C } from "@repo/contracts";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GuidedResearchConversation } from "./guided-research-conversation";
import { ResearchLoading, researchSteps as steps, researchStepLabels as labels } from "./guided-research-presentation";
import { researchReportDocument } from "@/lib/research-report-document";
import { ResearchPrototypeReport } from "./research-prototype-report";
import { GuidedResearchReportHistory, GuidedResearchEvidenceWarning } from "./guided-research-report-history";
import { GuidedResearchQualityDraft } from "./guided-research-quality-draft";
import { GuidedResearchReportPreview } from "./guided-research-report-preview";
import { researchReportPreview } from "@/lib/research-report-preview";
import { ResearchDirectionsEditor, ResearchOutlineEditor, ResearchDesignPreview } from "./guided-research-design-editor";
import { GuidedResearchRuntimeProgress, GuidedResearchPlanDetails, ResearchChapterTasks } from "./guided-research-runtime-progress";
import { GuidedResearchSources } from "./guided-research-sources";
import { GuidedResearchIntentPlan } from "./guided-research-intent-plan";
import { GuidedResearchTrustConsole } from "./guided-research-trust-console";
import { GuidedResearchReadiness, researchCompletionLabel, researchLimitations } from "./guided-research-readiness";
import { GuidedResearchStepLayout } from "./guided-research-step-layout";
import { GuidedResearchMarkdownWorkspace } from "./guided-research-markdown-workspace";
import { GuidedResearchSixStepShell } from "./guided-research-six-step-shell";
import { guidedResearchRoute, RESEARCH_STAGE_NODES } from "@/lib/guided-research-routes";
import { GuidedResearchEntryPanel } from "./guided-research-entry-panel";
import { GuidedResearchTopicPanel } from "./guided-research-topic-panel";
import { ResearchTopicInformation } from "./research-topic-information";
import { ResearchChaptersWorkspace } from "./research-chapters-workspace";
import { GuidedResearchPlanPanel } from "./guided-research-plan-panel";
import { GuidedResearchSourceWorkspace } from "./guided-research-source-workspace";
import { GuidedResearchReportWorkspace } from "./guided-research-report-workspace";
import { parseGuidedResearchMarkdown, serializeGuidedResearchMarkdown } from "@/lib/guided-research-markdown";
import { toGuidedResearchVisualStage, type GuidedResearchVisualStage } from "@/lib/guided-research-six-step";
import { getResearchRuntime, getResearchRuntimeProgress, mergeResearchProgress, executeResearchRuntime, type GuidedResearchRuntime as Runtime, type GuidedResearchRuntimeCommand as Command, type GuidedResearchRuntimeDraft as Draft } from "@/lib/guided-research-api";
function trustCommandId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
function newestSnapshot(incoming: Runtime, current: Runtime | null): Runtime {
  if (current?.sessionId === incoming.sessionId && current.version === incoming.version && current.reportStream && incoming.busy && (!incoming.reportStream || (current.reportStream.requestId === incoming.reportStream.requestId && current.reportStream.sequence > incoming.reportStream.sequence))) return current;
  return current && current.sessionId === incoming.sessionId && (current.version > incoming.version || (current.version === incoming.version && !current.busy && incoming.busy)) ? current : incoming;
}
function draftOf(state: Runtime, node: Command["node"]): Draft | null {
  if (!state.busy && !state.errorCode && state.proposal?.version === state.version && state.proposal.draft.node === node) return state.proposal.draft;
  if (node === "brief") return { node, value: state.brief };
  if (node === "directions") return state.directions.length ? { node, value: state.directions } : null;
  if (node === "outline") return state.outline.length ? { node, value: state.outline } : null;
  if (node === "research") return { node, value: state.sources.map(({ id, decision }) => ({ id, decision: decision === "pending" ? "accepted" : decision })) };
  return state.report ? { node, value: state.report } : null;
}
function ProposalPreview({ draft }: { draft: Draft }) {
  if (draft.node === "brief") return <div className="space-y-2"><p>{draft.value.topic}</p><p>{draft.value.goal}</p><p>{[draft.value.timeRange, draft.value.region, draft.value.focus].filter(Boolean).join(" · ")}</p></div>;
  if (draft.node === "directions" || draft.node === "outline") return <ResearchDesignPreview draft={draft} />;
  if (draft.node === "report") return <p className="whitespace-pre-wrap">{draft.value.summary}</p>;
  return <p>建议保留 {draft.value.filter((item) => item.decision === "accepted").length} 个来源、排除 {draft.value.filter((item) => item.decision === "excluded").length} 个来源。</p>;
}
const errors: Record<string, string> = {
  RESEARCH_EVIDENCE_BUDGET_EXCEEDED: "大纲问题或来源内容超出本次分析容量，请精简后重试。",
  RESEARCH_REPORT_QUALITY_INSUFFICIENT: "报告修订后仍未通过证据与分析质量检查，请完善大纲或补充来源后重试。",
  RESEARCH_GRAPH_VERSION_CONFLICT: "研究内容已更新，本次操作未提交。请核对最新进度后继续。",
  RESEARCH_REVISION_CONFLICT: "研究边界已在其他页面更新，请核对最新版本后重试。",
  RESEARCH_SOURCE_ACCESS_DENIED: "所选内部资料不在当前授权范围内。",
  RESEARCH_WORKFLOW_PAUSED: "研究已暂停，请继续后再执行检索。",
  RESEARCH_WORKFLOW_UNAVAILABLE: "模型服务暂时不可用，请稍后重试；持续失败请联系管理员检查模型配置。",
  RESEARCH_NODE_MISMATCH: "研究步骤已变化，请查看最新进度后继续。",
  RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH: "请求状态发生冲突，请核对最新进度后重新操作。",
  RESEARCH_WORKFLOW_BUSY: "研究正在处理中，请稍候。",
  RESEARCH_SEARCH_NOT_CONFIGURED: "检索服务尚未配置，请联系管理员。",
  RESEARCH_SEARCH_NO_RELEVANT_SOURCES: "未找到能支持当前主题和研究问题的资料，请调整研究计划后重试。",
  RESEARCH_SOURCE_RELEVANCE_INVALID: "资料相关性评估未通过校验，尚未纳入新的资料，请重试。",
  RESEARCH_SEARCH_EMPTY: "检索服务未返回来源，请调整研究计划后重试。",
  RESEARCH_SEARCH_UNAVAILABLE: "检索服务暂时不可用，请重试。",
  RESEARCH_SEARCH_CONTENT_EMPTY: "检索结果缺少可用正文，请重试。",
  RESEARCH_EXECUTION_INTERRUPTED: "上次检索已中断，请重试。",
  RESEARCH_SEARCH_PARTIAL_FAILURE: "部分检索失败，已保存成功结果。请重试失败任务。",
  RESEARCH_SOURCES_REQUIRED: "请先添加至少一个真实来源。",
  RESEARCH_SOURCE_URL_INVALID: "请输入有效的公开网页链接。",
  RESEARCH_SOURCE_NOT_FOUND: "未找到该链接的可用描述，请检查链接或稍后重试。",
  RESEARCH_TASKS_INCOMPLETE: "请先完成检索任务，失败任务可重试。",
  RESEARCH_CONTENT_REFERENCE_INVALID: "生成内容引用了不可用的来源，已拒绝应用。请重新生成。",
  RESEARCH_NODE_STATE_INVALID: "模型返回的内容不符合本步骤要求，请重试。",
  RESEARCH_MODEL_GENERATION_REQUIRED: "本步骤尚未完成模型处理，请重试。",
};
function requestError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已过期，请重新登录后继续。";
    if (error.status === 403) return "你暂时没有访问此研究的权限，请联系研究负责人。";
    if (error.status === 404) return "研究会话不存在或已不可访问，请返回研究首页。";
    if (error.reasonCode && errors[error.reasonCode]) return errors[error.reasonCode]!;
    if (error.status === 409) return "研究状态发生冲突，请核对最新进度后继续。";
  }
  return "暂时无法连接研究服务，请检查网络后重试。";
}
type Recovery = { draft: Draft | null; node: Command["node"]; synchronized: boolean };
export function GuidedResearchLive({ sessionId, onBack, initialNode, visualStage: routeStage }: { sessionId: string; onBack: () => void; initialNode?: Command["node"]; visualStage?: GuidedResearchVisualStage }) {
  const [chaptersOpen, setChaptersOpen] = React.useState(routeStage === "chapters");
  const [state, setState] = React.useState<Runtime | null>(null);
  const [node, setNode] = React.useState<Command["node"]>("brief");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [message, setMessage] = React.useState("");
  const [reportAssistantOpen, setReportAssistantOpen] = React.useState(false);
  const [reportMarkdownOpen, setReportMarkdownOpen] = React.useState(false);
  const [topicInformationDirty, setTopicInformationDirty] = React.useState(false);
  const [chaptersDirty, setChaptersDirty] = React.useState(false);
  const [markdownDirty, setMarkdownDirty] = React.useState(false);
  const [scopeEditorOpen, setScopeEditorOpen] = React.useState(false);
  const planEditor = React.useRef<HTMLDetailsElement>(null);
  const [loadingNode, setLoadingNode] = React.useState<Command["node"] | null>(null);
  const [pending, setPending] = React.useState(false);
  const [steeringPending, setSteeringPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const [recovery, setRecovery] = React.useState<Recovery | null>(null);
  const recoveryRef = React.useRef<Recovery | null>(null);
  function updateRecovery(value: Recovery | null) { recoveryRef.current = value; setRecovery(value); }
  const snapshotRef = React.useRef<Runtime | null>(null);
  const responseEpoch = React.useRef(0);
  const commandVersion = React.useRef(0);
  const messageDraft = React.useRef<{ draft: Draft; node: Command["node"] } | null>(null);
  const pollIssued = React.useRef(0);
  const pollAccepted = React.useRef(0);
  const sessionGeneration = React.useRef(0);
  const streamController = React.useRef<AbortController | null>(null);
  const sessionRef = React.useRef(sessionId);
  sessionRef.current = sessionId;
  const nodeRef = React.useRef(node);
  nodeRef.current = node;
  React.useEffect(() => {
    if (!state) return;
    const stage = node === "report" && chaptersOpen ? "chapters" : toGuidedResearchVisualStage({ currentNode: node, availableNodes: state.availableNodes }).current;
    const path = guidedResearchRoute(sessionId, stage);
    if (window.location.pathname !== path) window.history.replaceState({}, "", path);
  }, [node, chaptersOpen, sessionId, state]);
  React.useEffect(() => {
    const restoreRoute = () => {
      const stage = window.location.pathname.split("/").at(-1) as GuidedResearchVisualStage;
      const target = RESEARCH_STAGE_NODES[stage];
      const snapshot = snapshotRef.current;
      if (snapshot && target && snapshot.availableNodes.includes(target)) {
        setChaptersOpen(stage === "chapters");
        setNode(target); setDraft(draftOf(snapshot, target)); setError(null);
      }
    };
    window.addEventListener("popstate", restoreRoute);
    return () => window.removeEventListener("popstate", restoreRoute);
  }, []);
  React.useEffect(() => {
    let active = true;
    sessionGeneration.current += 1;
    responseEpoch.current += 1; snapshotRef.current = null; messageDraft.current = null;
    setState(null); setDraft(null); setMessage(""); setError(null); setPending(false); setLoadingNode(null); setReportMarkdownOpen(false); updateRecovery(null);
    getResearchRuntime(sessionId).then((next) => {
      if (!active) return;
      const target = initialNode && next.availableNodes.includes(initialNode) ? initialNode : next.currentNode;
      snapshotRef.current = next; setState(next); setNode(target); setDraft(draftOf(next, target));
    }).catch((cause: unknown) => { if (active) setError(requestError(cause)); });
    return () => { active = false; sessionGeneration.current += 1; streamController.current?.abort(); };
  }, [sessionId, initialNode, loadAttempt]);
  const expired = Boolean(state?.leaseUntil && Date.parse(state.leaseUntil) <= Date.now());
  React.useEffect(() => {
    if ((!pending && (!state?.busy || expired)) || (!state?.busy && (state?.version ?? -1) >= commandVersion.current && pending)) return;
    let active = true;
    const minimumVersion = pending ? commandVersion.current : 0;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      const epoch = responseEpoch.current; const ticket = ++pollIssued.current;
      const baseline = snapshotRef.current;
      const read = baseline?.currentNode === "report"
        ? getResearchRuntimeProgress(sessionId, baseline.reportStream).then(async (update) => {
          if (!update.busy) return getResearchRuntime(sessionId);
          return mergeResearchProgress(snapshotRef.current ?? baseline, update);
        }) : getResearchRuntime(sessionId);
      read.then((next) => {
        const current = snapshotRef.current;
        if (!active || epoch !== responseEpoch.current || ticket < pollAccepted.current || next.version < minimumVersion || (current && (next.version < current.version || (next.version === current.version && !current.busy && next.busy)))) return;
        if (newestSnapshot(next, current) !== next) return;
        pollAccepted.current = ticket; snapshotRef.current = next;
        setState(next);
        if (!next.busy && pending) {
          // Durable terminal state wins even when the POST connection never closes.
          sessionGeneration.current += 1;
          streamController.current?.abort(); streamController.current = null;
          setPending(false); setLoadingNode(null);
          if (next.errorCode) {
            setError(errors[next.errorCode] ?? "处理失败，已保存当前进度，请重试。");
            if (messageDraft.current) {
              const saved = messageDraft.current;
              updateRecovery({ ...saved, synchronized: true });
              setNode(saved.node); setDraft(saved.draft);
            }
          }
          messageDraft.current = null;
        }
        if (!recoveryRef.current) {
          // A restored server-owned command can advance after this page mounts.
          // Follow that operation, while leaving idle historical browsing alone.
          const target = current?.busy && (!pending || !next.busy) ? next.currentNode : nodeRef.current;
          if (target !== nodeRef.current) setNode(target);
          setDraft(draftOf(next, target));
        }
      }).catch(() => { /* Retry this read without replaying the command. */ }).finally(() => { inFlight = false; });
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pending, state?.busy, state?.version, expired, sessionId]);
  const processing = pending || Boolean(state?.busy && !expired);
  const busy = processing || Boolean(recovery);
  async function steer(action: "pause" | "resume") {
    if (!state || steeringPending) return;
    setSteeringPending(true); setError(null);
    try {
      const next = await executeResearchRuntime({
        sessionId, node: state.currentNode, action, requestId: crypto.randomUUID(), expectedVersion: state.version,
        expectedRevision: state.planRevision ?? 0, idempotencyKey: trustCommandId(action),
      });
      snapshotRef.current = next; setState(next);
    } catch (cause) {
      setError(requestError(cause));
    } finally {
      setSteeringPending(false);
    }
  }
  async function resolveConflict(decision: { conflictId: string; action: "retain_uncertainty" | "prefer_source"; sourceId?: string; rationale: string }) {
    if (!state || steeringPending) return;
    setSteeringPending(true); setError(null);
    try {
      const next = await executeResearchRuntime({
        sessionId, node: "research", action: "resolve_conflict", requestId: crypto.randomUUID(), expectedVersion: state.version,
        expectedRevision: state.planRevision ?? 0, idempotencyKey: trustCommandId("resolve-conflict"), conflictId: decision.conflictId,
        conflictResolutionAction: decision.action, sourceId: decision.sourceId,
        conflictResolution: decision.rationale,
      });
      snapshotRef.current = next; setState(next);
    } catch (cause) { setError(requestError(cause)); }
    finally { setSteeringPending(false); }
  }
  async function run(action: Command["action"], extra: Partial<Command> = {}) {
    if (!state || busy) return;
    const generation = sessionGeneration.current;
    const isCurrent = () => sessionRef.current === sessionId && sessionGeneration.current === generation;
    const approvedAction = action === "apply" ? state.proposal?.action : action;
    const requestNode = extra.node ?? node;
    const following = (approvedAction === "confirm" || approvedAction === "complete") && requestNode !== "report" ? steps[steps.indexOf(requestNode) + 1] : undefined;
    const recoveryState = state;
    const recoveryDraft = extra.draft ?? draft;
    messageDraft.current = action === "message" && recoveryDraft ? { draft: recoveryDraft, node: requestNode } : null;
    if (following) setLoadingNode(following);
    else if (["generate", "start", "retry"].includes(approvedAction ?? action)) setLoadingNode(requestNode);
    responseEpoch.current += 1; commandVersion.current = state.version + 1; setPending(true); setError(null);
    try {
      const input = { sessionId, node: requestNode, action, requestId: crypto.randomUUID(), expectedVersion: state.version, ...extra };
      const streamsReport = following === "report" || (requestNode === "report" && (approvedAction === "generate" || approvedAction === "retry" || action === "message"));
      const controller = streamsReport ? new AbortController() : null;
      streamController.current = controller;
      const received = streamsReport ? await executeResearchRuntime(input, (event) => {
        if (!isCurrent()) return;
        const current = snapshotRef.current;
        if (event.type === "progress") {
          if (!current || event.state.version < input.expectedVersion + 1) return;
          const next = mergeResearchProgress(current, event.state);
          snapshotRef.current = next; setState(next);
        } else if (event.type === "snapshot") {
          if (event.state.sessionId !== sessionId || event.state.version < input.expectedVersion + 1) return;
          const next = newestSnapshot(event.state, current);
          responseEpoch.current += 1;
          snapshotRef.current = next; setState(next);
          // The server identifies actual generation; ordinary chat proposals keep
          // their editor visible. Retain the draft separately for failure recovery.
          if (action === "message" && next.busy && next.reportStream?.requestId === input.requestId && next.reportStream.status === "streaming") setLoadingNode("report");
        } else if (event.type === "report_delta") {
          if (!current || event.sessionId !== sessionId || event.requestId !== input.requestId || event.version !== input.expectedVersion + 1 || current.version !== event.version || !current.busy) return;
          const previous = current.reportStream;
          if (!previous || previous.requestId !== event.requestId || event.sequence !== previous.sequence + 1) return;
          const next = { ...current, reportStream: { ...previous, sequence: event.sequence, text: previous.text + event.delta } };
          snapshotRef.current = next; setState(next);
        }
      }, controller!.signal) : await executeResearchRuntime(input);
      if (!isCurrent()) return;
      // Confirmation and following generation share a durable server request.
      // Never dispatch a second command from a response or a recovered snapshot.
      const next = newestSnapshot(received, snapshotRef.current);
      responseEpoch.current += 1; snapshotRef.current = next;
      setState(next);
      const target = next !== received || action === "confirm" || action === "complete" || action === "apply" ? next.currentNode : requestNode;
      setNode(target); setDraft(draftOf(next, target));
      if (next.errorCode) setError(errors[next.errorCode] ?? "处理失败，已保存当前进度，请重试。");
      if (action === "message" && next.errorCode && recoveryDraft) {
        setNode(requestNode); setDraft(recoveryDraft);
        updateRecovery({ draft: recoveryDraft, node: requestNode, synchronized: true });
      }
      if (action === "message" && !next.errorCode) setMessage("");
      return !next.errorCode;
    } catch (cause) {
      if (!isCurrent()) return;
      // Capture the submitted editor before a recovery read or polling can replace it.
      const localDraft = recoveryDraft && (action === "message" || JSON.stringify(recoveryDraft) !== JSON.stringify(draftOf(recoveryState, requestNode))) ? recoveryDraft : null;
      setNode(requestNode);
      updateRecovery({ draft: localDraft, node: requestNode, synchronized: false });
      if (localDraft) setDraft(localDraft);
      setError(requestError(cause));
      await recoverProgress(sessionId);
    } finally { if (isCurrent()) { messageDraft.current = null; streamController.current = null; setPending(false); setLoadingNode(null); } }
  }
  async function recoverProgress(targetSession: string) {
    const generation = sessionGeneration.current;
    try {
      const received = await getResearchRuntime(targetSession);
      if (sessionRef.current !== targetSession || generation !== sessionGeneration.current) return;
      const latest = newestSnapshot(received, snapshotRef.current);
      responseEpoch.current += 1; snapshotRef.current = latest; setState(latest);
      const previous = recoveryRef.current;
      if (previous?.draft) updateRecovery({ ...previous, synchronized: true });
      else if (previous) {
        // There is no competing local edit to resolve. Restore the saved step
        // directly without another confirmation or replaying the failed command.
        setNode(latest.currentNode); setDraft(draftOf(latest, latest.currentNode)); updateRecovery(null);
        if (latest.busy && latest.leaseUntil && Date.parse(latest.leaseUntil) > Date.now()) setError(null);
      }
    } catch { /* Keep the editor and the explicit recovery action until a read succeeds. */ }
  }
  function finishRecovery(keepLocal: boolean) {
    if (!state || !recovery?.synchronized || processing) return;
    const target = keepLocal ? recovery.node : state.currentNode;
    if (!state.availableNodes.includes(target)) return;
    setNode(target); setDraft(keepLocal ? recovery.draft : draftOf(state, target));
    updateRecovery(null); setError(null);
  }
  function navigate(next: Command["node"]) { if (state && !busy) { setNode(next); setDraft(draftOf(state, next)); setError(null); } }
  const validDraft = !topicInformationDirty && Boolean(draft && C.GuidedResearchRuntimeDraft.safeParse(draft).success);
  if (!state || state.sessionId !== sessionId) return <GuidedResearchSixStepShell current={routeStage ?? "import"} available={[]} onBack={onBack} onNavigate={() => undefined} main={<div role="status" className="p-4">{error ?? "正在恢复研究会话…"}{error && <Button variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>重试加载</Button>}</div>} />;
  const latestRecoveryDraft = recovery?.synchronized ? draftOf(state, recovery.node) : null;
  const proposal = !state.busy && !state.errorCode && state.proposal?.version === state.version && state.proposal.draft.node === node ? state.proposal : null;
  const proposalEdited = Boolean(proposal && JSON.stringify(draft) !== JSON.stringify(proposal.draft));
  const displaySources = proposal && draft?.node === "research" ? state.sources.map((source) => ({ ...source, decision: draft.value.find((item) => item.id === source.id)?.decision ?? source.decision })) : state.sources;
  const displayReport = draft?.node === "report" ? draft.value : state.report;
  const researchPending = state.tasks.some((task) => task.status === "pending" || task.status === "running");
  const researchFailed = state.tasks.some((task) => task.status === "failed");
  const usableSources = state.sources.some((source) => source.decision !== "excluded");
  const partialResearch = node === "research" && researchFailed && !researchPending && usableSources;
  const researchBlocked = node === "research" && (researchPending || !state.tasks.length || !usableSources);
  const reportVisible = (loadingNode ?? node) === "report";
  const waiting = Boolean(loadingNode || (!pending && state.busy && !expired && !recovery));
  const readingReport = reportVisible && !waiting && Boolean(displayReport || state.reportDraft);
  const resumeReport = Boolean(state.errorCode || expired || state.reportDraft);
  const streamPreview = researchReportPreview(state.reportStream?.text ?? "");
  const hasRenderableReportPreview = Boolean(streamPreview.summary || streamPreview.introduction || streamPreview.conclusion || streamPreview.sections.some((section) => section.body) || state.reportCheckpoint?.chapters.some((chapter) => chapter.body));
  const showReportRecoveryActions = !waiting && !readingReport && resumeReport && !hasRenderableReportPreview;
  const reportPrimaryAction = !waiting && (resumeReport
    ? <Button variant="primary" disabled={busy} data-testid="research-report-primary-action" onClick={() => void run("retry")}>生成完整报告</Button>
    : state.report && !state.completed
      ? <Button variant="primary" disabled={busy || Boolean(proposal)} data-testid="research-report-primary-action" onClick={() => void run("complete", { draft: { node: "report", value: displayReport! } })}>完成研究</Button>
      : !state.report
        ? <Button variant="primary" disabled={busy} data-testid="research-report-primary-action" onClick={() => void run("generate")}>生成报告</Button>
        : <span role="status" className="self-center text-sm text-muted-foreground">研究报告 · {researchCompletionLabel(state.completed, state.publicationReadiness)}</span>);
  const reportAssistantMenuAction = <DropdownMenuItem onSelect={() => setReportAssistantOpen((open) => !open)}>{reportAssistantOpen ? "收起助手" : "修改报告"}</DropdownMenuItem>;
  const reportActions = <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-24 font-semibold">研究报告{state.completed ? " · 已完成" : ""}</h1>{reportPrimaryAction}{showReportRecoveryActions && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="更多操作">更多操作</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{reportAssistantMenuAction}<DropdownMenuSeparator /><DropdownMenuItem disabled={busy} onSelect={() => void run("generate")}>重新生成报告</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>;
  const reportDocument = displayReport ? researchReportDocument(displayReport, state.sources, state.outline) : null;
  const briefDocument = draft?.node === "brief" ? serializeGuidedResearchMarkdown({ node: "brief", brief: draft.value }) : null;
  const directionsDocument = draft?.node === "directions" ? serializeGuidedResearchMarkdown({ node: "directions", directions: draft.value }) : null;
  const outlineDocument = draft?.node === "outline" ? serializeGuidedResearchMarkdown({ node: "outline", outline: draft.value }) : null;
  const researchDocument = node === "research" ? serializeGuidedResearchMarkdown({ node: "research", brief: state.brief, tasks: state.tasks, sources: displaySources, evidence: state.questionEvidence ?? [] }) : null;
  const reportMarkdownDocument = displayReport ? serializeGuidedResearchMarkdown({ node: "report", report: displayReport }) : null;
  const visualStage = toGuidedResearchVisualStage({ currentNode: loadingNode ?? node, availableNodes: state.availableNodes });
  const navigateVisual = (stage: GuidedResearchVisualStage) => {
    const visualToNode: Record<GuidedResearchVisualStage, Command["node"]> = { import: "brief", topic: "directions", plan: "outline", research: "research", chapters: "report", report: "report" };
    const next = visualToNode[stage];
    if (state.availableNodes.includes(next) && !busy) {
      setChaptersOpen(stage === "chapters");
      navigate(next);
      window.history.pushState({}, "", guidedResearchRoute(sessionId, stage));
    }
  };
  const conversation = <GuidedResearchConversation node={node} messages={state.messages} message={message} onMessageChange={setMessage} busy={busy} processing={processing}
    onSend={(text) => { if (text.trim()) void run("message", { message: text.trim(), ...(draft ? { draft } : {}) }); }}
    proposal={proposal} proposalEdited={proposalEdited} onApply={() => void run("apply", { proposalId: proposal?.id })}
    preview={proposal ? <ProposalPreview draft={proposal.draft} /> : null} />;
  const shellAssistant = conversation;
return <GuidedResearchSixStepShell hasUnsavedChanges={Boolean(message.trim()) || topicInformationDirty || chaptersDirty || markdownDirty || Boolean(draft && JSON.stringify(draft) !== JSON.stringify(draftOf(state, node)))} sessionId={sessionId} current={node === "report" && chaptersOpen ? "chapters" : visualStage.current} available={visualStage.available} onBack={onBack} onNavigate={navigateVisual} assistant={shellAssistant} assistantOpen={reportAssistantOpen} onAssistantOpenChange={setReportAssistantOpen} main={<div className="max-w-none space-y-4" data-layout="signed-desktop" data-testid={`research-flow-${node === "research" ? "search" : node}`}>
    <GuidedResearchStepLayout>
      <div className="space-y-5">
        {proposal && !waiting && <p role="status" className="rounded-lg border border-primary/30 bg-muted/30 px-4 py-3 text-12" data-testid="research-conversation-draft">右侧已同步对话生成的「{labels[node]}」待应用内容，尚未应用。你可以继续在左侧提出修改，核对后请先在左侧应用建议，再确认并继续。{proposalEdited && " 右侧另有手动修改，请继续对话形成新建议后应用。"}</p>}
    {recovery && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12" data-testid="research-recovery"><summary className="cursor-pointer font-medium">需要核对研究进度{recovery.draft ? " · 待应用内容已保留" : ""}</summary><div className="mt-3 space-y-3">
      <p role="status" className="text-12">{recovery.synchronized ? "已读取最新研究进度。请核对后继续，系统不会自动重复提交。" : "尚未确认最新研究进度，请先重新连接。"}{recovery.draft && " 你的未提交待应用内容已保留在当前页面。"}</p>
      {recovery.draft && <details className="text-12"><summary>查看保留的待应用内容</summary><ProposalPreview draft={recovery.draft} /></details>}
      {latestRecoveryDraft && <details className="text-12"><summary>查看服务端最新内容</summary><ProposalPreview draft={latestRecoveryDraft} /></details>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => void recoverProgress(sessionId)}>重新读取进度</Button>
        <Button disabled={!recovery.synchronized || processing} onClick={() => finishRecovery(false)}>使用最新进度</Button>
        {recovery.draft && <Button variant="outline" disabled={!recovery.synchronized || processing || !state.availableNodes.includes(recovery.node)} onClick={() => finishRecovery(true)}>{node === "report" ? "继续编辑保留的内容" : "继续编辑保留的草稿"}</Button>}
      </div>
    </div></details>}
    {(error || (node === state.currentNode && state.errorCode)) && <p role="alert" className="rounded-md border border-destructive p-3 text-12 text-destructive">{error ?? errors[state.errorCode!] ?? "上次处理失败，请重试。"}</p>}
    {!readingReport && node !== "research" && state.legacyCheckpoint && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12 text-muted-foreground"><summary>历史记录已保留 · 查看迁移说明</summary><p className="mt-2">原会话状态：{state.legacyCheckpoint.status === "completed" ? "已完成" : "进行中"}。原方向与大纲已导入；旧版检索和报告没有可验证的来源记录，需要重新检索后生成报告。</p><p>原研究主题：{state.legacyCheckpoint.brief.topic}</p><ul>{state.legacyCheckpoint.directions.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.description}</li>)}</ul><ul>{state.legacyCheckpoint.outline.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.questions.join("；")}</li>)}</ul></details>}
    {expired && !error && !state.errorCode && <p role="alert" className="text-12 text-destructive">上次执行已中断。已保存的结果仍可用，请重试。</p>}
        {reportVisible && !readingReport && reportActions}
        {!readingReport && (loadingNode ?? node) !== "research" && (reportVisible && state.reportTimeline?.length ? <GuidedResearchReportTimeline state={state} interrupted={expired} /> : <GuidedResearchRuntimeProgress state={state} />)}
        {reportVisible && !readingReport && <GuidedResearchEvidenceWarning state={state} />}
        {reportVisible && <GuidedResearchReportHistory state={state} />}
        {waiting && (loadingNode ?? node) === "research" && <p role="status" data-testid="research-step-loading" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />正在搜索、阅读和分析资料，进度会自动保存…</p>}
        {reportVisible && !readingReport && state.reportPartial && <p className="rounded-md border border-border bg-muted/30 p-3 text-12" data-testid="research-report-evidence-gap">本报告基于已有来源生成，部分检索任务未成功，相关证据可能存在缺口。</p>}
        {reportVisible && !displayReport && <GuidedResearchQualityDraft state={state} actions={reportPrimaryAction} moreActions={reportAssistantMenuAction} onRegenerate={() => void run("generate")} />}
        {reportVisible && !state.report && !state.reportDraft && (state.reportStream || (!state.report && state.reportCheckpoint)) && <GuidedResearchReportPreview state={state} interrupted={expired} moreActions={showReportRecoveryActions ? undefined : reportAssistantMenuAction} onRegenerate={() => void run("generate")} />}
        {waiting && (loadingNode ?? node) !== "research" ? (reportVisible && (state.reportTimeline?.length || state.reportStream || (!state.report && state.reportCheckpoint)) ? null : <ResearchLoading node={loadingNode ?? node} />) : <>
        {processing && !(reportVisible && state.reportTimeline?.length) && <p role="status" className="flex items-center gap-2 text-12 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />正在处理，进度会自动保存…</p>}
        {briefDocument && <GuidedResearchEntryPanel disabled={busy || Boolean(proposal) || !validDraft} onRegenerate={() => void run("generate", validDraft && draft ? { draft } : {})} onSave={() => { if (draft) void run("save", { draft }); }} onContinue={() => void run("confirm", { ...(draft ? { draft } : {}) })} brief={<><Textarea aria-label="研究需求" placeholder="请描述你的研究需求：研究目标、研究区域、时间范围、重点关注和关键问题。" className="min-h-80 resize-y p-5 text-lg leading-relaxed" maxLength={2000} disabled={busy} value={draft?.node === "brief" ? draft.value.goal : ""} onChange={(event) => { if (draft?.node === "brief") setDraft({ ...draft, value: { ...draft.value, goal: event.target.value } }); }} /><p className="text-right text-base text-muted-foreground">{draft?.node === "brief" ? draft.value.goal.length : 0} / 2000</p><details><summary className="cursor-pointer text-sm font-medium">完善研究信息与 Markdown</summary><div className="mt-4"><GuidedResearchMarkdownWorkspace onDirtyChange={setMarkdownDirty} document={briefDocument} saving={busy} onSave={async (markdown) => {
          const parsed = parseGuidedResearchMarkdown({ document: briefDocument, markdown });
          if (!parsed.ok) return { ok: false, message: parsed.errors.map((item) => item.message).join("；") };
          if (draft?.node !== "brief") return { ok: false, message: "研究需求已更新，请重新打开 Markdown。" };
          const saved = await run("save", { draft: { node: "brief", value: { ...draft.value, ...parsed.draft.value } } });
          return saved ? { ok: true } : { ok: false, message: "研究需求未保存，请根据页面提示重试。" };
        }} /></div></details></>} />}
        {draft?.node === "brief" && <Card className="sr-only" aria-hidden="true"><CardContent>{(["topic", "goal", "timeRange", "region", "focus"] as const).map((field) => <label key={field}>{field}<Textarea disabled tabIndex={-1} value={draft.value[field]} onChange={(event) => setDraft({ ...draft, value: { ...draft.value, [field]: event.target.value } })} /></label>)}</CardContent></Card>}
        {draft?.node === "directions" && <GuidedResearchTopicPanel assistant={conversation} actions={<div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" className="h-12 px-6 text-base" disabled={busy} onClick={() => navigateVisual("import")}>上一步</Button><Button className="h-12 px-6 text-base" disabled={busy || Boolean(proposal) || !validDraft} onClick={() => void run("confirm", { draft })}>下一步：研究计划</Button></div>} workspace={<>
          <h2 className="text-3xl font-bold">完善研究信息</h2>
          <ResearchTopicInformation brief={state.brief} disabled={busy || Boolean(proposal)} onDirtyChange={setTopicInformationDirty} onSave={(value) => void run("save", { node: "brief", draft: { node: "brief", value } })} />
          <details><summary className="cursor-pointer text-base font-medium">查看与编辑研究方向 Markdown</summary><div className="mt-5 space-y-5">
          {directionsDocument && <GuidedResearchMarkdownWorkspace onDirtyChange={setMarkdownDirty} document={directionsDocument} saving={busy} onSave={async (markdown) => {
            const parsed = parseGuidedResearchMarkdown({ document: directionsDocument, markdown });
            if (!parsed.ok) return { ok: false, message: parsed.errors.map((item) => item.message).join("；") };
            const saved = await run("save", { draft: parsed.draft });
            return saved ? { ok: true } : { ok: false, message: "研究主题未保存，请根据页面提示重试。" };
          }} provenance="Markdown 是研究主题的可编辑来源；保存后会保留版本。" />}
          <ResearchDirectionsEditor draft={draft} disabled={busy} onChange={setDraft} />
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy || !validDraft} onClick={() => void run("generate", { draft })}>重新生成本步骤</Button><Button variant="outline" disabled={busy || Boolean(proposal) || !validDraft} onClick={() => void run("save", { draft })}>保存草稿</Button></div>
          </div></details>
        </>} />}
        {draft?.node === "outline" && <GuidedResearchPlanPanel onBack={() => navigateVisual("topic")} editDisabled={busy || Boolean(proposal)} disabled={busy || Boolean(proposal) || !validDraft || !state.intent} onConfirm={() => void run("confirm", { draft })} onEdit={(field) => {
          if (field === "criteria" || field === "sources") {
            if (JSON.stringify(draft.value) !== JSON.stringify(state.outline)) {
              setError("请先保存研究计划中的章节修改，再编辑成功标准或来源范围。");
              return;
            }
            setScopeEditorOpen(true);
          }
          else if (planEditor.current) { planEditor.current.open = true; planEditor.current.scrollIntoView({ behavior: "smooth", block: "center" }); }
        }}
          plan={<><div className="rounded-lg border bg-muted/20 p-5"><p className="text-base text-muted-foreground">研究主题</p><h3 className="mt-2 text-xl font-bold">{state.brief.topic}</h3><p className="mt-3 text-base leading-relaxed text-muted-foreground">{state.brief.goal}</p></div><details ref={planEditor} className="mt-4"><summary className="cursor-pointer text-base font-medium">编辑研究计划 Markdown 与章节结构</summary><div className="mt-4">{outlineDocument && <GuidedResearchMarkdownWorkspace onDirtyChange={setMarkdownDirty} document={outlineDocument} saving={busy} onSave={async (markdown) => {
            const parsed = parseGuidedResearchMarkdown({ document: outlineDocument, markdown });
            if (!parsed.ok) return { ok: false, message: parsed.errors.map((item) => item.message).join("；") };
            const saved = await run("save", { draft: parsed.draft });
            return saved ? { ok: true } : { ok: false, message: "研究计划未保存，请根据页面提示重试。" };
          }} provenance="Markdown 是研究计划的可编辑来源；检索范围以已确认版本为准。" />}<div className="mt-4"><ResearchOutlineEditor draft={draft} disabled={busy} onChange={setDraft} /></div></div></details></>}
          questions={<ol className="list-inside list-decimal space-y-1 text-lg leading-relaxed">{draft.value.filter((item) => item.enabled).flatMap((item) => item.questions.map((question, index) => <li key={`${item.id}-${index}`}><span className="font-medium">{item.title}：</span>{question}</li>))}</ol>}
          sourceScope={<div className="space-y-2 text-lg"><p>{state.sourcePolicy?.mode === "restrict" ? "仅检索指定站点" : state.sourcePolicy?.mode === "prioritize" ? "优先检索指定站点" : "检索公开网页资料"}</p>{state.sourcePolicy?.domains.length ? <p className="text-muted-foreground">{state.sourcePolicy.domains.join("、")}</p> : <p className="text-muted-foreground">请先确认研究边界与来源策略。</p>}</div>}
          successCriteria={<ul className="list-inside list-disc space-y-2">{state.intent?.successCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>}
          materials={<ul className="list-inside list-disc space-y-2">{draft.value.filter((chapter) => chapter.enabled).map((chapter) => <li key={chapter.id}>{chapter.title}：{chapter.objective}</li>)}</ul>}
        />}
        {node === "outline" && <Dialog open={scopeEditorOpen} onOpenChange={setScopeEditorOpen}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogTitle>编辑成功标准与来源范围</DialogTitle><DialogDescription>修改会保留旧版本，并按新的研究边界重新规划。</DialogDescription><GuidedResearchIntentPlan initialIntent={state.intent} initialPolicy={state.sourcePolicy} revision={state.planRevision ?? 0} disabled={busy} onConfirm={async ({ intent, sourcePolicy, expectedRevision }) => { const saved = await run("refine_scope", { intent, sourcePolicy, expectedRevision, idempotencyKey: trustCommandId("scope") }); if (saved) setScopeEditorOpen(false); }} /></DialogContent></Dialog>}
        {node === "research" && <GuidedResearchSourceWorkspace
          sourcePreview={<ol className="space-y-3">{displaySources.filter((source) => source.decision !== "excluded").slice(0, 3).map((source, index) => <li key={source.id} className="flex gap-3"><span className="shrink-0 text-muted-foreground">{index + 1}</span><a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{source.title}</a></li>)}{!usableSources && <li className="text-muted-foreground">尚未取得可用来源</li>}</ol>}
          progress={<><GuidedResearchRuntimeProgress state={state} /><ResearchChapterTasks state={state} />{!state.intent && <p role="status" className="mt-3 text-sm text-muted-foreground">请返回报告大纲步骤确认研究边界后再开始检索。</p>}</>}
          activity={<><GuidedResearchTrustConsole compact runtime={state} pending={steeringPending} onSteer={(action) => void steer(action)} onResolveConflict={(decision) => void resolveConflict(decision)} /><details className="mt-4"><summary className="cursor-pointer text-12 font-medium">查看搜索详情</summary><div className="mt-3"><GuidedResearchPlanDetails state={state} errors={errors} /></div></details></>}
          evidence={<>{researchDocument && <GuidedResearchMarkdownWorkspace onDirtyChange={setMarkdownDirty} document={researchDocument} saving={busy} onSave={async (markdown) => {
            const parsed = parseGuidedResearchMarkdown({ document: researchDocument, markdown });
            if (!parsed.ok) return { ok: false, message: parsed.errors.map((item) => item.message).join("；") };
            const saved = await run("save", { draft: parsed.draft });
            return saved ? { ok: true } : { ok: false, message: "来源决策未保存，请根据页面提示重试。" };
          }} provenance={`已锁定 ${researchDocument.provenance.sourceIds.length} 个来源标识；Markdown 仅可调整来源决策，不能篡改证据标识。`} />}<div className="mt-4"><GuidedResearchSources sources={displaySources} disabled={busy || Boolean(proposal)} onAdd={(sourceUrl) => run("add_source", { sourceUrl })} onRemove={(sourceId) => void run("remove_source", { sourceId })} /></div></>}
          insights={<p className="text-base leading-relaxed">研究概览：{state.researchPlan?.overview ?? "检索完成后会在这里汇总关键发现与证据覆盖情况。"}</p>}
          risk={<>{researchFailed ? <p className="text-base text-destructive">存在 {state.tasks.filter((task) => task.status === "failed").length} 项检索失败；可重试或补充来源。</p> : <p className="text-base text-muted-foreground">当前没有待处理的检索失败。</p>}{state.tasks.length > 0 && !state.questionEvidence?.length && <p className="mt-3 text-sm text-destructive">尚未提取到可关联的核心问题证据。</p>}</>}
          actions={<>{(!state.tasks.length || state.tasks.some((task) => task.status !== "succeeded") || state.sources.some((source) => source.decision !== "excluded" && !source.addedByUser && !source.presentation)) && <Button variant="primary" className="h-12 px-6 text-lg" disabled={busy} onClick={() => void run("start")}>{state.tasks.length && state.tasks.every((task) => task.status === "succeeded") ? "更新资料" : state.sources.length ? "继续搜索" : "搜索资料"}</Button>}{state.tasks.some((task) => task.status === "failed" || (expired && task.status === "running")) && <Button variant="outline" className="h-12 px-6 text-lg" disabled={busy} onClick={() => void run("retry")}>重试失败任务</Button>}</>}
        />}
        {node === "report" && chaptersOpen && <ResearchChaptersWorkspace onDirtyChange={setChaptersDirty} runtime={state} disabled={busy} onSave={(value) => void run("save", { node: "outline", draft: { node: "outline", value } })} onOptimize={(value) => void run("message", { node: "outline", draft: { node: "outline", value }, message: "基于当前章节和已有研究证据优化章节结构、目标与小节，保留来源和证据局限。" })} onBack={() => navigateVisual("research")} onNext={() => navigateVisual("report")} />}
        {node === "report" && !chaptersOpen && reportDocument && <GuidedResearchReportWorkspace
          actions={null}
          contents={<nav aria-label="报告工作区目录" className="space-y-4 text-base text-muted-foreground"><a className="block rounded bg-muted p-3" href="#research-report-summary">执行摘要</a>{reportDocument.introduction && <a className="block p-3" href="#research-report-introduction">研究范围与方法</a>}{reportDocument.sections.map((section, index) => <a className="block p-3" href={`#research-report-section-${index}`} key={section.sectionId}>{index + 1}. {section.title}</a>)}{reportDocument.conclusion && <a className="block p-3" href="#research-report-conclusion">综合结论</a>}<a className="block border-t p-3" href="#research-report-references">参考来源</a></nav>}
          document={<div data-testid="research-report" data-layout="full-width-report"><ResearchPrototypeReport document={reportDocument} sources={state.sources.filter((source) => source.decision !== "excluded").length} limitations={researchLimitations(state.completed, state.publicationReadiness)} actions={reportPrimaryAction} moreActions={reportAssistantMenuAction} onRegenerate={() => void run("generate")} disabled={busy || Boolean(proposal)} />{reportMarkdownDocument && <details className="mt-5" open={reportMarkdownOpen} onToggle={(event) => setReportMarkdownOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">编辑报告 Markdown</summary>{reportMarkdownOpen && <div className="mt-3"><GuidedResearchMarkdownWorkspace onDirtyChange={setMarkdownDirty} document={reportMarkdownDocument} saving={busy} onSave={async (markdown) => {
            const parsed = parseGuidedResearchMarkdown({ document: reportMarkdownDocument, markdown });
            if (!parsed.ok) return { ok: false, message: parsed.errors.map((item) => item.message).join("；") };
            const saved = await run("save", { draft: parsed.draft });
            return saved ? { ok: true } : { ok: false, message: "研究报告未保存，请根据页面提示重试。" };
          }} provenance="报告 Markdown 可编辑；来源引用标识必须保持不变。" /></div>}</details>}</div>}
          metrics={null}
          limitation={<div className="space-y-3">{state.qualityScore && state.publicationReadiness ? <GuidedResearchReadiness quality={state.qualityScore} readiness={state.publicationReadiness} /> : <p>{researchLimitations(state.completed, state.publicationReadiness) ?? "报告正在汇总质量与来源信息。"}</p>}</div>}
        />}
        {researchBlocked && <p role="status" className="text-12 text-muted-foreground">{researchPending ? "检索仍在进行，任务结束后可生成报告。" : "请完成检索并保留至少一个真实来源后生成报告。"}</p>}
        {node === "brief" && state.currentNode !== node && <p className="text-12 text-muted-foreground">重新确认此步骤会使后续研究结果失效，并按当前内容重新生成。</p>}
        {node !== "report" && node !== "brief" && node !== "directions" && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card/95 py-4">{state.currentNode !== node && <p className="mr-auto text-12 text-muted-foreground">重新确认此步骤会使后续研究结果失效，并按当前内容重新生成。</p>}{node !== "research" && <Button variant="outline" disabled={busy || Boolean(draft && !validDraft)} onClick={() => void run("generate", validDraft && draft ? { draft } : {})}><Sparkles className="size-4" aria-hidden />重新生成本步骤</Button>}<Button variant="outline" disabled={busy || Boolean(proposal) || !validDraft} onClick={() => draft && void run("save", { draft })}>保存草稿</Button><Button variant="primary" disabled={busy || Boolean(proposal) || !validDraft || researchBlocked || (node === "outline" && !state.intent)} onClick={() => void run(node === "research" ? "complete" : "confirm", { ...(draft ? { draft } : {}), ...(partialResearch ? { allowPartialResearch: true } : {}) })}>{partialResearch ? "基于已有来源生成报告" : "确认并继续"}</Button></div>}
        </>}
      </div>
    </GuidedResearchStepLayout>
  </div>} />;
}
