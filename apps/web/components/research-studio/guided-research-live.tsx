"use client";
import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { research as C } from "@repo/contracts";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ResearchProgress, ResearchLoading, researchSteps as steps, researchStepLabels as labels } from "./guided-research-presentation";
import { GuidedResearchStepLayout } from "./guided-research-step-layout";
import { getResearchRuntime, executeResearchRuntime, type GuidedResearchRuntime as Runtime, type GuidedResearchRuntimeCommand as Command, type GuidedResearchRuntimeDraft as Draft } from "@/lib/guided-research-api";
function newestSnapshot(incoming: Runtime, current: Runtime | null): Runtime {
  return current && current.sessionId === incoming.sessionId && (current.version > incoming.version || (current.version === incoming.version && !current.busy && incoming.busy)) ? current : incoming;
}
function draftOf(state: Runtime, node: Command["node"]): Draft | null {
  if (node === "brief") return { node, value: state.brief };
  if (node === "directions") return state.directions.length ? { node, value: state.directions } : null;
  if (node === "outline") return state.outline.length ? { node, value: state.outline } : null;
  if (node === "research") return { node, value: state.sources.map(({ id, decision }) => ({ id, decision })) };
  return state.report ? { node, value: state.report } : null;
}
function ProposalPreview({ draft }: { draft: Draft }) {
  if (draft.node === "brief") return <div className="space-y-2"><p>{draft.value.topic}</p><p>{draft.value.goal}</p><p>{[draft.value.timeRange, draft.value.region, draft.value.focus].filter(Boolean).join(" · ")}</p></div>;
  if (draft.node === "directions") return <ul className="space-y-2">{draft.value.map((item) => <li key={item.id}><strong>{item.title}</strong><p>{item.description}</p></li>)}</ul>;
  if (draft.node === "outline") return <ul className="space-y-2">{draft.value.map((item) => <li key={item.id}><strong>{item.title}</strong><p>{item.questions.join("；")}</p></li>)}</ul>;
  if (draft.node === "report") return <p className="whitespace-pre-wrap">{draft.value.summary}</p>;
  return <p>建议保留 {draft.value.filter((item) => item.decision === "accepted").length} 个来源、排除 {draft.value.filter((item) => item.decision === "excluded").length} 个来源。</p>;
}
const errors: Record<string, string> = {
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
  RESEARCH_SOURCES_REQUIRED: "请先保留至少一个真实来源。",
  RESEARCH_TASKS_INCOMPLETE: "请先完成检索任务，失败任务可重试。",
  RESEARCH_CONTENT_REFERENCE_INVALID: "生成内容引用了不可用的来源，已拒绝应用。请重新生成。",
  RESEARCH_NODE_STATE_INVALID: "模型返回的内容不符合本步骤要求，请重试。",
  RESEARCH_MODEL_GENERATION_REQUIRED: "请先使用模型生成本步骤内容，再确认。",
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
  const pollIssued = React.useRef(0);
  const pollAccepted = React.useRef(0);
  const sessionGeneration = React.useRef(0);
  const sessionRef = React.useRef(sessionId);
  sessionRef.current = sessionId;
  const nodeRef = React.useRef(node);
  nodeRef.current = node;
  React.useEffect(() => {
    let active = true;
    sessionGeneration.current += 1;
    responseEpoch.current += 1; snapshotRef.current = null;
    setState(null); setDraft(null); setMessage(""); setError(null); setPending(false); setLoadingNode(null); updateRecovery(null);
    getResearchRuntime(sessionId).then((next) => {
      if (!active) return;
      const target = initialNode && next.availableNodes.includes(initialNode) ? initialNode : next.currentNode;
      snapshotRef.current = next; setState(next); setNode(target); setDraft(draftOf(next, target));
    }).catch((cause: unknown) => { if (active) setError(requestError(cause)); });
    return () => { active = false; sessionGeneration.current += 1; };
  }, [sessionId, initialNode, loadAttempt]);
  const expired = Boolean(state?.leaseUntil && Date.parse(state.leaseUntil) <= Date.now());
  React.useEffect(() => {
    if (!pending && (!state?.busy || expired)) return;
    let active = true;
    const minimumVersion = pending ? commandVersion.current : 0;
    const timer = window.setInterval(() => {
      const epoch = responseEpoch.current; const ticket = ++pollIssued.current;
      getResearchRuntime(sessionId).then((next) => {
        const current = snapshotRef.current;
        if (!active || epoch !== responseEpoch.current || ticket < pollAccepted.current || next.version < minimumVersion || (current && (next.version < current.version || (next.version === current.version && !current.busy && next.busy)))) return;
        pollAccepted.current = ticket; snapshotRef.current = next;
        setState(next);
        if (!recoveryRef.current) setDraft(draftOf(next, nodeRef.current));
      }).catch(() => { /* The command response or next polling attempt resolves a transient network failure. */ });
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pending, state?.busy, expired, sessionId]);
  const processing = pending || Boolean(state?.busy && !expired);
  const busy = processing || Boolean(recovery);
  async function run(action: Command["action"], extra: Partial<Command> = {}) {
    if (!state || busy) return;
    const generation = sessionGeneration.current;
    const isCurrent = () => sessionRef.current === sessionId && sessionGeneration.current === generation;
    const approvedAction = action === "apply" ? state.proposal?.action : action;
    const following = (approvedAction === "confirm" || approvedAction === "complete") && node === state.currentNode && node !== "report" ? steps[steps.indexOf(node) + 1] : undefined;
    let requestNode = node;
    let recoveryState = state;
    let recoveryDraft = draft;
    if (following) setLoadingNode(following);
    else if (["generate", "start", "retry"].includes(approvedAction ?? action)) setLoadingNode(node);
    responseEpoch.current += 1; commandVersion.current = state.version + 1; setPending(true); setError(null);
    try {
      let received = await executeResearchRuntime({ sessionId, node, action, requestId: crypto.randomUUID(), expectedVersion: state.version, ...extra });
      if (!isCurrent()) return;
      let next = newestSnapshot(received, snapshotRef.current);
      // Only chain from our own successful confirmation. A collaborator's newer
      // snapshot must never authorize generation on their behalf.
      if (following && next === received && !next.errorCode && !next.busy && next.currentNode === following && !next.completed) {
        responseEpoch.current += 1; snapshotRef.current = next; setState(next);
        setNode(following); setDraft(draftOf(next, following));
        requestNode = following; recoveryState = next; recoveryDraft = null;
        commandVersion.current = next.version + 1;
        received = await executeResearchRuntime({ sessionId, node: following, action: following === "research" ? "start" : "generate", requestId: crypto.randomUUID(), expectedVersion: next.version });
        if (!isCurrent()) return;
        next = newestSnapshot(received, snapshotRef.current);
      }
      responseEpoch.current += 1; snapshotRef.current = next;
      setState(next);
      const target = next !== received || action === "confirm" || action === "complete" || action === "apply" ? next.currentNode : requestNode;
      setNode(target); setDraft(draftOf(next, target));
      if (next.errorCode) setError(errors[next.errorCode] ?? "处理失败，已保存当前进度，请重试。");
      if (action === "message" && !next.errorCode) setMessage("");
    } catch (cause) {
      if (!isCurrent()) return;
      // Capture the submitted editor before a recovery read or polling can replace it.
      const localDraft = recoveryDraft && JSON.stringify(recoveryDraft) !== JSON.stringify(draftOf(recoveryState, requestNode)) ? recoveryDraft : null;
      setNode(requestNode);
      updateRecovery({ draft: localDraft, node: requestNode, synchronized: false });
      if (localDraft) setDraft(localDraft);
      setError(requestError(cause));
      await recoverProgress(sessionId);
    } finally { if (isCurrent()) { setPending(false); setLoadingNode(null); } }
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
  function downloadReport() {
    if (!state?.report) return;
    const report = state.report;
    const content = [`# ${report.title}`, report.summary, ...report.sections.flatMap((section) => [
      `## ${state.outline.find((item) => item.id === section.sectionId)?.title ?? ""}`, section.body,
      ...section.sourceIds.map((id) => { const source = state.sources.find((item) => item.id === id); return source ? `- ${source.title}: ${source.url}` : ""; }),
    ])].join("\n\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "research-report.md"; anchor.click(); URL.revokeObjectURL(url);
  }
  const validDraft = Boolean(draft && C.GuidedResearchRuntimeDraft.safeParse(draft).success);
  if (!state || state.sessionId !== sessionId) return <div role="status" className="p-4">{error ?? "正在恢复研究会话…"}{error && <Button variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>重试加载</Button>}<Button variant="ghost" onClick={onBack}>返回研究首页</Button></div>;
  const latestRecoveryDraft = recovery?.synchronized ? draftOf(state, recovery.node) : null;
  const proposal = state.proposal?.draft.node === node ? state.proposal : null;
  return <div className="max-w-none space-y-4" data-layout="signed-desktop" data-testid={`research-flow-${node === "research" ? "search" : node}`}>
    <ResearchProgress node={loadingNode ?? node} availableNodes={state.availableNodes} busy={busy} completed={state.completed} onNavigate={navigate} onBack={onBack} />
    <GuidedResearchStepLayout assistant={<section className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card p-5 shadow-sm" data-testid="research-skill-assistant">
      <h2 className="font-semibold">研究 Skill 助手</h2>
      <p className="mt-2 text-12 text-muted-foreground">与助手讨论当前步骤，应用建议后确认进入下一步。</p>
      <div className="my-4 min-h-32 flex-1 space-y-3 overflow-y-auto" data-testid="research-skill-messages">
        {state.messages.map((item) => <div key={item.id} className="rounded-md bg-muted p-3 text-12"><span className="font-medium">{item.role === "user" ? "你" : "Skill"} · {labels[item.node]}</span><p className="mt-1 whitespace-pre-wrap">{item.text}</p></div>)}
        {proposal && <div className="rounded-md border border-primary p-3 text-12" data-testid="research-skill-suggestion"><p>已生成「{labels[node]}」建议，应用前可以查看内容。</p><div className="my-2 max-h-48 overflow-auto"><ProposalPreview draft={proposal.draft} /></div><Button disabled={busy || proposal.version !== state.version} onClick={() => void run("apply", { proposalId: proposal.id })}>{{ save: "应用建议", generate: "批准生成", start: "批准开始检索", retry: "批准重试", confirm: "批准确认并继续", complete: "批准完成当前步骤" }[proposal.action ?? "save"]}</Button></div>}
      </div>
      <div className="flex gap-2"><Input aria-label="研究对话" value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} data-testid="research-skill-input" placeholder="讨论研究目标或修改建议…" /><Button variant="primary" disabled={busy || !message.trim()} onClick={() => void run("message", { message, ...(draft ? { draft } : {}) })} aria-label="发送研究消息"><Send className="size-4" aria-hidden /></Button></div>
    </section>}>
      <div className="space-y-5">
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
    {(error || state.errorCode) && <p role="alert" className="rounded-md border border-destructive p-3 text-12 text-destructive">{error ?? errors[state.errorCode!] ?? "上次处理失败，请重试。"}</p>}
    {state.legacyCheckpoint && <details className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-12 text-muted-foreground"><summary>历史记录已保留 · 查看迁移说明</summary><p className="mt-2">原会话状态：{state.legacyCheckpoint.status === "completed" ? "已完成" : "进行中"}。原方向与大纲已导入；旧版检索和报告没有可验证的来源记录，需要重新检索后生成报告。</p><p>原研究主题：{state.legacyCheckpoint.brief.topic}</p><ul>{state.legacyCheckpoint.directions.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.description}</li>)}</ul><ul>{state.legacyCheckpoint.outline.versions.at(-1)?.items.map((item) => <li key={item.id}>{item.title}：{item.questions.join("；")}</li>)}</ul></details>}
    {expired && <p role="alert" className="text-12 text-destructive">上次执行已中断。已保存的结果仍可用，请重试。</p>}
        {loadingNode || (!pending && state.busy && !expired && !recovery) ? <ResearchLoading node={loadingNode ?? node} /> : <>
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-24 font-semibold">{labels[node]}{state.completed && node === "report" ? " · 已完成" : ""}</h1><Button variant="outline" disabled={busy || Boolean(draft && !validDraft)} onClick={() => void run("generate", validDraft && draft ? { draft } : {})}><Sparkles className="size-4" aria-hidden />{node === "research" ? "生成研究计划" : "使用模型生成"}</Button></div>
        {state.currentNode !== node && <p className="text-12 text-muted-foreground">保存或应用此步骤的修改会使后续研究结果失效，需要重新确认和生成。</p>}
        {processing && <p role="status" className="flex items-center gap-2 text-12 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />正在处理，进度会自动保存…</p>}
        {draft?.node === "brief" && <Card><CardContent className="space-y-3 p-4">{(["topic", "goal", "timeRange", "region", "focus"] as const).map((field) => <label key={field} className="block text-12">{{ topic: "研究主题", goal: "研究目标", timeRange: "时间范围", region: "研究区域", focus: "重点关注" }[field]}<Textarea disabled={busy} value={draft.value[field]} onChange={(event) => setDraft({ ...draft, value: { ...draft.value, [field]: event.target.value } })} /></label>)}</CardContent></Card>}
        {draft?.node === "directions" && <div className="space-y-3" data-testid="research-directions"><Button variant="outline" disabled={busy || draft.value.length >= 20} onClick={() => setDraft({ ...draft, value: [...draft.value, { id: crypto.randomUUID(), title: "新研究方向", description: "补充研究重点", enabled: true, order: draft.value.length }] })}>添加研究方向</Button>{draft.value.map((item, index) => <Card key={item.id}><CardContent className="space-y-2 p-4"><label className="flex gap-2 text-12"><input type="checkbox" checked={item.enabled} disabled={busy} onChange={(event) => setDraft({ ...draft, value: draft.value.map((entry, i) => i === index ? { ...entry, enabled: event.target.checked } : entry) })} />纳入研究</label><Input aria-label="研究方向" disabled={busy} value={item.title} onChange={(event) => setDraft({ ...draft, value: draft.value.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry) })} /><Textarea aria-label="方向说明" disabled={busy} value={item.description} onChange={(event) => setDraft({ ...draft, value: draft.value.map((entry, i) => i === index ? { ...entry, description: event.target.value } : entry) })} /><Button variant="ghost" disabled={busy || draft.value.length <= 1} onClick={() => setDraft({ ...draft, value: draft.value.filter((entry) => entry.id !== item.id) })}>删除方向</Button></CardContent></Card>)}</div>}
        {draft?.node === "outline" && <div className="space-y-3" data-testid="research-outline"><Button variant="outline" disabled={busy || draft.value.length >= 30} onClick={() => setDraft({ ...draft, value: [...draft.value, { id: crypto.randomUUID(), title: "新章节", questions: ["需要回答什么问题？"], enabled: true, order: draft.value.length }] })}>添加章节</Button>{draft.value.map((item, index) => <Card key={item.id}><CardContent className="space-y-2 p-4"><label className="flex gap-2 text-12"><input type="checkbox" checked={item.enabled} disabled={busy} onChange={(event) => setDraft({ ...draft, value: draft.value.map((entry, i) => i === index ? { ...entry, enabled: event.target.checked } : entry) })} />纳入报告</label><Input aria-label="章节标题" disabled={busy} value={item.title} onChange={(event) => setDraft({ ...draft, value: draft.value.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry) })} /><Textarea aria-label="章节研究问题（每行一个）" disabled={busy} value={item.questions.join("\n")} onChange={(event) => setDraft({ ...draft, value: draft.value.map((entry, i) => i === index ? { ...entry, questions: event.target.value.split("\n") } : entry) })} /><Button variant="ghost" disabled={busy || draft.value.length <= 1} onClick={() => setDraft({ ...draft, value: draft.value.filter((entry) => entry.id !== item.id) })}>删除章节</Button></CardContent></Card>)}</div>}
        {node === "research" && <>
          <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={() => void run("start")}>开始真实检索</Button><Button variant="outline" disabled={busy || !state.tasks.some((task) => task.status === "failed" || (expired && task.status === "running"))} onClick={() => void run("retry")}>重试失败任务</Button></div>
          <Card data-testid="research-search-summary"><CardContent className="space-y-2 p-4"><h2 className="font-semibold">研究检索进度</h2><p className="text-12">已完成 {state.tasks.filter((task) => task.status === "succeeded").length} / {state.tasks.length} 项任务</p><p className="text-12 text-muted-foreground" data-testid="research-current-query">{state.tasks.find((task) => task.status === "running" || task.status === "pending")?.query ?? (state.tasks.length ? "本轮检索已结束" : "请先生成研究计划或开始检索")}</p></CardContent></Card>
          <details className="rounded-lg border border-border bg-card p-4"><summary className="cursor-pointer text-12 font-medium">检索任务明细 · {state.tasks.length} 项</summary><div className="mt-3 space-y-2">{state.tasks.map((task) => <Card key={task.id}><CardContent className="p-3 text-12"><p>{task.query}</p><p className="mt-1 text-muted-foreground">{{ pending: "等待检索", running: "正在检索", succeeded: "已完成", failed: "检索失败" }[task.status]} · 尝试 {task.attempts} 次</p>{task.errorCode && <p className="mt-1 text-destructive">{errors[task.errorCode] ?? "任务执行失败，请重试。"}</p>}</CardContent></Card>)}</div></details>
          <h2 className="font-semibold">真实来源 · {state.sources.length}</h2>
          {state.sources.map((source) => <Card key={source.id}><CardContent className="space-y-2 p-4 text-12"><a className="text-primary underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a><p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">{source.content}</p><label>来源处理 <select aria-label={`来源处理 ${source.title}`} className="rounded-md border border-border bg-background p-2" disabled={busy} value={draft?.node === "research" ? draft.value.find((item) => item.id === source.id)?.decision ?? source.decision : source.decision} onChange={(event) => { const decision = event.target.value as "pending" | "accepted" | "excluded"; if (draft?.node === "research") setDraft({ ...draft, value: draft.value.map((item) => item.id === source.id ? { ...item, decision } : item) }); }}><option value="pending">待处理</option><option value="accepted">保留</option><option value="excluded">排除</option></select></label></CardContent></Card>)}
        </>}
        {node === "report" && state.report && <div className="space-y-4" data-testid="research-report" data-layout="full-width-report"><nav aria-label="报告目录" className="rounded-lg border border-border p-4"><h2 className="font-semibold">目录</h2><ul className="mt-2 space-y-1 text-12">{state.report.sections.map((section, index) => <li key={section.sectionId}><a className="text-primary underline" href={`#research-report-section-${index}`}>{state.outline.find((item) => item.id === section.sectionId)?.title}</a></li>)}</ul></nav><h2 className="text-20 font-semibold">{state.report.title}</h2><p className="whitespace-pre-wrap text-12 leading-relaxed">{state.report.summary}</p>{state.report.sections.map((section, index) => <Card id={`research-report-section-${index}`} key={section.sectionId}><CardContent className="space-y-3 p-4"><h3 className="font-semibold">{state.outline.find((item) => item.id === section.sectionId)?.title}</h3><p className="whitespace-pre-wrap text-12 leading-relaxed">{section.body}</p><ul className="space-y-1 text-12">{section.sourceIds.map((id) => { const source = state.sources.find((item) => item.id === id); return source ? <li key={id}><a className="text-primary underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li> : null; })}</ul></CardContent></Card>)}<Button variant="outline" onClick={downloadReport}>下载报告（Markdown）</Button></div>}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 py-4"><Button variant="outline" disabled={busy || !validDraft || node === "report"} onClick={() => draft && void run("save", { draft })}>保存草稿</Button><Button variant="primary" disabled={busy || !validDraft || !state.generatedNodes.includes(node) || state.currentNode !== node || state.completed} onClick={() => void run(node === "report" || node === "research" ? "complete" : "confirm", draft ? { draft } : {})}>{node === "report" ? "完成研究" : "确认并继续"}</Button></div>
        </>}
      </div>
    </GuidedResearchStepLayout>
  </div>;
}
