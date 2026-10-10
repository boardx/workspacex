"use client";
import { guidedResearchHeading } from "@/lib/guided-research-heading";
import { ResearchRuntimeHydrationError } from "@/lib/guided-research-hydration";
import { GuidedResearchExecutionTimeline } from "./guided-research-execution-timeline";
import * as React from "react";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { readResearchMemory, writeResearchMemory } from "@/lib/guided-research-memory";
import { research as C } from "@repo/contracts";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GuidedResearchConversation } from "./guided-research-conversation";
import { ResearchLoading, researchSteps as steps, researchStepLabels as labels } from "./guided-research-presentation";
import { researchReportDocument } from "@/lib/research-report-document";
import { ResearchPrototypeReport } from "./research-prototype-report";
import { GuidedResearchEvidenceWarning } from "./guided-research-report-history";
import { GuidedResearchQualityDraft } from "./guided-research-quality-draft";
import { GuidedResearchReportPreview } from "./guided-research-report-preview";
import { researchReportPreview } from "@/lib/research-report-preview";
import { ResearchDesignPreview } from "./guided-research-design-editor";

import { GuidedResearchStepLayout } from "./guided-research-step-layout";
import { GuidedResearchMarkdownWorkspace } from "./guided-research-markdown-workspace";
import { GuidedResearchSixStepShell } from "./guided-research-six-step-shell";
import { guidedResearchRoute } from "@/lib/guided-research-routes";
import { GuidedResearchEntryPanel } from "./guided-research-entry-panel";
import { ResearchChaptersWorkspace } from "./research-chapters-workspace";
import { GuidedResearchPlanPanel } from "./guided-research-plan-panel";
import { GuidedResearchSourceWorkspace } from "./guided-research-source-workspace";
import { GuidedResearchReportWorkspace } from "./guided-research-report-workspace";
import { chapterBody, reportSectionHeadings } from "./guided-research-report-document";
import { parseGuidedResearchMarkdown, serializeGuidedResearchMarkdown } from "@/lib/guided-research-markdown";
import { GuidedResearchPlanEditor } from "./guided-research-plan-editor";
import { canonicalResearchStage, toGuidedResearchVisualStage, type GuidedResearchVisualStage } from "@/lib/guided-research-six-step";
import { getResearchRuntime, getResearchRuntimeProgress, mergeResearchProgress, executeResearchRuntime, type GuidedResearchRuntime as Runtime, type GuidedResearchRuntimeCommand as Command, type GuidedResearchRuntimeDraft as Draft } from "@/lib/guided-research-api";
function visualDestination(stage: GuidedResearchVisualStage, availableNodes: Runtime["availableNodes"], loadingNode: Runtime["currentNode"] | null): Runtime["currentNode"] {
  const screen = canonicalResearchStage(stage);
  if (loadingNode && toGuidedResearchVisualStage({ currentNode: loadingNode, availableNodes }).current === screen) return loadingNode;
  return screen === "import" ? "brief" : screen === "plan" ? availableNodes.includes("outline") ? "outline" : "directions" : availableNodes.includes("report") ? "report" : "research";
}
function newestSnapshot(incoming: Runtime, current: Runtime | null): Runtime {
  if (!current || current.sessionId !== incoming.sessionId) return incoming;
  if (current.version > incoming.version || (current.version === incoming.version && !current.busy && incoming.busy)) return current;
  if (current.version !== incoming.version) return incoming;
  if (current.revision > incoming.revision) {
    const stream = incoming.reportStream; const previous = current.reportStream;
    // Stream sequence advances independently of persisted metadata revision.
    return current.busy && incoming.busy && stream?.status === "streaming" && previous?.status === "streaming"
      && stream.requestId === previous.requestId && stream.sequence > previous.sequence
      ? { ...current, reportStream: stream } : current;
  }
  const newerControl = (current.planRevision ?? 0) > (incoming.planRevision ?? 0);
  const newerStream = current.reportStream && incoming.busy && (!incoming.reportStream || (current.reportStream.requestId === incoming.reportStream.requestId && current.reportStream.sequence > incoming.reportStream.sequence));
  if (newerStream) return (incoming.planRevision ?? 0) > (current.planRevision ?? 0)
    ? { ...current, planRevision: incoming.planRevision, controlStatus: incoming.controlStatus, activity: incoming.activity } : current;
  return newerControl ? { ...incoming, planRevision: current.planRevision, controlStatus: current.controlStatus, activity: current.activity } : incoming;
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
  RESEARCH_REPORT_PREPARATION_TIME_BUDGET_EXCEEDED: "上次报告来源准备已中断，已保存章节仍保留，请重试继续生成。",
  RESEARCH_REPORT_MODEL_TIME_BUDGET_EXCEEDED: "报告模型响应超时，已保存章节仍保留，请重试继续生成。",
  RESEARCH_EVIDENCE_BUDGET_EXCEEDED: "大纲问题或来源内容超出本次分析容量，请精简后重试。",
  RESEARCH_REPORT_QUALITY_INSUFFICIENT: "报告处理未完成，已保存的进度会保留。",
  RESEARCH_GRAPH_VERSION_CONFLICT: "研究内容已更新，本次操作未提交。请核对最新进度后继续。",
  RESEARCH_REVISION_CONFLICT: "研究边界已在其他页面更新，请核对最新版本后重试。",
  RESEARCH_SOURCE_ACCESS_DENIED: "所选内部资料不在当前授权范围内。",
  RESEARCH_WORKFLOW_PAUSED: "研究已暂停，请继续后再执行检索。",
  RESEARCH_PLAN_TIME_BUDGET_EXCEEDED: "计划生成超过本轮时间上限，已停止等待。请重试，或编辑已有计划后继续。",
  RESEARCH_WORKFLOW_UNAVAILABLE: "研究流程暂时无法完成，请稍后重试；持续失败请联系管理员排查。",
  RESEARCH_NODE_MISMATCH: "研究步骤已变化，请查看最新进度后继续。",
  RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH: "请求状态发生冲突，请核对最新进度后重新操作。",
  RESEARCH_WORKFLOW_BUSY: "研究正在处理中，请稍候。",
  RESEARCH_SEARCH_NOT_CONFIGURED: "检索服务尚未配置，请联系管理员。",
  RESEARCH_SEARCH_NO_RELEVANT_SOURCES: "未找到能支持当前主题和研究问题的资料，请调整研究计划后重试。",
  RESEARCH_SOURCE_RELEVANCE_INVALID: "资料相关性评估未通过校验，尚未纳入新的资料，请重试。",
  RESEARCH_SEARCH_EMPTY: "检索服务未返回来源，请调整研究计划后重试。",
  RESEARCH_SEARCH_REQUEST_TIMEOUT: "本次检索请求超时，已保存成功结果，请重试未完成任务。",
  RESEARCH_DOCUMENT_TIMEOUT: "本次来源读取超时，请重试未完成任务。",
  RESEARCH_SOURCE_MODEL_TIMEOUT: "本次资料评估响应超时，已保存成功结果，请重试未完成任务。",
  RESEARCH_SEARCH_UNAVAILABLE: "检索服务暂时不可用，请重试。",
  RESEARCH_SEARCH_CONTENT_EMPTY: "检索结果缺少可用正文，请重试。",
  RESEARCH_EXECUTION_INTERRUPTED: "上次检索已中断，请重试。",
  RESEARCH_SEARCH_TIME_BUDGET_EXCEEDED: "上次资料研究已中断，已保存有效来源。请重试未完成任务。",
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
  if (error instanceof ResearchRuntimeHydrationError) return "已保存当前进度，暂时无法获取完整内容，请同步后继续。";
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已过期，请重新登录后继续。";
    if (error.status === 403) return "你暂时没有访问此研究的权限，请联系研究负责人。";
    if (error.status === 404) return "研究会话不存在或已不可访问，请返回研究首页。";
    if (error.reasonCode && errors[error.reasonCode]) return errors[error.reasonCode]!;
    if (error.status === 409) return "研究状态发生冲突，请核对最新进度后继续。";
  }
  return "暂时无法连接研究服务，请检查网络后重试。";
}
const RECOVERY_READ_TIMEOUT_MS = 10_000;
type Recovery = { draft: Draft | null; node: Command["node"]; synchronized: boolean };
export function GuidedResearchLive({ sessionId, researchName, onBack, onLoadRetry, initialNode, visualStage: routeStage }: { sessionId: string; researchName?: string; onBack: () => void; onLoadRetry?: () => void; initialNode?: Command["node"]; visualStage?: GuidedResearchVisualStage }) {
  const cacheScope = getStoredSessionToken();
  const [chaptersOpen, setChaptersOpen] = React.useState(false);
  const [chapterDetailsOpen, setChapterDetailsOpen] = React.useState(routeStage === "chapters");
  const [chapterDetailsMounted, setChapterDetailsMounted] = React.useState(routeStage === "chapters");
  const [state, setState] = React.useState<Runtime | null>(null);
  const [node, setNode] = React.useState<Command["node"]>("brief");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [message, setMessage] = React.useState("");
  const [reportAssistantOpen, setReportAssistantOpen] = React.useState(false);
  const [reportMarkdownOpen, setReportMarkdownOpen] = React.useState(false);
  const [chaptersDirty, setChaptersDirty] = React.useState(false);
  const [markdownDirty, setMarkdownDirty] = React.useState(false);
  const [loadingNode, setLoadingNode] = React.useState<Command["node"] | null>(null);
  const [browsing, setBrowsing] = React.useState(false);
  const browsingRef = React.useRef(false);
  const viewedNode = browsing ? node : loadingNode ?? node;
  const [pending, setPending] = React.useState(false);
  const [pendingNode, setPendingNode] = React.useState<Command["node"] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const [recovery, setRecovery] = React.useState<Recovery | null>(null);
  const recoveryRef = React.useRef<Recovery | null>(null);
  function updateRecovery(value: Recovery | null) { recoveryRef.current = value; setRecovery(value); }
  const snapshotRef = React.useRef<Runtime | null>(null);
  const responseEpoch = React.useRef(0);
  const commandVersion = React.useRef(0);
  const messageDraft = React.useRef<{ draft: Draft; node: Command["node"] } | null>(null);
  const topicSaveCompletion = React.useRef<((snapshot: Runtime) => void) | null>(null);
  const pollIssued = React.useRef(0);
  const pollAccepted = React.useRef(0);
  const sourceCursor = React.useRef<string | undefined>(undefined);
  const sessionGeneration = React.useRef(0);
  const [reportControlPending, setReportControlPending] = React.useState(false);
  const reportControlLock = React.useRef(false);
  const recoveryRead = React.useRef(recoverProgress);
  recoveryRead.current = recoverProgress;
  const recoveryController = React.useRef<AbortController | null>(null);
  const [, setLeaseClock] = React.useState(0);
  const streamController = React.useRef<AbortController | null>(null);
  const bootstrapStarted = React.useRef(false);
  const sessionRef = React.useRef(sessionId);
  sessionRef.current = sessionId;
  const nodeRef = React.useRef(node);
  nodeRef.current = node;
  React.useEffect(() => {
    if (!state) return;
    const stage = toGuidedResearchVisualStage({ currentNode: viewedNode, availableNodes: state.availableNodes }).current;
    const path = guidedResearchRoute(sessionId, stage);
    if (window.location.pathname !== path) window.history.replaceState({}, "", path);
  }, [viewedNode, loadingNode, browsing, chaptersOpen, sessionId, state]);
  const restoreVisualRoute = (stage: GuidedResearchVisualStage) => {
    const snapshot = snapshotRef.current;
    const target = visualDestination(stage, snapshot?.availableNodes ?? [], loadingNode);
    if (!snapshot || !(snapshot.availableNodes.includes(target) || target === loadingNode || stage === "chapters" && snapshot.availableNodes.includes("research"))) return;
    browsingRef.current = true; setBrowsing(true);
    setChaptersOpen(false);
    setNode(target); setDraft(draftOf(snapshot, target)); setError(null);
  };
  React.useEffect(() => {
    let active = true;
    sessionGeneration.current += 1;
    responseEpoch.current += 1; snapshotRef.current = null; messageDraft.current = null; topicSaveCompletion.current = null;
    bootstrapStarted.current = false; browsingRef.current = false; setBrowsing(false);
    sourceCursor.current = undefined;
    setChapterDetailsOpen(routeStage === "chapters"); setChapterDetailsMounted(routeStage === "chapters"); setChaptersDirty(false);
    setState(null); setDraft(null); setMessage(""); setError(null); setPending(false); setPendingNode(null); setLoadingNode(null); setReportMarkdownOpen(false); updateRecovery(null);
    const cached = loadAttempt === 0 ? readResearchMemory(sessionId, cacheScope)?.runtime : undefined;
    (cached ? getResearchRuntimeProgress(sessionId, cached.reportStream, undefined, cached).then((update) => mergeResearchProgress(cached, update)) : getResearchRuntime(sessionId)).then((next) => {
      if (!active) return;
      const startingPlan = (initialNode === "directions" || initialNode === "outline") && next.version === 0 && !next.legacyCheckpoint && !next.errorCode;
      const executing = next.busy && (!next.leaseUntil || Date.parse(next.leaseUntil) > Date.now());
      const target = executing ? next.currentNode : startingPlan ? "outline" : initialNode && next.availableNodes.includes(initialNode) ? initialNode : next.currentNode;
      setChaptersOpen(false);
      snapshotRef.current = next; setState(next); setNode(target); setDraft(draftOf(next, target));
    }).catch((cause: unknown) => { if (active) setError(requestError(cause)); });
    return () => { active = false; sessionGeneration.current += 1; streamController.current?.abort(); recoveryController.current?.abort(); };
  }, [sessionId, initialNode, routeStage, loadAttempt, cacheScope]);
  React.useEffect(() => {
    if (state?.sessionId === sessionId && snapshotRef.current === state) writeResearchMemory(sessionId, { runtime: state }, cacheScope);
  }, [state, sessionId, cacheScope]);
  // The clock tick makes lease expiry observable even when every poll fails.
  React.useEffect(() => {
    if (!state?.busy || !state.leaseUntil) return;
    let timer: number;
    const deadline = Date.parse(state.leaseUntil);
    // A successful read of an already expired lease permits the existing retry claim.
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
    const checkLease = () => {
      const remaining = deadline - Date.now();
      if (remaining > 0) { timer = window.setTimeout(checkLease, Math.min(remaining, 2_147_483_647)); return; }
      setLeaseClock((clock) => clock + 1);
      updateRecovery({ draft: recoveryRef.current?.draft ?? null, node: nodeRef.current, synchronized: false });
      void recoveryRead.current(sessionId);
    };
    timer = window.setTimeout(checkLease, Math.max(0, Math.min(deadline - Date.now(), 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [state?.busy, state?.leaseUntil, sessionId]);
  const expired = Boolean(state?.leaseUntil && Date.parse(state.leaseUntil) <= Date.now());
  React.useEffect(() => {
    if ((!pending && (!state?.busy || (expired && !recovery))) || (!state?.busy && (state?.version ?? -1) >= commandVersion.current && pending)) return;
    let active = true;
    const minimumVersion = pending ? commandVersion.current : 0;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      const epoch = responseEpoch.current; const ticket = ++pollIssued.current;
      const baseline = snapshotRef.current;
      let incomingSourceCursor = sourceCursor.current;
      const read = baseline
        ? getResearchRuntimeProgress(sessionId, baseline.reportStream, sourceCursor.current, baseline).then(async (update) => {
          if ("research" in update && update.research) incomingSourceCursor = update.research.cursor;
          // The patch describes changes relative to this request, not a newer SSE snapshot.
          return mergeResearchProgress(baseline, update);
        }) : getResearchRuntime(sessionId);
      read.then((next) => {
        const current = snapshotRef.current;
        if (!active || epoch !== responseEpoch.current || ticket < pollAccepted.current || next.version < minimumVersion || (current && (next.version < current.version || (next.version === current.version && !current.busy && next.busy)))) return;
        const accepted = newestSnapshot(next, current);
        if (accepted === current) return;
        next = accepted;
        pollAccepted.current = ticket; snapshotRef.current = next;
        sourceCursor.current = incomingSourceCursor;
        setState(next);
        if (!next.busy && recoveryRef.current) {
          recoveryController.current?.abort();
          const retained = recoveryRef.current;
          updateRecovery(retained.draft ? { ...retained, synchronized: true } : null);
          setPending(false); setLoadingNode(null);
          if (next.errorCode) setError(errors[next.errorCode] ?? "处理失败，已保存当前进度，请重试。");
        }
        if (!next.busy && pending) {
          // Durable terminal state wins even when the POST connection never closes.
          if (topicSaveCompletion.current) { topicSaveCompletion.current(next); topicSaveCompletion.current = null; }
          else sessionGeneration.current += 1;
          streamController.current?.abort(); streamController.current = null;
          setPending(false); setLoadingNode(null);
          if (next.errorCode) {
            setError(errors[next.errorCode] ?? "处理失败，已保存当前进度，请重试。");
            if (messageDraft.current) {
              const saved = messageDraft.current;
              updateRecovery({ ...saved, synchronized: true });
              if (!browsingRef.current) { setNode(saved.node); setDraft(saved.draft); }
              else setDraft(draftOf(next, nodeRef.current));
            }
          }
          messageDraft.current = null;
        }
        if (!recoveryRef.current) {
          // A restored server-owned command can advance after this page mounts.
          // Follow that operation, while leaving idle historical browsing alone.
          const target = !browsingRef.current && current?.busy && (!pending || !next.busy) ? next.currentNode : nodeRef.current;
          if (target !== nodeRef.current) { nodeRef.current = target; setNode(target); }
          setDraft(draftOf(next, target));
        }
      }).catch(() => { /* Retry this read without replaying the command. */ }).finally(() => { inFlight = false; });
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pending, state?.busy, state?.version, expired, recovery, sessionId]);
  const processing = pending || Boolean(state?.busy && !expired);
  const busy = processing || Boolean(recovery);
  React.useEffect(() => {
    // Only a newly created session on the confirmed destination can bootstrap.
    // Persisted busy/failed sessions are restored, never replayed on refresh.
    if (!state || bootstrapStarted.current || !["directions", "outline"].includes(initialNode ?? "") || state.version !== 0 || state.currentNode !== "brief" || state.busy || state.errorCode || state.legacyCheckpoint) return;
    bootstrapStarted.current = true;
    void run("prepare_plan", { node: "brief", draft: { node: "brief", value: state.brief } });
  });
  async function steerReport(action: "pause" | "resume") {
    const baseline = snapshotRef.current;
    if (!baseline || reportControlLock.current) return false;
    reportControlLock.current = true; setReportControlPending(true);
    const generation = sessionGeneration.current;
    try {
      const received = await executeResearchRuntime({ sessionId, node: baseline.currentNode === "research" ? "research" : "report", action,
        requestId: crypto.randomUUID(), expectedVersion: baseline.version,
        expectedRevision: baseline.planRevision ?? 0, idempotencyKey: crypto.randomUUID() });
      if (sessionRef.current !== sessionId || sessionGeneration.current !== generation) return false;
      const current = snapshotRef.current;
      if (!current || current.version !== received.version) return false;
      const next = (current.planRevision ?? 0) > (received.planRevision ?? 0) ? current : {
        ...current, planRevision: received.planRevision, controlStatus: received.controlStatus, activity: received.activity,
      };
      snapshotRef.current = next; setState(next); setError(null);
      return next.controlStatus === (action === "pause" ? "paused" : "running");
    } catch (cause) { if (sessionRef.current === sessionId) setError(requestError(cause)); return false; }
    finally { reportControlLock.current = false; setReportControlPending(false); }
  }
  async function run(action: Command["action"], extra: Partial<Command> = {}) {
    const state = snapshotRef.current;
    if (!state || busy) return;
    browsingRef.current = false; setBrowsing(false);
    const generation = sessionGeneration.current;
    const isCurrent = () => sessionRef.current === sessionId && sessionGeneration.current === generation;
    const approvedAction = action === "apply" ? state.proposal?.action : action;
    const requestNode = extra.node ?? node;
    setPendingNode(requestNode);
    const following = action === "prepare_plan" ? "outline" : action === "generate_report" && requestNode === "outline" ? "research" : (approvedAction === "confirm" || approvedAction === "complete") && requestNode !== "report" ? steps[steps.indexOf(requestNode) + 1] : undefined;
    const recoveryState = state;
    const recoveryDraft = extra.draft ?? draft;
    messageDraft.current = action === "message" && recoveryDraft ? { draft: recoveryDraft, node: requestNode } : null;
    if (following) { setLoadingNode(following); setChaptersOpen(false); }
    else if (["generate", "start", "retry"].includes(approvedAction ?? action)) setLoadingNode(requestNode);
    responseEpoch.current += 1; commandVersion.current = state.version + 1; setPending(true); setError(null);
    try {
      const input = { sessionId, node: requestNode, action, requestId: crypto.randomUUID(), expectedVersion: state.version, ...extra };
      const streamsCommand = action === "prepare_plan" || action === "generate_report" || (action === "retry" && Boolean(state.executionGoal)) || following === "outline" || following === "report" || (requestNode === "report" && (approvedAction === "generate" || approvedAction === "retry" || action === "message"));
      const controller = streamsCommand ? new AbortController() : null;
      streamController.current = controller;
      const received = streamsCommand ? await executeResearchRuntime(input, (event) => {
        if (!isCurrent()) return;
        const current = snapshotRef.current;
        if (event.type === "progress") {
          if (!current || event.state.version < input.expectedVersion + 1) return;
          const next = mergeResearchProgress(current, event.state);
          snapshotRef.current = next; setState(next);
        } else if (event.type === "snapshot") {
          if (event.state.sessionId !== sessionId || event.state.version < input.expectedVersion + 1) return;
          if (following === "outline" && current && event.state.version === current.version && event.state.revision < current.revision) return;
          const next = newestSnapshot(event.state, current);
          responseEpoch.current += 1;
          snapshotRef.current = next; setState(next);
          // The server identifies actual generation; ordinary chat proposals keep
          // their editor visible. Retain the draft separately for failure recovery.
          if (action === "message" && next.busy && next.reportStream?.requestId === input.requestId && next.reportStream.status === "streaming") setLoadingNode("report");
        } else if (event.type === "report_reset") {
          if (!current || event.sessionId !== sessionId || event.requestId !== input.requestId || current.version !== event.version) return;
          if (current.reportStream?.requestId === event.requestId && current.reportStream.sequence > event.sequence) return;
          // Reset only text on the latest UI snapshot; polling may already have
          // newer sources/plan/task metadata than the stream reader's baseline.
          const next = { ...current, reportStream: { requestId: event.requestId, sequence: event.sequence, text: "", status: event.status } };
          snapshotRef.current = next; setState(next);
        } else if (event.type === "report_delta") {
          if (!current || event.sessionId !== sessionId || event.requestId !== input.requestId || event.version !== input.expectedVersion + 1 || current.version !== event.version || !current.busy) return;
          const previous = current.reportStream;
          if (!previous || previous.requestId !== event.requestId || event.sequence !== previous.sequence + 1) return;
          const next = { ...current, reportStream: { ...previous, sequence: event.sequence, text: previous.text + event.delta } };
          snapshotRef.current = next; setState(next);
        }
      }, controller!.signal, recoveryState) : await executeResearchRuntime(input, undefined, undefined, recoveryState);
      if (!isCurrent()) return;
      // Confirmation and following generation share a durable server request.
      // Never dispatch a second command from a response or a recovered snapshot.
      const next = newestSnapshot(received, snapshotRef.current);
      responseEpoch.current += 1; snapshotRef.current = next;
      setState(next);
      const target = action === "save_chapters" && !next.errorCode ? next.currentNode : browsingRef.current ? nodeRef.current : next !== received || action === "prepare_plan" || action === "generate_report" || action === "confirm" || action === "complete" || action === "apply" || action === "retry" && Boolean(state.executionGoal) ? next.currentNode : requestNode;
      setNode(target); setDraft(draftOf(next, target));
      if (!browsingRef.current && !next.errorCode && requestNode === "outline" && target === "outline") setChaptersOpen(false);
      if (next.errorCode) setError(errors[next.errorCode] ?? "处理失败，已保存当前进度，请重试。");
      if (action === "message" && next.errorCode && recoveryDraft) {
        if (!browsingRef.current) { setNode(requestNode); setDraft(recoveryDraft); }
        updateRecovery({ draft: recoveryDraft, node: requestNode, synchronized: true });
      }
      if (action === "message" && !next.errorCode) setMessage("");
      return !next.errorCode;
    } catch (cause) {
      if (!isCurrent()) return;
      // Capture the submitted editor before a recovery read or polling can replace it.
      const localDraft = recoveryDraft && (action === "message" || JSON.stringify(recoveryDraft) !== JSON.stringify(draftOf(recoveryState, requestNode))) ? recoveryDraft : null;
      if (cause instanceof ResearchRuntimeHydrationError && cause.snapshot.sessionId === sessionId) {
        const acknowledged = newestSnapshot(cause.snapshot, snapshotRef.current);
        responseEpoch.current += 1; snapshotRef.current = acknowledged; setState(acknowledged);
        if (!localDraft && !browsingRef.current) setDraft(draftOf(acknowledged, requestNode));
      }
      if (!browsingRef.current) setNode(requestNode);
      updateRecovery({ draft: localDraft, node: requestNode, synchronized: false });
      if (localDraft && !browsingRef.current) setDraft(localDraft);
      setError(requestError(cause));
      setPending(false); setLoadingNode(null);
      await recoverProgress(sessionId);
    } finally { if (isCurrent()) { messageDraft.current = null; streamController.current = null; setPending(false); setLoadingNode(null); } }
  }
  async function recoverProgress(targetSession: string) {
    const generation = sessionGeneration.current;
    recoveryController.current?.abort();
    const controller = new AbortController(); recoveryController.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Research recovery read timed out")); }, RECOVERY_READ_TIMEOUT_MS);
        controller.signal.addEventListener("abort", () => reject(new Error("Research recovery read cancelled")), { once: true });
      });
      const received = await Promise.race([getResearchRuntime(targetSession, controller.signal), timeout]);
      if (controller.signal.aborted) return;
      if (received.leaseUntil !== null && !Number.isFinite(Date.parse(received.leaseUntil))) throw new Error("Invalid research execution lease");
      if (sessionRef.current !== targetSession || generation !== sessionGeneration.current) return;
      const latest = newestSnapshot(received, snapshotRef.current);
      responseEpoch.current += 1; snapshotRef.current = latest; setState(latest);
      const previous = recoveryRef.current;
      if (previous?.draft) updateRecovery({ ...previous, synchronized: true });
      else if (previous && latest.busy && (!latest.leaseUntil || Date.parse(latest.leaseUntil) > Date.now())) {
        updateRecovery({ ...previous, synchronized: true });
      } else if (previous) {
        // There is no competing local edit to resolve. Restore the saved step
        // directly without another confirmation or replaying the failed command.
        const target = browsingRef.current ? nodeRef.current : latest.currentNode;
        setNode(target); setDraft(draftOf(latest, target)); updateRecovery(null);
      }
    } catch { /* Keep the editor and the explicit recovery action until a read succeeds. */ }
    finally {
      clearTimeout(timer);
      if (recoveryController.current === controller) recoveryController.current = null;
    }
  }
  function finishRecovery(keepLocal: boolean) {
    if (!state || !recovery?.synchronized || processing) return;
    const target = keepLocal ? recovery.node : state.currentNode;
    if (!state.availableNodes.includes(target)) return;
    setNode(target); setDraft(keepLocal ? recovery.draft : draftOf(state, target));
    updateRecovery(null); setError(null);
  }
  function navigate(next: Command["node"]) { if (state) { browsingRef.current = true; setBrowsing(true); setNode(next); setDraft(draftOf(state, next)); setError(null); } }
  const validDraft = Boolean(draft && C.GuidedResearchRuntimeDraft.safeParse(draft).success);
  if (!state || state.sessionId !== sessionId) return <GuidedResearchSixStepShell current={routeStage ?? "import"} available={[]} onBack={onBack} onNavigate={() => undefined} main={<div role="status" className="p-4">{error ?? "正在恢复研究会话…"}{error && <Button variant="outline" onClick={() => { setLoadAttempt((attempt) => attempt + 1); onLoadRetry?.(); }}>重试加载</Button>}</div>} />;
  const latestRecoveryDraft = recovery?.synchronized ? draftOf(state, recovery.node) : null;
  const proposal = !state.busy && !state.errorCode && state.proposal?.version === state.version && state.proposal.draft.node === node ? state.proposal : null;
  const proposalEdited = Boolean(proposal && JSON.stringify(draft) !== JSON.stringify(proposal.draft));
  const displayReport = draft?.node === "report" ? draft.value : state.report;
  const researchPending = state.tasks.some((task) => task.status === "pending" || (task.status === "running" && !expired));
  const researchFailed = state.tasks.some((task) => task.status === "failed");
  const usableSources = state.sources.some((source) => source.decision !== "excluded");
  const researchBlocked = node === "research" && (researchPending || !state.tasks.length || !usableSources);
  const reportVisible = viewedNode === "research" || viewedNode === "report";
  const executingNode = loadingNode ?? (pending ? pendingNode : null) ?? state.currentNode;
  const waiting = Boolean(loadingNode || (!pending && state.busy && !expired)) && !recovery && !topicSaveCompletion.current && viewedNode === executingNode && !chaptersOpen;
  const readingReport = reportVisible && !waiting && node === "report" && Boolean(displayReport || state.reportDraft);
  const resumeReport = Boolean(state.errorCode || expired || state.reportDraft || state.controlStatus === "paused");
  const streamPreview = researchReportPreview(state.reportStream?.text ?? "");
  const hasRenderableReportPreview = Boolean(streamPreview.summary || streamPreview.introduction || streamPreview.conclusion || streamPreview.sections.some((section) => section.body) || state.reportCheckpoint?.chapters.some((chapter) => chapter.body));
  const showReportRecoveryActions = !waiting && !readingReport && resumeReport && !hasRenderableReportPreview;
  const reportPrimaryAction = !waiting && (node === "research"
    ? <Button variant="primary" disabled={busy} data-testid="research-report-primary-action" onClick={() => void (async () => { if (state.controlStatus === "paused" && !await steerReport("resume")) return; await run(state.executionGoal === "report" && resumeReport ? "retry" : "generate_report", { node: "research" }); })()}>{resumeReport ? "继续生成" : "生成报告"}</Button>
    : resumeReport
    ? <Button variant="primary" disabled={busy} data-testid="research-report-primary-action" onClick={() => void (async () => { if (state.controlStatus === "paused" && !await steerReport("resume")) return; await run("retry"); })()}>继续生成</Button>
    : state.report && !state.completed
      ? <Button variant="primary" disabled={busy || Boolean(proposal)} data-testid="research-report-primary-action" onClick={() => void run("complete", { draft: { node: "report", value: displayReport! } })}>完成研究</Button>
      : !state.report
        ? <Button variant="primary" disabled={busy} data-testid="research-report-primary-action" onClick={() => void run("generate_report")}>生成报告</Button>
        : <span role="status" className="self-center text-sm text-muted-foreground">研究报告</span>);
  const reportAssistantMenuAction = <DropdownMenuItem onSelect={() => setReportAssistantOpen((open) => !open)}>{reportAssistantOpen ? "收起助手" : "修改报告"}</DropdownMenuItem>;
  const reportActions = <div className="flex flex-wrap justify-end gap-3" data-testid="research-current-step-actions">{reportPrimaryAction}{showReportRecoveryActions && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="更多操作">更多操作</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{reportAssistantMenuAction}<DropdownMenuSeparator /><DropdownMenuItem disabled={busy} onSelect={() => void run("generate_report", { node: "report" })}>重新生成报告</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div>;
  const reportDocument = displayReport ? researchReportDocument(displayReport, state.sources, state.outline) : null;
  const briefDocument = draft?.node === "brief" ? serializeGuidedResearchMarkdown({ node: "brief", brief: draft.value }) : null;
  const reportMarkdownDocument = displayReport ? serializeGuidedResearchMarkdown({ node: "report", report: displayReport }) : null;
  const visualStage = toGuidedResearchVisualStage({ currentNode: viewedNode, availableNodes: state.availableNodes });
  if (processing) {
    const runningStage = toGuidedResearchVisualStage({ currentNode: executingNode, availableNodes: state.availableNodes }).current;
    if (!visualStage.available.includes(runningStage)) visualStage.available.push(runningStage);
  }
  const completedStages: GuidedResearchVisualStage[] = [];
  if (state.generatedNodes.includes("brief")) completedStages.push("import");
  if (state.availableNodes.includes("research")) completedStages.push("plan");
  if (!processing && !state.errorCode && state.completed && state.report) completedStages.push("report");
  const navigateVisual = (stage: GuidedResearchVisualStage) => {
    const next = visualDestination(stage, state.availableNodes, loadingNode);
    if ((state.availableNodes.includes(next) || next === loadingNode || stage === "chapters" && state.availableNodes.includes("research"))) {
      setChaptersOpen(false);
      navigate(next);
      window.history.pushState({}, "", guidedResearchRoute(sessionId, stage));
    }
  };
  const conversation = <GuidedResearchConversation node={node} messages={state.messages} message={message} onMessageChange={setMessage} busy={busy} processing={processing}
    onSend={(text) => { if (text.trim()) void run("message", { message: text.trim(), ...(draft ? { draft } : {}) }); }}
    proposal={proposal} proposalEdited={proposalEdited} onApply={() => void run("apply", { proposalId: proposal?.id })}
    preview={proposal ? <ProposalPreview draft={proposal.draft} /> : null} />;
  const shellAssistant = chaptersOpen ? null : conversation;
return <GuidedResearchSixStepShell researchName={guidedResearchHeading(state, researchName)} hasUnsavedChanges={Boolean(message.trim()) || chaptersDirty || markdownDirty || Boolean(draft && JSON.stringify(draft) !== JSON.stringify(draftOf(state, node)))} sessionId={sessionId} current={chaptersOpen && (browsing || !loadingNode) ? "chapters" : visualStage.current} running={processing ? toGuidedResearchVisualStage({ currentNode: executingNode, availableNodes: state.availableNodes }).current : undefined} completed={state.completed} completedStages={completedStages} available={visualStage.available} onBack={onBack} onNavigate={navigateVisual} onHistoryNavigate={restoreVisualRoute} assistant={shellAssistant} assistantOpen={reportAssistantOpen} onAssistantOpenChange={setReportAssistantOpen} main={<div className="max-w-none space-y-4" data-layout="signed-desktop" data-testid={`research-flow-${node === "research" ? "search" : node}`}>
    {reportVisible && <div className="flex flex-wrap justify-end gap-3" data-testid="research-report-execution-controls">
      {!processing && (state.reportCheckpoint || state.report || state.reportDraft) && <Button variant="outline" disabled={busy || reportControlPending} onClick={() => void (async () => { if (state.controlStatus === "paused" && !await steerReport("resume")) return; await run("generate_report", { node: "report" }); })()}>从头重新生成</Button>}
    </div>}
    <GuidedResearchStepLayout>
      <div className="space-y-5">
        {proposal && !waiting && <p role="status" className="rounded-lg border border-primary/30 bg-muted/30 px-4 py-3 text-12" data-testid="research-conversation-draft">右侧已同步对话生成的「{labels[node]}」待应用内容，尚未应用。你可以继续在左侧提出修改，核对后请先在左侧应用建议，再确认并继续。{proposalEdited && " 右侧另有手动修改，请继续对话形成新建议后应用。"}</p>}
    {recovery && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12" data-testid="research-recovery"><summary className="cursor-pointer font-medium">需要核对研究进度{recovery.draft ? " · 待应用内容已保留" : ""}</summary><div className="mt-3 space-y-3">
      <p role="status" className="text-12">{recovery.synchronized ? processing ? "服务端仍在处理，正在核对执行状态，系统不会重复提交。" : "已读取最新研究进度。请核对后继续，系统不会自动重复提交。" : "尚未确认最新研究进度，请先重新连接。"}{recovery.draft && " 你的未提交待应用内容已保留在当前页面。"}</p>
      {recovery.draft && <details className="text-12"><summary>查看保留的待应用内容</summary><ProposalPreview draft={recovery.draft} /></details>}
      {latestRecoveryDraft && <details className="text-12"><summary>查看服务端最新内容</summary><ProposalPreview draft={latestRecoveryDraft} /></details>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => void recoverProgress(sessionId)}>重新读取进度</Button>
        <Button disabled={!recovery.synchronized || processing} onClick={() => finishRecovery(false)}>使用最新进度</Button>
        {recovery.draft && <Button variant="outline" disabled={!recovery.synchronized || processing || !state.availableNodes.includes(recovery.node)} onClick={() => finishRecovery(true)}>{node === "report" ? "继续编辑保留的内容" : "继续编辑保留的草稿"}</Button>}
      </div>
    </div></details>}
    {(error || (node === state.currentNode && state.errorCode)) && <p role="alert" className="text-12 text-destructive">{error ?? errors[state.errorCode!] ?? "上次处理失败，请重试。"}</p>}
    {!readingReport && node !== "research" && state.legacyCheckpoint && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12 text-muted-foreground"><summary>历史记录已保留 · 查看迁移说明</summary><p className="mt-2">原会话状态：{state.legacyCheckpoint.status === "completed" ? "已完成" : "进行中"}。原方向与大纲已导入；旧版检索和报告没有可验证的来源记录，需要重新检索后生成报告。</p><p>原研究主题：{state.legacyCheckpoint.brief.topic}</p><ul>{state.legacyCheckpoint.directions.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.description}</li>)}</ul><ul>{state.legacyCheckpoint.outline.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.questions.join("；")}</li>)}</ul></details>}
    {expired && !recovery && !error && !state.errorCode && <p role="alert" className="text-12 text-destructive">上次执行已中断。已保存的结果仍可用，请重试。</p>}
        {reportVisible && !processing && !readingReport && <GuidedResearchEvidenceWarning state={state} />}
        {waiting && viewedNode === "research" && state.currentNode === "research" && <p role="status" data-testid="research-step-loading" aria-live="polite" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />正在获取资料</p>}
        {reportVisible && <GuidedResearchExecutionTimeline state={state} interrupted={expired} />}
        {reportVisible && !displayReport && <GuidedResearchQualityDraft state={state} actions={reportPrimaryAction} moreActions={reportAssistantMenuAction} onRegenerate={() => void run("generate_report", { node: "report" })} />}
        {reportVisible && !state.report && !state.reportDraft && (state.reportStream || (!state.report && state.reportCheckpoint)) && <GuidedResearchReportPreview state={state} interrupted={expired || state.controlStatus === "paused"} moreActions={showReportRecoveryActions ? undefined : reportAssistantMenuAction} onRegenerate={() => void run("generate_report", { node: "report" })} />}

        {waiting && viewedNode !== "research" ? (reportVisible && (state.reportTimeline?.length || state.reportStream || (!state.report && state.reportCheckpoint)) ? null : <ResearchLoading node={viewedNode} />) : <>
        {pending && chaptersOpen && <p role="status">正在准备报告章节…</p>}
        {viewedNode === "brief" && briefDocument && <GuidedResearchEntryPanel disabled={busy || Boolean(proposal) || !validDraft} onContinue={() => void run("prepare_plan", { ...(draft ? { draft } : {}) })} brief={<><Textarea aria-label="研究需求" placeholder="请描述你的研究需求：研究目标、研究区域、时间范围、重点关注和关键问题。" className="min-h-48 resize-y p-3 text-sm leading-relaxed" maxLength={C.GuidedResearchBrief.shape.goal.maxLength!} disabled={busy} value={draft?.node === "brief" ? draft.value.goal : ""} onChange={(event) => { if (draft?.node === "brief") setDraft({ ...draft, value: { ...draft.value, goal: event.target.value } }); }} /><p className="text-right text-xs text-muted-foreground">{draft?.node === "brief" ? draft.value.goal.length : 0} / {C.GuidedResearchBrief.shape.goal.maxLength!}</p></>} />}
        {viewedNode === "brief" && draft?.node === "brief" && <Card className="sr-only" aria-hidden="true"><CardContent>{(["topic", "goal", "timeRange", "region", "focus"] as const).map((field) => <label key={field}>{field}<Textarea disabled tabIndex={-1} value={draft.value[field]} onChange={(event) => setDraft({ ...draft, value: { ...draft.value, [field]: event.target.value } })} /></label>)}</CardContent></Card>}
        {viewedNode === "directions" && <section className="space-y-4" data-testid="research-plan-recovery"><h2 className="text-lg font-bold">研究计划</h2><p>已保留研究主题与方向。生成计划后可查看和修改。</p><p className="font-medium">{state.brief.topic}</p><p>{state.brief.goal}</p><Button variant="primary" disabled={busy || Boolean(proposal)} onClick={() => void run("prepare_plan", { node: "directions", ...(draft?.node === "directions" ? { draft } : {}) })}>生成研究计划</Button></section>}
        {viewedNode === "outline" && draft?.node === "outline" && <GuidedResearchPlanPanel onBack={() => navigateVisual("import")} disabled={busy || Boolean(proposal) || !validDraft || markdownDirty} onConfirm={() => void run("generate_report", { draft })}
          plan={<GuidedResearchPlanEditor value={draft.value} disabled={busy || Boolean(proposal)} onDirtyChange={setMarkdownDirty} onSave={async (value) => Boolean(await run("save", { draft: { node: "outline", value } }))} />}
        />}
        {reportVisible && state.sources.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">查看研究资料 · {state.sources.filter(source => source.decision !== "excluded").length} 个来源</summary><div className="mt-3"><GuidedResearchSourceWorkspace state={draft?.node === "research" ? { ...state, sources: state.sources.map(source => ({ ...source, decision: draft.value.find(entry => entry.id === source.id)?.decision ?? source.decision })) } : state} actions={null} /></div></details>}
        {viewedNode === "research" && !waiting && researchFailed && <details data-testid="research-failed-tasks" className="text-sm"><summary className="cursor-pointer text-muted-foreground">查看未完成检索 · {state.tasks.filter((task) => task.status === "failed").length} 项</summary><ul className="mt-2 space-y-2">{state.tasks.filter((task) => task.status === "failed").map((task) => <li key={task.id}><span className="font-medium">{task.title || task.query}</span><p className="text-muted-foreground">{task.errorCode === "RESEARCH_SEARCH_TIME_BUDGET_EXCEEDED" ? "上次检索已中断，尚未完成。" : errors[task.errorCode ?? ""] ?? "检索未完成，请重试或调整研究计划。"}</p></li>)}</ul></details>}
        {reportVisible && !processing && state.availableNodes.includes("research") && <details open={chapterDetailsOpen} onToggle={(event) => { const open = event.currentTarget.open; setChapterDetailsOpen(open); if (open) setChapterDetailsMounted(true); }}><summary className="cursor-pointer text-sm font-medium">调整报告章节</summary>{chapterDetailsMounted && <ResearchChaptersWorkspace onDirtyChange={setChaptersDirty} runtime={state} disabled={busy} onSave={(value) => void run("save_chapters", { node: "outline", draft: { node: "outline", value } })} onOptimize={(value) => void run("message", { node: "outline", draft: { node: "outline", value }, message: "基于当前章节和已有研究证据优化章节结构、目标与小节，保留来源和证据局限。" })} />}</details>}
        {node === "report" && !chaptersOpen && !waiting && reportDocument && <GuidedResearchReportWorkspace
          actions={null}
          contents={<nav aria-label="报告工作区目录" className="space-y-1 text-sm text-muted-foreground"><a className="block rounded bg-muted p-2" href="#research-report-summary">执行摘要</a>{reportDocument.introduction && <a className="block p-2" href="#research-report-introduction">研究范围与方法</a>}{reportDocument.sections.map((section, index) => <div key={section.sectionId}><a className="block p-2 font-medium" href={`#research-report-section-${index}`}>{index + 1}. {section.title}</a>{reportSectionHeadings(chapterBody(section.body, section.title)).map((heading) => <a key={`${section.sectionId}-${heading.index}`} className="block py-1 pl-6 pr-2 text-xs" href={`#research-report-section-${index}-subsection-${heading.index}`}>{heading.title}</a>)}</div>)}{reportDocument.conclusion && <a className="block p-2" href="#research-report-conclusion">综合结论</a>}<a className="block border-t p-2" href="#research-report-references">参考来源</a></nav>}
          document={<div data-testid="research-report" data-layout="full-width-report"><ResearchPrototypeReport document={reportDocument} sources={state.sources.filter((source) => source.decision !== "excluded").length} actions={reportPrimaryAction} moreActions={reportAssistantMenuAction} onRegenerate={() => void run("generate_report", { node: "report" })} disabled={busy || Boolean(proposal)} />{reportMarkdownDocument && <details className="mt-5" open={reportMarkdownOpen} onToggle={(event) => setReportMarkdownOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">编辑报告 Markdown</summary>{reportMarkdownOpen && <div className="mt-3"><GuidedResearchMarkdownWorkspace onDirtyChange={setMarkdownDirty} document={reportMarkdownDocument} saving={busy} onSave={async (markdown) => {
            const parsed = parseGuidedResearchMarkdown({ document: reportMarkdownDocument, markdown });
            if (!parsed.ok) return { ok: false, message: parsed.errors.map((item) => item.message).join("；") };
            const saved = await run("save", { draft: parsed.draft });
            return saved ? { ok: true } : { ok: false, message: "研究报告未保存，请根据页面提示重试。" };
          }} provenance="报告 Markdown 可编辑；来源引用标识必须保持不变。" /></div>}</details>}</div>}
          metrics={null}
          limitation={null}
        />}
        {researchBlocked && !waiting && <p role="status" className="text-12 text-muted-foreground">{researchPending ? "检索仍在进行，任务结束后可生成报告。" : "请完成检索并保留至少一个真实来源后生成报告。"}</p>}

        </>}
        {reportVisible && !readingReport && !waiting && (!state.reportDraft || node === "research") && reportActions}
        {!reportVisible && node !== "research" && !chaptersOpen && !waiting && !recovery && (state.errorCode || expired) && <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={() => void run("retry")}>继续重试</Button></div>}
      </div>
    </GuidedResearchStepLayout>
  </div>} />;
}
