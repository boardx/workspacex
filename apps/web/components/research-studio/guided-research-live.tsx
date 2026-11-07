"use client";
import { isUnstartedResearch } from "@/lib/guided-research-bootstrap";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { ResearchReportFileActions } from "@/components/report-files/research-report-file-actions";
import { guidedResearchHeading } from "@/lib/guided-research-heading";
import { ResearchRuntimeHydrationError } from "@/lib/guided-research-hydration";
import { GuidedResearchExecutionTimeline } from "./guided-research-execution-timeline";
import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { readResearchMemory, writeResearchMemory, getResearchMemoryScope, readResearchOnce, forgetResearchMemory } from "@/lib/guided-research-memory";
import { research as C } from "@repo/contracts";
import { Loader2 } from "lucide-react";
import { WorkflowActionButton as Button, WorkflowActionBar } from "./research-workflow-actions";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GuidedResearchConversation } from "./guided-research-conversation";
import { ResearchLoading, researchSteps as steps } from "./guided-research-presentation";
import { researchReportDocument } from "@/lib/research-report-document";
import { ResearchPrototypeReport } from "./research-prototype-report";
import { GuidedResearchEvidenceWarning, GuidedResearchReportHistory } from "./guided-research-report-history";
import { GuidedResearchQualityDraft } from "./guided-research-quality-draft";
import { GuidedResearchReportPreview } from "./guided-research-report-preview";
import { researchReportPreview } from "@/lib/research-report-preview";
import { ResearchDesignPreview } from "./guided-research-design-editor";

import { GuidedResearchStepLayout } from "./guided-research-step-layout";
import { GuidedResearchMarkdownWorkspace } from "./guided-research-markdown-workspace";
import { GuidedResearchSixStepShell } from "./guided-research-six-step-shell";
import { withProjectId } from "@/components/project/project-links";
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
  const { t } = useI18n();
  if (draft.node === "brief") return <div className="space-y-2"><p>{draft.value.topic}</p><p>{draft.value.goal}</p><p>{[draft.value.timeRange, draft.value.region, draft.value.focus].filter(Boolean).join(" · ")}</p></div>;
  if (draft.node === "directions" || draft.node === "outline") return <ResearchDesignPreview draft={draft} />;
  if (draft.node === "report") return <p className="whitespace-pre-wrap">{draft.value.summary}</p>;
  return <p>{t("research.live.sourceProposal", { accepted: draft.value.filter((item) => item.decision === "accepted").length, excluded: draft.value.filter((item) => item.decision === "excluded").length })}</p>;
}
const errors: Record<string, MessageKey> = {
  RESEARCH_REPORT_PREPARATION_TIME_BUDGET_EXCEEDED: "research.error.RESEARCH_REPORT_PREPARATION_TIME_BUDGET_EXCEEDED",
  RESEARCH_REPORT_MODEL_TIME_BUDGET_EXCEEDED: "research.error.RESEARCH_REPORT_MODEL_TIME_BUDGET_EXCEEDED",
  RESEARCH_EVIDENCE_BUDGET_EXCEEDED: "research.error.RESEARCH_EVIDENCE_BUDGET_EXCEEDED",
  RESEARCH_REPORT_QUALITY_INSUFFICIENT: "research.error.RESEARCH_REPORT_QUALITY_INSUFFICIENT",
  RESEARCH_GRAPH_VERSION_CONFLICT: "research.error.RESEARCH_GRAPH_VERSION_CONFLICT",
  RESEARCH_REVISION_CONFLICT: "research.error.RESEARCH_REVISION_CONFLICT",
  RESEARCH_SOURCE_ACCESS_DENIED: "research.error.RESEARCH_SOURCE_ACCESS_DENIED",
  RESEARCH_WORKFLOW_PAUSED: "research.error.RESEARCH_WORKFLOW_PAUSED",
  RESEARCH_PLAN_TIME_BUDGET_EXCEEDED: "research.error.RESEARCH_PLAN_TIME_BUDGET_EXCEEDED",
  RESEARCH_WORKFLOW_UNAVAILABLE: "research.error.RESEARCH_WORKFLOW_UNAVAILABLE",
  RESEARCH_NODE_MISMATCH: "research.error.RESEARCH_NODE_MISMATCH",
  RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH: "research.error.RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH",
  RESEARCH_WORKFLOW_BUSY: "research.error.RESEARCH_WORKFLOW_BUSY",
  RESEARCH_SEARCH_NOT_CONFIGURED: "research.error.RESEARCH_SEARCH_NOT_CONFIGURED",
  RESEARCH_SEARCH_NO_RELEVANT_SOURCES: "research.error.RESEARCH_SEARCH_NO_RELEVANT_SOURCES",
  RESEARCH_SOURCE_RELEVANCE_INVALID: "research.error.RESEARCH_SOURCE_RELEVANCE_INVALID",
  RESEARCH_SEARCH_EMPTY: "research.error.RESEARCH_SEARCH_EMPTY",
  RESEARCH_SEARCH_REQUEST_TIMEOUT: "research.error.RESEARCH_SEARCH_REQUEST_TIMEOUT",
  RESEARCH_DOCUMENT_TIMEOUT: "research.error.RESEARCH_DOCUMENT_TIMEOUT",
  RESEARCH_SOURCE_MODEL_TIMEOUT: "research.error.RESEARCH_SOURCE_MODEL_TIMEOUT",
  RESEARCH_SEARCH_UNAVAILABLE: "research.error.RESEARCH_SEARCH_UNAVAILABLE",
  RESEARCH_SEARCH_CONTENT_EMPTY: "research.error.RESEARCH_SEARCH_CONTENT_EMPTY",
  RESEARCH_EXECUTION_INTERRUPTED: "research.error.RESEARCH_EXECUTION_INTERRUPTED",
  RESEARCH_SEARCH_TIME_BUDGET_EXCEEDED: "research.error.RESEARCH_SEARCH_TIME_BUDGET_EXCEEDED",
  RESEARCH_SEARCH_PARTIAL_FAILURE: "research.error.RESEARCH_SEARCH_PARTIAL_FAILURE",
  RESEARCH_SOURCES_REQUIRED: "research.error.RESEARCH_SOURCES_REQUIRED",
  RESEARCH_SOURCE_URL_INVALID: "research.error.RESEARCH_SOURCE_URL_INVALID",
  RESEARCH_SOURCE_NOT_FOUND: "research.error.RESEARCH_SOURCE_NOT_FOUND",
  RESEARCH_TASKS_INCOMPLETE: "research.error.RESEARCH_TASKS_INCOMPLETE",
  RESEARCH_CONTENT_REFERENCE_INVALID: "research.error.RESEARCH_CONTENT_REFERENCE_INVALID",
  RESEARCH_NODE_STATE_INVALID: "research.error.RESEARCH_NODE_STATE_INVALID",
  RESEARCH_MODEL_GENERATION_REQUIRED: "research.error.RESEARCH_MODEL_GENERATION_REQUIRED",
};
function requestError(error: unknown): MessageKey {
  if (error instanceof ResearchRuntimeHydrationError) return "research.error.hydration";
  if (error instanceof ApiError) {
    if (error.status === 401) return "research.error.auth";
    if (error.status === 403) return "research.error.forbidden";
    if (error.status === 404) return "research.error.notFound";
    if (error.reasonCode && errors[error.reasonCode]) return errors[error.reasonCode]!;
    if (error.status === 409) return "research.error.conflict";
  }
  return "research.error.network";
}
const RECOVERY_READ_TIMEOUT_MS = 10_000;
type Recovery = { draft: Draft | null; node: Command["node"]; synchronized: boolean };
export function GuidedResearchLive(props: { sessionId: string; researchName?: string; onBack: () => void; onLoadRetry?: () => void; initialNode?: Command["node"]; visualStage?: GuidedResearchVisualStage }) {
  // A new credential or research gets a fresh component before it can render old data.
  return <GuidedResearchLiveSession key={JSON.stringify([getResearchMemoryScope(), props.sessionId])} {...props} />;
}
function GuidedResearchLiveSession({ sessionId, researchName, onBack, onLoadRetry, initialNode, visualStage: routeStage }: { sessionId: string; researchName?: string; onBack: () => void; onLoadRetry?: () => void; initialNode?: Command["node"]; visualStage?: GuidedResearchVisualStage }) {
  const { t } = useI18n();
  const cacheScope = getResearchMemoryScope();
  const [chaptersOpen, setChaptersOpen] = React.useState(false);
  const [chapterDetailsOpen, setChapterDetailsOpen] = React.useState(routeStage === "chapters");
  const [chapterDetailsMounted, setChapterDetailsMounted] = React.useState(routeStage === "chapters");
  const cachedRuntime = readResearchMemory(sessionId, cacheScope)?.runtime;
  const initialTarget = cachedRuntime ? initialNode && cachedRuntime.availableNodes.includes(initialNode) ? initialNode : cachedRuntime.currentNode : "brief";
  const [state, setState] = React.useState<Runtime | null>(() => cachedRuntime ?? null);
  const [node, setNode] = React.useState<Command["node"]>(initialTarget);
  const [draft, setDraft] = React.useState<Draft | null>(() => cachedRuntime ? readResearchMemory(sessionId, cacheScope)?.drafts?.[initialTarget] ?? draftOf(cachedRuntime, initialTarget) : null);
  const draftRef = React.useRef(draft); draftRef.current = draft;
  const dirtyEditor = React.useRef(false);
  const [message, setMessage] = React.useState("");
  const [reportAssistantOpen, setReportAssistantOpen] = React.useState(false);
  const [reportMarkdownOpen, setReportMarkdownOpen] = React.useState(false);
  const [chaptersDirty, setChaptersDirty] = React.useState(false);
  const [markdownDirty, setMarkdownDirty] = React.useState(false);
  const [loadingNode, setLoadingNode] = React.useState<Command["node"] | null>(null);
  const loadingNodeRef = React.useRef(loadingNode); loadingNodeRef.current = loadingNode;
  const [browsing, setBrowsing] = React.useState(false);
  const browsingRef = React.useRef(false);
  const viewedNode = browsing ? node : loadingNode ?? node;
  const [pending, setPending] = React.useState(false);
  const [pendingNode, setPendingNode] = React.useState<Command["node"] | null>(null);
  const [error, setError] = React.useState<MessageKey | null>(null);
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const routeValidationKey = JSON.stringify([initialNode, routeStage]);
  const [validatedRoute, setValidatedRoute] = React.useState<string | null>(null);
  const [validationRevision, revalidate] = React.useReducer((value: number) => value + 1, 0);
  const preferredNode = React.useRef(initialNode);
  const routeInput = React.useRef({ initialNode, routeStage });
  if (routeInput.current.initialNode !== initialNode || routeInput.current.routeStage !== routeStage) {
    preferredNode.current = initialNode; routeInput.current = { initialNode, routeStage };
  }
  const [recovery, setRecovery] = React.useState<Recovery | null>(null);
  const recoveryRef = React.useRef<Recovery | null>(null);
  function updateRecovery(value: Recovery | null) { recoveryRef.current = value; setRecovery(value); }
  const snapshotRef = React.useRef<Runtime | null>(cachedRuntime ?? null);
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
    const path = withProjectId(guidedResearchRoute(sessionId, stage), new URLSearchParams(window.location.search).get("projectId"));
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.replaceState({}, "", path);
  }, [viewedNode, loadingNode, browsing, chaptersOpen, sessionId, state]);
  const restoreVisualRoute = (stage: GuidedResearchVisualStage) => {
    const snapshot = snapshotRef.current;
    const target = visualDestination(stage, snapshot?.availableNodes ?? [], loadingNode);
    if (!snapshot || !(snapshot.availableNodes.includes(target) || target === loadingNode || stage === "chapters" && snapshot.availableNodes.includes("research"))) return;
    browsingRef.current = true; setBrowsing(true);
    setChaptersOpen(false);
    rememberDraft(); preferredNode.current = target; revalidate(); setNode(target); setDraft(readResearchMemory(sessionId, cacheScope)?.drafts?.[target] ?? draftOf(snapshot, target)); setError(null);
  };
  dirtyEditor.current = chaptersDirty || markdownDirty;
  const rememberDraft = React.useCallback(() => {
    const snapshot = snapshotRef.current;
    const value = draftRef.current;
    if (!snapshot || !value) return;
    const memory = readResearchMemory(sessionId, cacheScope);
    const drafts = { ...memory?.drafts };
    if (JSON.stringify(value) !== JSON.stringify(draftOf(snapshot, value.node))) drafts[value.node] = value;
    else delete drafts[value.node];
    writeResearchMemory(sessionId, { drafts }, cacheScope);
  }, [sessionId, cacheScope]);
  React.useEffect(() => { rememberDraft(); }, [draft, rememberDraft]);
  React.useEffect(() => {
    let active = true;
    setValidatedRoute(null);
    const epoch = responseEpoch.current;
    const baseline = snapshotRef.current;
    const cached = loadAttempt === 0 ? baseline ?? readResearchMemory(sessionId, cacheScope)?.runtime : undefined;
    const targetOf = (next: Runtime) => {
      const requested = preferredNode.current;
      const startingPlan = (requested === "directions" || requested === "outline") && isUnstartedResearch(next) && !next.legacyCheckpoint && !next.errorCode;
      const executing = !baseline && next.busy && (!next.leaseUntil || Date.parse(next.leaseUntil) > Date.now());
      return executing ? next.currentNode : startingPlan ? "outline" : requested && (next.availableNodes.includes(requested) || requested === loadingNodeRef.current) ? requested : next.currentNode;
    };
    if (cached) {
      rememberDraft();
      const target = targetOf(cached);
      nodeRef.current = target; setNode(target);
      setDraft(readResearchMemory(sessionId, cacheScope)?.drafts?.[target] ?? draftOf(cached, target));
    }
    const read = () => cached
      ? getResearchRuntimeProgress(sessionId, cached.reportStream, undefined, cached).then((update) => mergeResearchProgress(cached, update))
      : getResearchRuntime(sessionId);
    // Include the baseline in the key: a patch is meaningful only for that snapshot.
    void readResearchOnce(sessionId, "runtime", cacheScope, read, cached).then((received) => {
      if (!active || epoch !== responseEpoch.current || getResearchMemoryScope() !== cacheScope) return;
      setValidatedRoute(routeValidationKey);
      const current = snapshotRef.current;
      const next = newestSnapshot(received, current);
      const target = targetOf(next);
      const local = draftRef.current;
      const dirty = dirtyEditor.current || Boolean(local && current && JSON.stringify(local) !== JSON.stringify(draftOf(current, local.node)));
      snapshotRef.current = next; setState(next);
      writeResearchMemory(sessionId, { runtime: next }, cacheScope);
      if (!baseline) { nodeRef.current = target; setNode(target); }
      if (!dirty) setDraft(readResearchMemory(sessionId, cacheScope)?.drafts?.[nodeRef.current] ?? draftOf(next, nodeRef.current));
      setError(null);
    }).catch((cause: unknown) => {
      if (!active || epoch !== responseEpoch.current || getResearchMemoryScope() !== cacheScope) return;
      if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) {
        responseEpoch.current += 1; sessionGeneration.current += 1;
        streamController.current?.abort(); recoveryController.current?.abort();
        forgetResearchMemory(sessionId, cacheScope);
        snapshotRef.current = null; setState(null); setDraft(null); setPending(false); setLoadingNode(null); updateRecovery(null);
      }
      setError(requestError(cause));
    });
    return () => { active = false; };
  }, [sessionId, initialNode, routeStage, loadAttempt, cacheScope, validationRevision, rememberDraft, routeValidationKey]);
  React.useEffect(() => () => {
    sessionGeneration.current += 1;
    streamController.current?.abort(); recoveryController.current?.abort();
  }, []);
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
        const localDraft = draftRef.current;
        const retainEdit = dirtyEditor.current || Boolean(localDraft && current && JSON.stringify(localDraft) !== JSON.stringify(draftOf(current, localDraft.node)));
        pollAccepted.current = ticket; snapshotRef.current = next;
        sourceCursor.current = incomingSourceCursor;
        setState(next);
        if (!next.busy && recoveryRef.current) {
          recoveryController.current?.abort();
          const retained = recoveryRef.current;
          updateRecovery(retained.draft ? { ...retained, synchronized: true } : null);
          setPending(false); setLoadingNode(null);
          if (next.errorCode) setError(errors[next.errorCode] ?? "research.error.processing");
        }
        if (!next.busy && pending) {
          // Durable terminal state wins even when the POST connection never closes.
          if (topicSaveCompletion.current) { topicSaveCompletion.current(next); topicSaveCompletion.current = null; }
          else sessionGeneration.current += 1;
          streamController.current?.abort(); streamController.current = null;
          setPending(false); setLoadingNode(null);
          if (next.errorCode) {
            setError(errors[next.errorCode] ?? "research.error.processing");
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
          if (!retainEdit) setDraft(draftOf(next, target));
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
    if (validatedRoute !== routeValidationKey || !state || bootstrapStarted.current || !["directions", "outline"].includes(initialNode ?? "") || !isUnstartedResearch(state) || state.currentNode !== "brief" || state.busy || state.errorCode || state.legacyCheckpoint) return;
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
      if (next.errorCode) setError(errors[next.errorCode] ?? "research.error.processing");
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
  function navigate(next: Command["node"]) { if (state) {
    // The shell asks for confirmation before abandoning an edited step.
    // An explicit discard must not resurrect that draft on the way back.
    const memory = readResearchMemory(sessionId, cacheScope);
    const drafts = { ...memory?.drafts }; delete drafts[node];
    writeResearchMemory(sessionId, { drafts }, cacheScope);
    browsingRef.current = true; setBrowsing(true); preferredNode.current = next; revalidate(); setNode(next); setDraft(readResearchMemory(sessionId, cacheScope)?.drafts?.[next] ?? draftOf(state, next)); setError(null); } }
  const validDraft = Boolean(draft && C.GuidedResearchRuntimeDraft.safeParse(draft).success);
  if (!state || state.sessionId !== sessionId) return <GuidedResearchSixStepShell current={routeStage ?? "import"} available={[]} onBack={onBack} onNavigate={() => undefined} main={<div role="status" className="p-4">{t(error ?? "research.session.restoring")}{error && <Button variant="outline" onClick={() => { setLoadAttempt((attempt) => attempt + 1); onLoadRetry?.(); }}>{t("research.session.retryLoad")}</Button>}</div>} />;
  const latestRecoveryDraft = recovery?.synchronized ? draftOf(state, recovery.node) : null;
  const proposal = !state.busy && !state.errorCode && state.proposal?.version === state.version && state.proposal.draft.node === node ? state.proposal : null;
  const proposalEdited = Boolean(proposal && JSON.stringify(draft) !== JSON.stringify(proposal.draft));
  const displayReport = draft?.node === "report" ? draft.value : state.report;
  const researchPending = state.tasks.some((task) => task.status === "pending" || (task.status === "running" && !expired));
  const researchRunning = researchPending && state.busy && !expired && !state.errorCode && state.controlStatus !== "paused";
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
    ? <Button variant="primary" loading={busy} disabled={busy} data-testid="research-report-primary-action" onClick={() => void (async () => { if (state.controlStatus === "paused" && !await steerReport("resume")) return; await run(state.executionGoal === "report" && resumeReport ? "retry" : "generate_report", { node: "research" }); })()}>{resumeReport ? t("research.live.continue") : t("research.live.generate")}</Button>
    : resumeReport
    ? <Button variant="primary" loading={busy} disabled={busy} data-testid="research-report-primary-action" onClick={() => void (async () => { if (state.controlStatus === "paused" && !await steerReport("resume")) return; await run("retry"); })()}>{t("research.live.continue")}</Button>
    : state.report && !state.completed
      ? <Button variant="primary" loading={busy} disabled={busy || Boolean(proposal)} data-testid="research-report-primary-action" onClick={() => void run("complete", { draft: { node: "report", value: displayReport! } })}>{t("research.live.complete")}</Button>
      : !state.report
        ? <Button variant="primary" loading={busy} disabled={busy} data-testid="research-report-primary-action" onClick={() => void run("generate_report")}>{t("research.live.generate")}</Button>
        : <span role="status" className="self-center text-sm text-muted-foreground">{t("research.node.report")}</span>);
  const reportRestartAction = reportVisible && !processing && (state.reportCheckpoint || state.report || state.reportDraft) && <Button variant="outline" disabled={busy || reportControlPending} onClick={() => void (async () => { if (state.controlStatus === "paused" && !await steerReport("resume")) return; await run("generate_report", { node: "report" }); })()}>{t("research.live.restart")}</Button>;
  const reportCommandActions = <>{reportRestartAction}{reportPrimaryAction}</>;
  const reportAssistantMenuAction = <DropdownMenuItem onSelect={() => setReportAssistantOpen((open) => !open)}>{reportAssistantOpen ? t("research.live.hideAssistant") : t("research.live.editReport")}</DropdownMenuItem>;
  const reportActions = <WorkflowActionBar placement="footer" data-testid="research-current-step-actions">{showReportRecoveryActions && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label={t("research.report.more")}>{t("research.report.more")}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{reportAssistantMenuAction}<DropdownMenuSeparator /><DropdownMenuItem disabled={busy} onSelect={() => void run("generate_report", { node: "report" })}>{t("research.report.regenerate")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}{reportCommandActions}</WorkflowActionBar>;
  const reportDocument = displayReport ? researchReportDocument(displayReport, state.sources, state.outline) : null;
  const reportHeadings = reportDocument?.headings ?? C.guidedResearchReportFraming(state.brief).headings;
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
      window.history.pushState({}, "", withProjectId(guidedResearchRoute(sessionId, stage), new URLSearchParams(window.location.search).get("projectId")));
    }
  };
  const conversation = <GuidedResearchConversation embedded node={node} messages={state.messages} message={message} onMessageChange={setMessage} busy={busy} processing={processing}
    onSend={(text) => { if (text.trim()) void run("message", { message: text.trim(), ...(draft ? { draft } : {}) }); }}
    proposal={proposal} proposalEdited={proposalEdited} onApply={() => void run("apply", { proposalId: proposal?.id })}
    preview={proposal ? <ProposalPreview draft={proposal.draft} /> : null} />;
  const shellAssistant = chaptersOpen ? null : conversation;
return <GuidedResearchSixStepShell researchName={guidedResearchHeading(state, researchName)} hasUnsavedChanges={Boolean(message.trim()) || chaptersDirty || markdownDirty || Boolean(draft && JSON.stringify(draft) !== JSON.stringify(draftOf(state, node)))} sessionId={sessionId} current={chaptersOpen && (browsing || !loadingNode) ? "chapters" : visualStage.current} running={processing ? toGuidedResearchVisualStage({ currentNode: executingNode, availableNodes: state.availableNodes }).current : undefined} completed={state.completed} completedStages={completedStages} available={visualStage.available} onBack={onBack} onNavigate={navigateVisual} onHistoryNavigate={restoreVisualRoute} assistant={shellAssistant} assistantOpen={reportAssistantOpen} onAssistantOpenChange={setReportAssistantOpen} main={<div className="max-w-none space-y-4" data-layout="signed-desktop" data-testid={`research-flow-${node === "research" ? "search" : node}`}>
    <GuidedResearchStepLayout>
      <div className="space-y-5">
        {proposal && !waiting && <p role="status" className="rounded-lg border border-primary/30 bg-muted/30 px-4 py-3 text-12" data-testid="research-conversation-draft">{t("research.live.proposal", { label: t(`research.node.${node}`) })}{proposalEdited && t("research.live.proposalEdited")}</p>}
    {recovery && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12" data-testid="research-recovery"><summary className="cursor-pointer font-medium">{t("research.recovery.heading")}{recovery.draft ? t("research.recovery.draftLabel") : ""}</summary><div className="mt-3 space-y-3">
      <p role="status" className="text-12">{recovery.synchronized ? processing ? t("research.recovery.processing") : t("research.recovery.loaded") : t("research.recovery.unsynchronized")}{recovery.draft && t("research.recovery.draftPreserved")}</p>
      {recovery.draft && <details className="text-12"><summary>{t("research.recovery.viewDraft")}</summary><ProposalPreview draft={recovery.draft} /></details>}
      {latestRecoveryDraft && <details className="text-12"><summary>{t("research.recovery.viewServer")}</summary><ProposalPreview draft={latestRecoveryDraft} /></details>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => void recoverProgress(sessionId)}>{t("research.recovery.reload")}</Button>
        <Button disabled={!recovery.synchronized || processing} onClick={() => finishRecovery(false)}>{t("research.recovery.useLatest")}</Button>
        {recovery.draft && <Button variant="outline" disabled={!recovery.synchronized || processing || !state.availableNodes.includes(recovery.node)} onClick={() => finishRecovery(true)}>{node === "report" ? t("research.recovery.editContent") : t("research.recovery.editDraft")}</Button>}
      </div>
    </div></details>}
    {(error || (node === state.currentNode && state.errorCode)) && <p role="alert" className="text-12 text-destructive">{state.sourcePolicy?.mode === "materials" && state.errorCode === "RESEARCH_SOURCES_REQUIRED" ? "本次材料不足以支持研究结论。当前已保留材料范围，未联网补充；请补充可核验材料后继续。" : t(error ?? errors[state.errorCode!] ?? "research.error.previous")}</p>}
    {!readingReport && node !== "research" && state.legacyCheckpoint && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12 text-muted-foreground"><summary>{t("research.legacy.heading")}</summary><p className="mt-2">{t("research.legacy.status", { status: t(state.legacyCheckpoint.status === "completed" ? "ui.completed" : "ui.inProgress") })}</p><p>{t("research.legacy.topic", { topic: state.legacyCheckpoint.brief.topic })}</p><ul>{state.legacyCheckpoint.directions.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.description}</li>)}</ul><ul>{state.legacyCheckpoint.outline.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.questions.join("；")}</li>)}</ul></details>}
    {expired && !recovery && !error && !state.errorCode && <p role="alert" className="text-12 text-destructive">{t("research.live.interrupted")}</p>}
        {reportVisible && !processing && !readingReport && <GuidedResearchEvidenceWarning state={state} />}
        {waiting && viewedNode === "research" && state.currentNode === "research" && <p role="status" data-testid="research-step-loading" aria-live="polite" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />{t("research.loading.research.title")}</p>}
        {reportVisible && <GuidedResearchExecutionTimeline state={state} interrupted={expired} />}
        {reportVisible && !displayReport && <GuidedResearchQualityDraft state={state} actions={reportCommandActions} moreActions={reportAssistantMenuAction} onRegenerate={() => void run("generate_report", { node: "report" })} />}
        {reportVisible && !state.report && !state.reportDraft && (state.reportStream || (!state.report && state.reportCheckpoint)) && <GuidedResearchReportPreview state={state} interrupted={expired || state.controlStatus === "paused"} moreActions={showReportRecoveryActions ? undefined : reportAssistantMenuAction} onRegenerate={() => void run("generate_report", { node: "report" })} />}

        {waiting && viewedNode !== "research" ? (reportVisible && (state.reportTimeline?.length || state.reportStream || (!state.report && state.reportCheckpoint)) ? null : <ResearchLoading node={viewedNode} />) : <>
        {pending && chaptersOpen && <p role="status">{t("research.live.preparingChapters")}</p>}
        {viewedNode === "brief" && briefDocument && <GuidedResearchEntryPanel loading={busy} disabled={busy || Boolean(proposal) || !validDraft} onContinue={() => void run("prepare_plan", { ...(draft ? { draft } : {}) })} brief={<><Textarea aria-label={t("research.live.requirements")} placeholder={t("research.live.requirementsPlaceholder")} className="min-h-48 resize-y p-3 text-sm leading-relaxed" maxLength={C.GuidedResearchBrief.shape.goal.maxLength!} disabled={busy} value={draft?.node === "brief" ? draft.value.goal : ""} onChange={(event) => { if (draft?.node === "brief") setDraft({ ...draft, value: { ...draft.value, goal: event.target.value } }); }} /><p className="text-right text-xs text-muted-foreground">{draft?.node === "brief" ? draft.value.goal.length : 0} / {C.GuidedResearchBrief.shape.goal.maxLength!}</p></>} />}
        {viewedNode === "brief" && draft?.node === "brief" && <Card className="sr-only" aria-hidden="true"><CardContent>{(["topic", "goal", "timeRange", "region", "focus"] as const).map((field) => <label key={field}>{field}<Textarea disabled tabIndex={-1} value={draft.value[field]} onChange={(event) => setDraft({ ...draft, value: { ...draft.value, [field]: event.target.value } })} /></label>)}</CardContent></Card>}
        {viewedNode === "directions" && <section className="space-y-4" data-testid="research-plan-recovery"><h2 className="text-lg font-bold">{t("research.stage.plan")}</h2><p>{t("research.live.planPreserved")}</p><p className="font-medium">{state.brief.topic}</p><p>{state.brief.goal}</p><Button variant="primary" loading={busy} disabled={busy || Boolean(proposal)} onClick={() => void run("prepare_plan", { node: "directions", ...(draft?.node === "directions" ? { draft } : {}) })}>{t("research.live.generatePlan")}</Button></section>}
        {viewedNode === "outline" && draft?.node === "outline" && <GuidedResearchPlanPanel loading={busy && loadingNode === "research"} onBack={() => navigateVisual("import")} disabled={busy || Boolean(proposal) || !validDraft || markdownDirty} onConfirm={() => void run("generate_report", { draft })}
          plan={<GuidedResearchPlanEditor value={draft.value} persistedValue={state.outline} onCancel={() => setDraft({ node: "outline", value: state.outline })} disabled={busy || Boolean(proposal)} onDirtyChange={setMarkdownDirty} onSave={async (value) => Boolean(await run("save", { draft: { node: "outline", value } }))} />}
        />}
        {reportVisible && !displayReport && state.sources.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">{t("research.live.sourceSummary", { count: state.sources.filter(source => source.decision !== "excluded").length })}</summary><div className="mt-3"><GuidedResearchSourceWorkspace state={draft?.node === "research" ? { ...state, sources: state.sources.map(source => ({ ...source, decision: draft.value.find(entry => entry.id === source.id)?.decision ?? source.decision })) } : state} actions={null} /></div></details>}
        {viewedNode === "research" && !waiting && researchFailed && <details data-testid="research-failed-tasks" className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t("research.live.failedSummary", { count: state.tasks.filter((task) => task.status === "failed").length })}</summary><ul className="mt-2 space-y-2">{state.tasks.filter((task) => task.status === "failed").map((task) => <li key={task.id}><span className="font-medium">{task.title || task.query}</span><p className="text-muted-foreground">{t(task.errorCode === "RESEARCH_SEARCH_TIME_BUDGET_EXCEEDED" ? "research.search.interrupted" : errors[task.errorCode ?? ""] ?? "research.search.incomplete")}</p></li>)}</ul></details>}
        {reportVisible && !processing && state.availableNodes.includes("research") && <details open={chapterDetailsOpen} onToggle={(event) => { const open = event.currentTarget.open; setChapterDetailsOpen(open); if (open) setChapterDetailsMounted(true); }}><summary className="cursor-pointer text-sm font-medium">{t("research.live.adjustChapters")}</summary>{chapterDetailsMounted && <ResearchChaptersWorkspace onDirtyChange={setChaptersDirty} runtime={state} disabled={busy} onSave={(value) => void run("save_chapters", { node: "outline", draft: { node: "outline", value } })} onOptimize={(value) => void run("message", { node: "outline", draft: { node: "outline", value }, message: "基于当前章节和已有研究证据优化章节结构、目标与小节，保留来源和证据局限。" })} />}</details>}
        {node === "report" && !chaptersOpen && !waiting && reportDocument && <GuidedResearchReportWorkspace
          actions={null}
          contents={<nav aria-label={t("research.live.reportContents")} className="space-y-1 text-sm text-muted-foreground"><a className="block rounded bg-muted p-2" href="#research-report-summary">{reportHeadings.summary}</a>{reportDocument.introduction && <a className="block p-2" href="#research-report-introduction">{reportHeadings.introduction}</a>}{reportDocument.sections.map((section, index) => <div key={section.sectionId}><a className="block p-2 font-medium" href={`#research-report-section-${index}`}>{index + 1}. {section.title}</a>{reportSectionHeadings(chapterBody(section.body, section.title)).map((heading) => <a key={`${section.sectionId}-${heading.index}`} className="block py-1 pl-6 pr-2 text-xs" href={`#research-report-section-${index}-subsection-${heading.index}`}>{heading.title}</a>)}</div>)}{reportDocument.conclusion && <a className="block p-2" href="#research-report-conclusion">{reportHeadings.conclusion}</a>}<a className="block border-t p-2" href="#research-report-references">{reportHeadings.references}</a></nav>}
          document={<div data-testid="research-report" data-layout="full-width-report"><ResearchPrototypeReport document={reportDocument} fileActions={<ResearchReportFileActions sessionId={state.sessionId} reportVersion={state.version} disabled={busy || !state.completed || Boolean(state.errorCode) || Boolean(state.reportDraft)} />} sources={state.sources.filter((source) => source.decision !== "excluded").length} actions={reportCommandActions} moreActions={reportAssistantMenuAction} onRegenerate={() => void run("generate_report", { node: "report" })} disabled={busy || Boolean(proposal)} />{reportMarkdownDocument && <details className="mt-5" open={reportMarkdownOpen} onToggle={(event) => setReportMarkdownOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">{t("research.live.editMarkdown")}</summary>{reportMarkdownOpen && <div className="mt-3"><GuidedResearchMarkdownWorkspace onDirtyChange={setMarkdownDirty} document={reportMarkdownDocument} saving={busy} onSave={async (markdown) => {
            const parsed = parseGuidedResearchMarkdown({ document: reportMarkdownDocument, markdown });
            if (!parsed.ok) {
              const error = parsed.errors[0]!;
              return { ok: false, messageKey: error.code === "immutable_provenance" ? "research.markdown.parse.provenance" : error.code === "immutable_citation" ? "research.markdown.parse.citations" : error.heading ? "research.markdown.parse.missing" : "research.markdown.parse.required", ...(error.heading ? { messageParams: { heading: parsed.errors.map(item => item.heading).filter(Boolean).join(" / ") } } : {}) };
            }
            const saved = await run("save", { draft: parsed.draft });
            return saved ? { ok: true } : { ok: false, messageKey: "research.markdown.reportNotSaved" };
          }} provenance={t("research.markdown.reportProvenance")} /></div>}</details>}</div>}
          metrics={null}
          limitation={null}
        />}
        {researchBlocked && !waiting && !error && !state.errorCode && !expired && state.controlStatus !== "paused" && <p role="status" className="text-12 text-muted-foreground">{researchRunning ? t("research.live.searchRunning") : t("research.live.searchRequired")}</p>}

        </>}
        {viewedNode === "report" && !chaptersOpen && <GuidedResearchReportHistory state={state} />}
        {reportVisible && !readingReport && !waiting && (!state.reportDraft || node === "research") && reportActions}
        {!reportVisible && node !== "research" && !chaptersOpen && !waiting && !recovery && (state.errorCode || expired) && <div className="flex justify-end"><Button variant="primary" loading={busy} disabled={busy} onClick={() => void run("retry")}>{t("research.live.retry")}</Button></div>}
      </div>
    </GuidedResearchStepLayout>
  </div>} />;
}
