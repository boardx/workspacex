"use client";
import { GuidedResearchReportTimeline } from "./guided-research-report-timeline";
import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { research as C } from "@repo/contracts";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GuidedResearchConversation } from "./guided-research-conversation";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ResearchProgress, ResearchLoading, researchSteps as steps, researchStepLabels as labels } from "./guided-research-presentation";
import { researchReportDocument } from "@/lib/research-report-document";
import { GuidedResearchReportDocument } from "./guided-research-report-document";
import { GuidedResearchReportHistory, GuidedResearchEvidenceWarning } from "./guided-research-report-history";
import { GuidedResearchQualityDraft } from "./guided-research-quality-draft";
import { GuidedResearchReportPreview } from "./guided-research-report-preview";
import { ResearchDirectionsEditor, ResearchOutlineEditor, ResearchDesignPreview } from "./guided-research-design-editor";
import { GuidedResearchRuntimeProgress, GuidedResearchPlanDetails } from "./guided-research-runtime-progress";
import { GuidedResearchSources } from "./guided-research-sources";
import { GuidedResearchStepLayout } from "./guided-research-step-layout";
import { getResearchRuntime, getResearchRuntimeProgress, mergeResearchProgress, executeResearchRuntime, type GuidedResearchRuntime as Runtime, type GuidedResearchRuntimeCommand as Command, type GuidedResearchRuntimeDraft as Draft } from "@/lib/guided-research-api";
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
  RESEARCH_WORKFLOW_UNAVAILABLE: "模型服务暂时不可用，请稍后重试；持续失败请联系管理员检查模型配置。",
  RESEARCH_NODE_MISMATCH: "研究步骤已变化，请查看最新进度后继续。",
  RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH: "请求状态发生冲突，请核对最新进度后重新操作。",
  RESEARCH_WORKFLOW_BUSY: "研究正在处理中，请稍候。",
  RESEARCH_SEARCH_NOT_CONFIGURED: "检索服务尚未配置，请联系管理员。",
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
export function GuidedResearchLive({ sessionId, onBack, initialNode }: { sessionId: string; onBack: () => void; initialNode?: Command["node"] }) {
  const [state, setState] = React.useState<Runtime | null>(null);
  const [node, setNode] = React.useState<Command["node"]>("brief");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [message, setMessage] = React.useState("");
  const [loadingNode, setLoadingNode] = React.useState<Command["node"] | null>(null);
  const [pending, setPending] = React.useState(false);
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
    let active = true;
    sessionGeneration.current += 1;
    responseEpoch.current += 1; snapshotRef.current = null; messageDraft.current = null;
    setState(null); setDraft(null); setMessage(""); setError(null); setPending(false); setLoadingNode(null); updateRecovery(null);
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
  async function run(action: Command["action"], extra: Partial<Command> = {}) {
    if (!state || busy) return;
    const generation = sessionGeneration.current;
    const isCurrent = () => sessionRef.current === sessionId && sessionGeneration.current === generation;
    const approvedAction = action === "apply" ? state.proposal?.action : action;
    const following = (approvedAction === "confirm" || approvedAction === "complete") && node !== "report" ? steps[steps.indexOf(node) + 1] : undefined;
    const requestNode = node;
    const recoveryState = state;
    const recoveryDraft = draft;
    messageDraft.current = action === "message" && draft ? { draft, node } : null;
    if (following) setLoadingNode(following);
    else if (["generate", "start", "retry"].includes(approvedAction ?? action)) setLoadingNode(node);
    responseEpoch.current += 1; commandVersion.current = state.version + 1; setPending(true); setError(null);
    try {
      const input = { sessionId, node, action, requestId: crypto.randomUUID(), expectedVersion: state.version, ...extra };
      const streamsReport = following === "report" || (node === "report" && (approvedAction === "generate" || approvedAction === "retry"));
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
  const validDraft = Boolean(draft && C.GuidedResearchRuntimeDraft.safeParse(draft).success);
  if (!state || state.sessionId !== sessionId) return <div role="status" className="p-4">{error ?? "正在恢复研究会话…"}{error && <Button variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>重试加载</Button>}<Button variant="ghost" onClick={onBack}>返回研究首页</Button></div>;
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
  return <div className="max-w-none space-y-4" data-layout="signed-desktop" data-testid={`research-flow-${node === "research" ? "search" : node}`}>
    <ResearchProgress node={loadingNode ?? node} availableNodes={state.availableNodes} busy={busy} completed={state.completed} onNavigate={navigate} onBack={onBack} />
    <GuidedResearchStepLayout assistant={<GuidedResearchConversation node={node} messages={state.messages} message={message} onMessageChange={setMessage} busy={busy} processing={processing}
      onSend={(text) => { if (text.trim()) void run("message", { message: text.trim(), ...(draft ? { draft } : {}) }); }}
      proposal={proposal} proposalEdited={proposalEdited} onApply={() => void run("apply", { proposalId: proposal?.id })}
      preview={proposal ? <ProposalPreview draft={proposal.draft} /> : null} />}>
      <div className="space-y-5">
        {proposal && !waiting && <p role="status" className="rounded-lg border border-primary/30 bg-muted/30 px-4 py-3 text-12" data-testid="research-conversation-draft">右侧已同步对话生成的「{labels[node]}」草稿，尚未应用。你可以继续在左侧提出修改，核对后请先在左侧应用建议，再确认并继续。{proposalEdited && " 右侧另有手动修改，请继续对话或保存当前草稿。"}</p>}
    {recovery && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12" data-testid="research-recovery"><summary className="cursor-pointer font-medium">需要核对研究进度{recovery.draft ? " · 草稿已保留" : ""}</summary><div className="mt-3 space-y-3">
      <p role="status" className="text-12">{recovery.synchronized ? "已读取最新研究进度。请核对后继续，系统不会自动重复提交。" : "尚未确认最新研究进度，请先重新连接。"}{recovery.draft && " 你的未提交草稿已保留在当前页面。"}</p>
      {recovery.draft && <details className="text-12"><summary>查看保留的草稿</summary><ProposalPreview draft={recovery.draft} /></details>}
      {latestRecoveryDraft && <details className="text-12"><summary>查看服务端最新内容</summary><ProposalPreview draft={latestRecoveryDraft} /></details>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => void recoverProgress(sessionId)}>重新读取进度</Button>
        <Button disabled={!recovery.synchronized || processing} onClick={() => finishRecovery(false)}>使用最新进度</Button>
        {recovery.draft && <Button variant="outline" disabled={!recovery.synchronized || processing || !state.availableNodes.includes(recovery.node)} onClick={() => finishRecovery(true)}>继续编辑保留的草稿</Button>}
      </div>
    </div></details>}
    {(error || (node === state.currentNode && state.errorCode)) && <p role="alert" className="rounded-md border border-destructive p-3 text-12 text-destructive">{error ?? errors[state.errorCode!] ?? "上次处理失败，请重试。"}</p>}
    {state.legacyCheckpoint && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12 text-muted-foreground"><summary>历史记录已保留 · 查看迁移说明</summary><p className="mt-2">原会话状态：{state.legacyCheckpoint.status === "completed" ? "已完成" : "进行中"}。原方向与大纲已导入；旧版检索和报告没有可验证的来源记录，需要重新检索后生成报告。</p><p>原研究主题：{state.legacyCheckpoint.brief.topic}</p><ul>{state.legacyCheckpoint.directions.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.description}</li>)}</ul><ul>{state.legacyCheckpoint.outline.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.questions.join("；")}</li>)}</ul></details>}
    {expired && !error && !state.errorCode && <p role="alert" className="text-12 text-destructive">上次执行已中断。已保存的结果仍可用，请重试。</p>}
        {reportVisible && <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-24 font-semibold">研究报告{state.completed ? " · 已完成" : ""}</h1>{!waiting && <Button variant="outline" disabled={busy} onClick={() => void run(state.errorCode || expired || state.reportDraft ? "retry" : "generate")}>{state.errorCode || expired || state.reportDraft ? "生成完整报告" : state.report ? "重新生成报告" : "生成报告"}</Button>}{!waiting && (state.errorCode || expired || state.reportDraft) && <details className="text-12"><summary className="cursor-pointer text-muted-foreground">更多操作</summary><Button variant="ghost" disabled={busy} onClick={() => void run("generate")}>重新生成报告</Button></details>}</div>}
        {reportVisible && state.reportTimeline?.length ? <GuidedResearchReportTimeline state={state} interrupted={expired} /> : <GuidedResearchRuntimeProgress state={state} />}
        {reportVisible && <GuidedResearchEvidenceWarning state={state} />}
        {reportVisible && <GuidedResearchReportHistory state={state} />}
        {reportVisible && state.reportPartial && <p className="rounded-md border border-border bg-muted/30 p-3 text-12" data-testid="research-report-evidence-gap">本报告基于已有来源生成，部分检索任务未成功，相关证据可能存在缺口。</p>}
        {reportVisible && <GuidedResearchQualityDraft state={state} />}
        {reportVisible && !state.report && !state.reportDraft && (state.reportStream || (!state.report && state.reportCheckpoint)) && <GuidedResearchReportPreview state={state} interrupted={expired} />}
        {waiting && (loadingNode ?? node) === "research" && <GuidedResearchPlanDetails state={state} errors={errors} />}
        {waiting ? (reportVisible && (state.reportTimeline?.length || state.reportStream || (!state.report && state.reportCheckpoint)) ? null : <ResearchLoading node={loadingNode ?? node} />) : <>
        {node !== "report" && <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-24 font-semibold">{labels[node]}</h1><Button variant="outline" disabled={busy || Boolean(draft && !validDraft)} onClick={() => void run("generate", validDraft && draft ? { draft } : {})}><Sparkles className="size-4" aria-hidden />{node === "research" ? "重新生成研究计划" : "重新生成本步骤"}</Button></div>}
        {state.currentNode !== node && <p className="text-12 text-muted-foreground">重新确认此步骤会使后续研究结果失效，并按当前内容重新生成。</p>}
        {processing && !(reportVisible && state.reportTimeline?.length) && <p role="status" className="flex items-center gap-2 text-12 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />正在处理，进度会自动保存…</p>}
        {draft?.node === "brief" && <Card><CardContent className="space-y-3 p-4">{(["topic", "goal", "timeRange", "region", "focus"] as const).map((field) => <label key={field} className="block text-12">{{ topic: "研究主题", goal: "研究目标", timeRange: "时间范围", region: "研究区域", focus: "重点关注" }[field]}<Textarea disabled={busy} value={draft.value[field]} onChange={(event) => setDraft({ ...draft, value: { ...draft.value, [field]: event.target.value } })} /></label>)}</CardContent></Card>}
        {draft?.node === "directions" && <ResearchDirectionsEditor draft={draft} disabled={busy} onChange={setDraft} />}
        {draft?.node === "outline" && <ResearchOutlineEditor draft={draft} disabled={busy} onChange={setDraft} />}
        {node === "research" && <>
          <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={() => void run("start")}>开始真实检索</Button><Button variant="outline" disabled={busy || !state.tasks.some((task) => task.status === "failed" || (expired && task.status === "running"))} onClick={() => void run("retry")}>重试失败任务</Button></div>
          <Card data-testid="research-search-summary"><CardContent className="space-y-2 p-4"><h2 className="font-semibold">研究检索进度</h2><p className="text-12">已完成 {state.tasks.filter((task) => task.status === "succeeded").length} / {state.tasks.length} 项任务</p><p className="text-12 text-muted-foreground" data-testid="research-current-query">{state.tasks.find((task) => task.status === "running" || task.status === "pending")?.query ?? (state.tasks.length ? "本轮检索已结束" : "请先生成研究计划或开始检索")}</p></CardContent></Card>
          <GuidedResearchPlanDetails state={state} errors={errors} />
          <GuidedResearchSources sources={displaySources} disabled={busy || Boolean(proposal)} onAdd={(sourceUrl) => run("add_source", { sourceUrl })} onRemove={(sourceId) => void run("remove_source", { sourceId })} />
        </>}
        {node === "report" && displayReport && <div className="space-y-4" data-testid="research-report" data-layout="full-width-report"><GuidedResearchReportDocument limitations={state.reportPartial || state.reportEvidenceWarnings?.length ? "部分检索或证据核验未成功，报告存在证据缺口，相关结论需进一步核实。" : undefined} document={researchReportDocument(displayReport, state.sources, state.outline)} /></div>}
        {researchBlocked && <p role="status" className="text-12 text-muted-foreground">{researchPending ? "检索仍在进行，任务结束后可生成报告。" : "请完成检索并保留至少一个真实来源后生成报告。"}</p>}
        {node !== "report" && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 py-4"><Button variant="outline" disabled={busy || !validDraft} onClick={() => draft && void run("save", { draft })}>保存草稿</Button><Button variant="primary" disabled={busy || Boolean(proposal) || !validDraft || researchBlocked} onClick={() => void run(node === "research" ? "complete" : "confirm", { ...(draft ? { draft } : {}), ...(partialResearch ? { allowPartialResearch: true } : {}) })}>{partialResearch ? "基于已有来源生成报告" : "确认并继续"}</Button></div>}
        {node === "report" && state.report && !state.completed && <div className="flex justify-end"><Button variant="primary" disabled={busy || Boolean(proposal)} onClick={() => void run("complete", { draft: { node: "report", value: displayReport! } })}>完成研究</Button></div>}
        </>}
      </div>
    </GuidedResearchStepLayout>
  </div>;
}
