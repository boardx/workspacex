"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/session/session-provider";
import { resolveAidtStepChat, createAidtStepChatWithLatest, AidtStepChatChoiceError, type AidtStepChat } from "@/features/aidt/lib/live-aidt-step-chat";
import type { AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { HostRunContextProvider, type HostRunObservation } from "@/lib/chat/host-run-context";
import { aidtStageContextSelector } from "../lib/aidt-native-context-selector";
import { AidtRunContextReceipt } from "./aidt-run-context-receipt";
import { ChatHostNavigationProvider } from "@/lib/chat/chat-host-navigation";
import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";
import { CopilotKitV2Providers } from "@/app/chat/copilotkit-v2/copilotkit-v2-providers";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { aidtHref, type AidtStep } from "@/features/aidt/lib/project-aidt";
import { AidtChatEmptyState } from "@/features/aidt/components/aidt-chat-empty-state";
import { AIDT_EMPTY_SAVED_CONTEXT, loadAidtSavedChatContext, type AidtSavedChatContext, type AidtSavedContextReference } from "@/features/aidt/lib/aidt-chat-saved-context";
import { AIDT_EMPTY_SHARED_CONTEXT, loadAidtSharedChatContext, aidtSharedContextPreview, type AidtSharedChatContext, type AidtSharedContextReference } from "@/features/aidt/lib/aidt-chat-shared-context";
import { AIDT_EMPTY_RETURN_CONTEXT, loadAidtReturnChatContext, type AidtReturnChatContext } from "@/features/aidt/lib/aidt-chat-return-context";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { AidtSummaryChatContext } from "./aidt-summary-chat-context";
import { aidtReportChatHref } from "../lib/aidt-report-task";
function AidtSkillUpdate({ projectId, step, current, identity, threadHref, purpose }: { purpose?: "report"; projectId: string; step: AidtStep; current: AidtStepChat; identity: { orgId: string; userId: string; sessionToken: string }; threadHref: (id: string | null) => string }) {
  const [state, setState] = React.useState<{ pending: boolean; href?: string; error?: string }>({ pending: false });
  const lifetime = React.useRef({ active: true, cancellation: null as AbortController | null });
  const submitting = React.useRef(false);
  React.useEffect(() => {
    const owner = { active: true, cancellation: null as AbortController | null }; lifetime.current = owner;
    return () => { owner.active = false; owner.cancellation?.abort(); };
  }, []);
  const prepare = async () => {
    if (submitting.current || !current.latestVersionId || current.latestVersionId === current.versionId) return;
    const owner = lifetime.current; owner.cancellation = new AbortController(); submitting.current = true;
    setState({ pending: true });
    try {
      const next = await createAidtStepChatWithLatest({ ...identity, projectId, step, thread: current.threadId,
        ...(purpose ? { purpose } : {}), expectedLatestVersionId: current.latestVersionId, expectedPinnedVersionId: current.versionId, signal: owner.cancellation.signal });
      if (owner.active && lifetime.current === owner) setState({ pending: false, href: threadHref(next.threadId) });
    } catch (error) {
      if (owner.active && lifetime.current === owner) setState({ pending: false, error: error instanceof Error ? error.message : "新版对话准备失败，请重试。" });
    } finally { if (lifetime.current === owner) submitting.current = false; }
  };
  return <div className="border-b border-border px-4 py-2 text-12" data-testid="aidt-skill-update">
    <p className="text-muted-foreground">教学规则有更新。可另开新版对话，原消息和本页未发送输入保留。</p>
    {state.href ? <a className="mt-1 inline-block text-primary underline" href={state.href} target="_blank" rel="noopener noreferrer">打开新版对话（新标签页）</a>
      : <Button size="sm" variant="outline" className="mt-2" disabled={state.pending} onClick={() => void prepare()}>{state.pending ? "正在准备新版对话…" : "使用新版另开本步对话"}</Button>}
    {state.error && <p role="alert" className="mt-1">{state.error}</p>}
  </div>;
}
/** Keep navigation hints only inside the same project and teaching stage. */
function currentStageQuery(projectId: string, stageId: number): URLSearchParams {
  const query = new URLSearchParams(window.location.search);
  return window.location.pathname === `/aidt/${encodeURIComponent(projectId)}` && query.get("step") === String(stageId) ? query : new URLSearchParams();
}
type AidtChatProps = { purpose?: "report"; projectId: string; step: AidtStep; thread: string | null; returnRevision?: string | null; savedContextRefs?: readonly AidtSavedContextReference[]; sharedContextRefs?: readonly AidtSharedContextReference[]; sharedContextReady?: boolean; onResolvedThread?: (threadId: string) => void };
export function ProjectAidtChat(props: AidtChatProps) {
  if (!isAidtModuleEnabled()) return <p role="status" data-testid="aidt-chat-disabled" className="p-4 text-13 text-muted-foreground">教学模块未启用。</p>;
  return <EnabledAidtChat {...props} />;
}
function EnabledAidtChat({ projectId, step, thread, returnRevision, savedContextRefs = [], sharedContextRefs = [], sharedContextReady = true, onResolvedThread, purpose }: AidtChatProps) {
  const { session } = useSession();
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId, step.id, thread, purpose]);
  const lifecycle = React.useRef({ scope, generation: 0 });
  if (lifecycle.current.scope !== scope) lifecycle.current = { scope, generation: lifecycle.current.generation + 1 };
  const generation = lifecycle.current.generation;
  const requestScope = JSON.stringify([scope, generation]);
  const [state, setState] = React.useState<{ scope: string; value?: AidtStepChat; error?: string; choices?: readonly { id: string; title: string }[] } | null>(null);
  const [retry, setRetry] = React.useState(0);
  const [summarySelection, setSummarySelection] = React.useState<{scope:string;selector:AidtContextSelector|null}|null>(null);
  const [acceptedRun, setAcceptedRun] = React.useState<{scope:string;runId:string}|null>(null);
  const attemptOwner=React.useRef<{scope:string;clientMessageId:string}|null>(null);
  const beginRun=React.useCallback((clientMessageId:string)=>{ if(lifecycle.current.scope===scope && lifecycle.current.generation===generation) {attemptOwner.current={scope:requestScope,clientMessageId};setAcceptedRun(null);} },[scope,generation,requestScope]);
  const selectSummary = React.useCallback((selector:AidtContextSelector|null) => { setSummarySelection({scope:requestScope,selector}); }, [requestScope]);
  const acceptRun = React.useCallback((observation:HostRunObservation) => { if (lifecycle.current.scope === scope && lifecycle.current.generation === generation && (attemptOwner.current?.scope !== requestScope || attemptOwner.current.clientMessageId === observation.clientMessageId)) setAcceptedRun({scope:requestScope,runId:observation.runId}); }, [scope,generation,requestScope]);
  let contextSelector:AidtContextSelector|null = null;
  try { contextSelector = purpose === "report" ? summarySelection?.scope === requestScope ? summarySelection.selector : null : sharedContextReady ? aidtStageContextSelector(projectId,step.id,sharedContextRefs,returnRevision) : null; } catch { /* Invalid selectors stay blocked, never ordinary Chat. */ }
  const resolvedCallback = React.useRef({ scope, generation, callback: onResolvedThread }); resolvedCallback.current = { scope, generation, callback: onResolvedThread };
  const referenceKey = JSON.stringify(savedContextRefs);
  const sharedReferenceKey = JSON.stringify(sharedContextRefs);
  const contextIdentity = JSON.stringify([requestScope, referenceKey, sharedReferenceKey]);
  const contextLifecycle = React.useRef({ identity: contextIdentity, generation: 0 });
  if (contextLifecycle.current.identity !== contextIdentity) contextLifecycle.current = { identity: contextIdentity, generation: contextLifecycle.current.generation + 1 };
  const contextScope = JSON.stringify([contextIdentity, contextLifecycle.current.generation]);
  const [contextState, setContextState] = React.useState<{ scope: string; value: AidtSavedChatContext } | null>(null);
  const [sharedContextState, setSharedContextState] = React.useState<{ scope: string; value: AidtSharedChatContext } | null>(null);
  const [contextRetry, setContextRetry] = React.useState(0);
  const [returnRetry, setReturnRetry] = React.useState(0);
  const returnIdentity = JSON.stringify([requestScope, returnRevision, returnRetry]);
  const returnLifecycle = React.useRef({ identity: returnIdentity, generation: 0 });
  if (returnLifecycle.current.identity !== returnIdentity) returnLifecycle.current = { identity: returnIdentity, generation: returnLifecycle.current.generation + 1 };
  const returnScope = JSON.stringify([returnIdentity, returnLifecycle.current.generation]);
  const [returnState, setReturnState] = React.useState<{ scope: string; value: AidtReturnChatContext } | null>(null);
  React.useEffect(() => {
    if (purpose === "report" || !session?.currentOrgId || !session.userId || !session.sessionToken || returnRevision == null) return;
    let active = true; const cancellation = new AbortController();
    const isCurrent = () => active && !cancellation.signal.aborted && returnLifecycle.current.identity === returnIdentity
      && JSON.stringify([returnLifecycle.current.identity, returnLifecycle.current.generation]) === returnScope;
    void loadAidtReturnChatContext({ projectId, currentStage: step.id, sessionToken: session.sessionToken, returnRevision, signal: cancellation.signal }).then((value) => {
      if (isCurrent()) setReturnState({ scope: returnScope, value });
    }).catch(() => { if (isCurrent()) setReturnState({ scope: returnScope, value: { status: "failed", items: [], issues: [{ stageNumber: 6, reason: "unavailable" }] } }); });
    return () => { active = false; cancellation.abort(); };
  }, [returnScope, returnIdentity, projectId, step.id, session?.currentOrgId, session?.userId, session?.sessionToken, returnRevision, purpose]);
  const returnContext = returnRevision == null ? AIDT_EMPTY_RETURN_CONTEXT : returnState?.scope === returnScope ? returnState.value : { status: "loading" as const, items: [] as const, issues: [] as const };

  React.useEffect(() => {
    if (purpose === "report" || !session?.currentOrgId || !session.sessionToken || !savedContextRefs.length) return;
    let active = true; const cancellation = new AbortController();
    const references: readonly AidtSavedContextReference[] = JSON.parse(referenceKey);
    void loadAidtSavedChatContext({ projectId, sessionToken: session.sessionToken, references, signal: cancellation.signal }).then((value) => {
      if (active) setContextState({ scope: contextScope, value });
    }).catch(() => { if (active) setContextState({ scope: contextScope, value: { status: "failed", items: [], issues: [{ stageNumber: step.id, reason: "unavailable" }] } }); });
    return () => { active = false; cancellation.abort(); };
  }, [contextScope, referenceKey, contextRetry, projectId, session?.currentOrgId, session?.sessionToken, savedContextRefs.length, step.id, purpose]);
  React.useEffect(() => {
    if (purpose === "report" || !session?.currentOrgId || !session.sessionToken || !sharedContextRefs.length) return;
    let active = true; const cancellation = new AbortController();
    const references: readonly AidtSharedContextReference[] = JSON.parse(sharedReferenceKey);
    void loadAidtSharedChatContext({ projectId, currentStage: step.id, sessionToken: session.sessionToken, references, signal: cancellation.signal }).then((value) => {
      if (active) setSharedContextState({ scope: contextScope, value });
    }).catch(() => { if (active) setSharedContextState({ scope: contextScope, value: { status: "failed", items: [], issues: [{ stageNumber: step.id, reason: "unavailable" }] } }); });
    return () => { active = false; cancellation.abort(); };
  }, [contextScope, sharedReferenceKey, contextRetry, projectId, session?.currentOrgId, session?.sessionToken, sharedContextRefs.length, step.id, purpose]);
  const sharedContext = !sharedContextRefs.length ? AIDT_EMPTY_SHARED_CONTEXT : sharedContextState?.scope === contextScope ? sharedContextState.value : { status: "loading" as const, items: [] as const, issues: [] as const };
  const savedContext = !savedContextRefs.length ? AIDT_EMPTY_SAVED_CONTEXT : contextState?.scope === contextScope ? contextState.value : { status: "loading" as const, items: [] as const, issues: [] as const };
  React.useEffect(() => {
    if (!session?.currentOrgId || !session.sessionToken) return;
    let active = true;
    const cancellation = new AbortController();
    setState(null);
    void resolveAidtStepChat({ orgId: session.currentOrgId, userId: session.userId, sessionToken: session.sessionToken, projectId, step, thread, ...(purpose ? { purpose } : {}), signal: cancellation.signal }).then((value) => {
      if (!active || lifecycle.current.generation !== generation || lifecycle.current.scope !== scope) return;
      const query = currentStageQuery(projectId, step.id);
      window.history.replaceState(null, "", purpose === "report" ? aidtReportChatHref(projectId, { threadId: value.threadId, stageThread: query.get("thread"), tool: query.get("tool") === "report" ? "report" : "chat", returnRevision: query.get("returnRevision") }) : aidtHref(projectId, step.id, { thread: value.threadId, tool: query.get("tool") ?? undefined, resource: query.get("resource") ?? undefined, returnRevision: query.get("returnRevision") }));
      setState({ scope: requestScope, value });
      if (resolvedCallback.current.scope === scope && resolvedCallback.current.generation === generation) resolvedCallback.current.callback?.(value.threadId);
    }).catch((error: unknown) => { if (active && lifecycle.current.generation === generation && lifecycle.current.scope === scope) setState({ scope: requestScope, error: error instanceof Error ? error.message : "步骤对话读取失败，请重试。", choices: error instanceof AidtStepChatChoiceError ? error.choices : undefined }); });
    return () => { active = false; cancellation.abort(); };
  }, [scope, generation, requestScope, session, projectId, step, thread, retry, purpose]);
  const path = React.useCallback((id: string | null) => {
    const query = currentStageQuery(projectId, step.id);
    return purpose === "report" ? aidtReportChatHref(projectId, { threadId: id, stageThread: query.get("thread"), tool: query.get("tool") === "report" ? "report" : "chat", returnRevision: query.get("returnRevision") }) : aidtHref(projectId, step.id, { thread: id, tool: query.get("tool") ?? undefined, resource: query.get("resource") ?? undefined, returnRevision: query.get("returnRevision") });
  }, [projectId, step.id, purpose]);
  const fromLocation = React.useCallback(() => new URLSearchParams(window.location.search).get(purpose === "report" ? "summaryThread" : "thread"), [purpose]);
  const current = state?.scope === requestScope ? state : null;
  if (!current) return <p role="status" className="p-4">正在准备本步对话与 Skill…</p>;
  if (current.error || !current.value) return <div role="alert" className="p-4" data-testid="aidt-chat-error"><p>{current.error}</p>{current.choices && <ul className="my-3 space-y-2">{current.choices.map((choice) => <li key={choice.id}><a className="text-primary underline" href={path(choice.id)}>{choice.title} · 继续这条对话</a></li>)}</ul>}<Button variant="outline" onClick={() => setRetry((n) => n + 1)}>重试</Button><a className="ml-3 text-primary" href={path(null)}>返回本步对话</a></div>;
  return <HostRunContextProvider scope={{orgId:session?.currentOrgId ?? "",userId:session?.userId ?? "",sessionToken:session?.sessionToken ?? "",projectId,threadId:current.value.threadId,task:JSON.stringify([requestScope,purpose ?? "stage",step.id])}} forwardedProps={contextSelector ? {aidtContext:contextSelector} : null} onRunAccepted={acceptRun} onAttemptStarted={beginRun}><ChatHostNavigationProvider value={{ projectId, returnHref: purpose === "report" ? aidtReportChatHref(projectId, { tool: "report", threadId: current.value.threadId, stageThread: currentStageQuery(projectId, step.id).get("thread"), returnRevision: currentStageQuery(projectId, step.id).get("returnRevision") }) : aidtHref(projectId, step.id, { tool: "whiteboard", thread: current.value.threadId, returnRevision: currentStageQuery(projectId, step.id).get("returnRevision") }) }}><CopilotKitV2AgentSelectionProvider><CopilotKitV2Providers>
    <div className="flex h-full min-h-0 flex-col"><p className="border-b border-border px-4 py-2 text-12 text-muted-foreground" data-testid="aidt-step-skill">{purpose === "report" ? "本组报告总结对话 · Skill：" : "本组共享对话 · 教学 Skill："}{current.value.skillName}</p>
    {current.value.latestVersionId && current.value.latestVersionId !== current.value.versionId && session?.currentOrgId && session.userId && session.sessionToken && <AidtSkillUpdate key={JSON.stringify([requestScope, current.value.versionId, current.value.latestVersionId])} projectId={projectId} step={step} current={current.value} identity={{ orgId: session.currentOrgId, userId: session.userId, sessionToken: session.sessionToken }} threadHref={path} purpose={purpose} />}
    {purpose !== "report" && !sharedContextReady && <p role="status" className="border-b border-border px-4 py-2 text-12 text-muted-foreground" data-testid="aidt-chat-context-pending">小组保存版本尚未就绪。请完成材料读取或重试后发送，草稿已保留。</p>}
    {purpose !== "report" && savedContextRefs.length > 0 && <details className="border-b border-border px-4 py-2 text-12 text-muted-foreground" data-testid="aidt-chat-saved-context"><summary className="cursor-pointer">参考已保存成果 · {savedContext.status === "loading" ? "读取中" : `${savedContext.items.length} 份`}</summary><p className="mt-2">页面仅展示成功回读的已选来源；保存与定版不代表全组确认或真实证据。个人成果在此供核对，本次服务器上下文不自动读取个人成果正文。</p>{savedContext.items.map((item) => <p key={`${item.threadId}:${item.artifactId}`} className="mt-1">第 {item.stageNumber} 步 · {item.title} · {item.mode === "draft" ? "个人保存稿，仅供页面核对" : "已保存，尚未确认"}{item.truncated ? " · 内容已截断" : ""}</p>)}{savedContext.issues.length > 0 && <div role="status" className="mt-2"><p>{savedContext.issues.length} 份来源未用于 AI：可能未授权、版本已变更，或个人草稿尚未主动分享。未把读取失败当作没有成果。</p><Button size="sm" variant="outline" onClick={() => setContextRetry((value) => value + 1)}>重新读取材料</Button></div>}</details>}
    {purpose !== "report" && sharedContextRefs.length > 0 && <details className="border-b border-border px-4 py-2 text-12 text-muted-foreground" data-testid="aidt-chat-shared-context"><summary className="cursor-pointer">小组已保存材料 · {sharedContext.status === "loading" ? "读取中" : `${sharedContext.items.length} 份`}</summary><p className="mt-2">本次选择下列服务器版本，实际采用情况以运行来源回执为准；保存不等于小组确认或证据核实。本页尚未保存的修改不会自动传入。</p>{sharedContext.items.map((item) => <details key={item.stageNumber} className="mt-2 rounded-md border border-border p-2"><summary className="cursor-pointer">第 {item.stageNumber} 步 · V{item.revision} · 已保存，尚未确认{item.truncated ? " · 内容已截断" : ""}</summary><pre aria-label={`第${item.stageNumber}步已保存内容摘要`} className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-12">{aidtSharedContextPreview(item)}</pre><p className="mt-2 text-11">以上是已保存内容摘要，可能省略选择理由、报告等字段。下方为页面读取的已保存文本预览；引用材料与学生解释仍需核对。</p><details className="mt-2"><summary className="cursor-pointer">查看页面回读的已保存文本</summary><pre aria-label={`第${item.stageNumber}步页面回读的已保存文本`} className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-12">{item.draftText}</pre>{item.truncated && <p className="mt-1 text-11">这是页面预览的截断片段；实际运行截断情况见来源回执。</p>}</details></details>)}{sharedContext.issues.length > 0 && <div role="status" className="mt-2"><p>{sharedContext.issues.length} 份页面预览未读取：可能读取失败、无权限或未找到精确版本。实际采用情况见本轮材料回执。</p><Button size="sm" variant="outline" onClick={() => setContextRetry((value) => value + 1)}>重新读取小组材料</Button></div>}</details>}
    {purpose !== "report" && returnRevision != null && <details className="border-b border-border px-4 py-2 text-12 text-muted-foreground" data-testid="aidt-chat-return-context"><summary className="cursor-pointer">历史返工反思 · {returnContext.status === "loading" ? "读取中" : returnContext.status === "ready" ? `第6步 V${returnContext.items[0]?.revision}` : "尚未带入AI"}</summary><p className="mt-2">仅参考与本步匹配的已保存历史修订。编辑者确认不代表全组同意或证据已核实；学生保有方向选择与讨论主导权。</p>{returnContext.items.map((item) => <div key={item.revision} className="mt-2"><p>第6步 V{item.revision} → 第{item.targetStage}步{item.truncated ? " · 内容已截断" : ""}</p><p className="mt-1">原问题来源（学生记录，尚未核实）：{item.questionSourceStageRevision == null ? "未绑定共享版本" : `第5步 V${item.questionSourceStageRevision}`}；不替换为当前第5步版本。</p><pre aria-label="AI参考的历史返工反思" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-12">{JSON.stringify(item.fields, null, 2)}</pre></div>)}{returnContext.issues.length > 0 && <div role="status" className="mt-2"><p>这份反思尚未用于AI：可能读取失败、无权限、修订不匹配，或学生尚未确认返回本步。请核对第6步历史后重试；所选反思不可用时本次发送不会降级丢弃它。</p><Button size="sm" variant="outline" onClick={() => setReturnRetry((value) => value + 1)}>重新读取返工反思</Button></div>}</details>}
    {purpose === "report" && session?.currentOrgId && session.userId && session.sessionToken && <AidtSummaryChatContext scope={{ projectId, orgId: session.currentOrgId, userId: session.userId, sessionToken: session.sessionToken, lifecycleKey: requestScope }} threadId={current.value.threadId} onSelectorChange={selectSummary} />}
    {session?.sessionToken && <AidtRunContextReceipt projectId={projectId} threadId={current.value.threadId} runId={acceptedRun?.scope === requestScope ? acceptedRun.runId : null} sessionToken={session.sessionToken} lifecycleKey={requestScope} expected={purpose === "report" ? {purpose:"summary"} : {purpose:"stage",stageId:step.id as 1|2|3|4|5|6}} />}
    <CopilotKitV2Shell key={current.value.threadId} initialThreadId={current.value.threadId} projectId={projectId} singleConversation threadPath={path} threadFromLocation={fromLocation} projectReturnHref={aidtHref(projectId)} emptyState={() => purpose === "report" ? <div className="p-6 text-13 text-muted-foreground" data-testid="aidt-summary-empty">先读取本组报告材料，再审阅并发送生成请求；这里仍使用现有Chat输入框。</div> : <AidtChatEmptyState step={step} />} />
    </div>
  </CopilotKitV2Providers></CopilotKitV2AgentSelectionProvider></ChatHostNavigationProvider></HostRunContextProvider>;
}
