"use client";

import * as React from "react";
import { readAidtCandidateReply } from "../lib/read-aidt-candidate-reply";
import { Button } from "@/components/ui/button";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { useOptionalSession } from "@/components/session/session-provider";
import { isAidtCandidateRequest } from "@repo/contracts/aidt-candidate-request";
import { applyInterviewDiscoveryCandidate, interviewDiscoveryPrompt, interviewDiscoverySource, readInterviewDiscoveryCandidates, type InterviewDiscoveryTurn } from "../lib/aidt-interview-discovery";
import { getAidtInterviewFinding, isAidtObservation, type AidtInterview } from "../lib/aidt-interviews";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { readAidtStage } from "../lib/live-aidt-stages";

type Request = { id: string; scope: string; source: string; prompt: string; threadId: string; prior: ReadonlySet<string>; settled: boolean };
type Preview = { request: Request; messageId: string; replyText: string; candidates: string[] };

/** Transient proposals: a canceled, changed or unrelated turn can never replace a discovery card. */
export function AidtInterviewDiscoveryCandidates({ projectId, interview, draft, messages, loading, running, saveDraft }: {
  projectId: string; interview: AidtInterview; draft: AidtUiStageDraft; messages: readonly InterviewDiscoveryTurn[]; loading: boolean; running: boolean;
  saveDraft?: (mutate: (previous: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
}) {
  const observation = isAidtObservation(interview);
  const action = React.useContext(ChatHostTextActionContext);
  const session = useOptionalSession()?.session;
  const source = interviewDiscoverySource(draft, projectId, interview.id);
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, projectId, interview.id, action?.threadId]);
  const latest = React.useRef({ scope, source, draft });
  latest.current = { scope, source, draft };
  const requestRef = React.useRef<Request | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(true);
  const [pending, setPending] = React.useState(false);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [choice, setChoice] = React.useState<number | null>(null);
  const [replace, setReplace] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [applying, setApplying] = React.useState(false);
  const [local, setLocal] = React.useState<{ request: Request; messageId: string; headline: string; expectedHeadline: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const reset = React.useCallback(() => {
    requestRef.current = null; controller.current?.abort(); controller.current = null;
    setPending(false); setPreview(null); setChoice(null); setReplace(false);
  }, []);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestRef.current = null; controller.current?.abort(); }; }, []);
  React.useEffect(() => { reset(); setStatus(""); }, [scope, source, reset]);

  const isCurrent = (request: Request) => mounted.current && requestRef.current === request && latest.current.scope === request.scope && latest.current.source === request.source;
  const sameSavedSource = async (request: Request, signal: AbortSignal) => {
    if (!session?.sessionToken) return false;
    const { stage } = await readAidtStage(projectId, 2, session.sessionToken, signal);
    return !!stage && interviewDiscoverySource(stage.content.draft, projectId, interview.id) === request.source && isCurrent(request);
  };
  const hasStudent = messages.some(turn => turn.role === "user" && typeof turn.content === "string" && turn.content.trim() && !isAidtCandidateRequest(turn.content, "interview"));
  const unavailable = !source ? "先在资料中保存并校对本次访谈摘录，确认文字授权。" : !hasStudent ? "先在本次对话中写下你的观察或发现。" : action?.occupied ? "输入框还有草稿或附件，请先处理，再归纳发现。" : !action || action.projectId !== projectId || !action.threadId ? "本次访谈对话尚未就绪。" : "";

  const start = async () => {
    if (requestRef.current || unavailable || !source || !action?.available || !action.threadId || loading || running) return;
    const id = crypto.randomUUID();
    const request: Request = { id, scope, source, prompt: interviewDiscoveryPrompt(interview.id, id, observation), threadId: action.threadId, prior: new Set(messages.map(turn => turn.id)), settled: false };
    requestRef.current = request; setPending(true); setPreview(null); setChoice(null); setReplace(false); setStatus("正在核对本次访谈材料…");
    const abort = new AbortController(); controller.current = abort;
    try {
      if (!await sameSavedSource(request, abort.signal)) { if (isCurrent(request)) { reset(); setStatus("材料有未保存修改或授权已改变。请保存并核对后重试。"); } return; }
      if (!isCurrent(request)) return;
      setStatus("正在归纳可供你选择的发现…");
      const sent = await action.sendText(request.prompt);
      if (!isCurrent(request)) return;
      request.settled = true;
      if (!sent) { reset(); setStatus("未取得可用回复。请查看本次对话的状态，再重试。"); }
      else setPending(false);
    } catch { if (isCurrent(request)) { reset(); setStatus("暂时无法核对或归纳。原内容已保留，可以重试或继续手填。"); } }
  };

  React.useEffect(() => {
    const request = requestRef.current;
    if (!request?.settled || loading || running || action?.running || !isCurrent(request)) return;
    if (action?.failed) { reset(); setStatus("本轮对话未完成，请查看聊天中的错误后再重试。"); return; }
    const position = messages.findIndex(turn => turn.role === "user" && turn.content === request.prompt);
    if (position < 0) return;
    const after = messages.slice(position + 1);
    if (after.some(turn => turn.role === "user")) { reset(); setStatus("对话已有新一轮内容，请重新归纳当前发现。"); return; }
    if (preview) return;
    const reply = after.findLast(turn => turn.role === "assistant" && !request.prior.has(turn.id) && typeof turn.content === "string" && turn.content.trim());
    if (!reply || typeof reply.content !== "string") { setStatus("尚未取得完整候选。请查看对话；可以取消后重试或手填。"); return; }
    const candidates = readInterviewDiscoveryCandidates(reply.content);
    setPending(false);
    if (!candidates.length) { reset(); setStatus("这次回复没有可选发现。请按对话补充材料，再重试；也可以继续手填。"); return; }
    setPreview({ request, messageId: reply.id, replyText: reply.content, candidates }); setStatus("");
  }, [messages, loading, running, action?.running, action?.failed, pending, preview, reset]);

  const apply = async () => {
    if (!preview || choice === null || applying || !isCurrent(preview.request)) return;
    const position = messages.findIndex(turn => turn.role === "user" && turn.content === preview.request.prompt);
    const after = position < 0 ? [] : messages.slice(position + 1);
    if (position < 0 || after.some(turn => turn.role === "user") || !after.some(turn => turn.id === preview.messageId && turn.role === "assistant" && turn.content === preview.replyText)) { reset(); setStatus("候选对应的对话已改变，请重新归纳。"); return; }
    const headline = getAidtInterviewFinding(latest.current.draft, interview).headline;
    if (headline.trim() && !replace) return;
    const selected = preview.candidates[choice];
    if (!selected) return;
    setApplying(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      if (!await sameSavedSource(preview.request, abort.signal)) { if (isCurrent(preview.request)) { reset(); setStatus("访谈材料或授权已改变，请重新核对后归纳。"); } return; }
      if (!isCurrent(preview.request) || getAidtInterviewFinding(latest.current.draft, interview).headline !== headline) { setStatus("发现已被编辑，请重新选择是否替换。"); setReplace(false); return; }
      if (!session?.sessionToken) return;
      const durable = await readAidtCandidateReply({ projectId, threadId: preview.request.threadId, prompt: preview.request.prompt, replyText: preview.replyText, sessionToken: session.sessionToken, signal: abort.signal });
      if (!isCurrent(preview.request)) return;
      setLocal({ request: preview.request, messageId: durable.messageId, headline: selected, expectedHeadline: headline });
      reset(); setStatus("已填入下方独立的 AI 表达草稿，尚未保存。可继续编辑或放弃。");
    } catch { if (isCurrent(preview.request)) setStatus("无法核对当前权限，未更改内容。请稍后重试。"); }
    finally { if (mounted.current) setApplying(false); }
  };
  const saveLocal = async () => {
    if (!local || !saveDraft || saving || running || action?.running || !local.headline.trim() || local.headline.length > 500
      || latest.current.scope !== local.request.scope || latest.current.source !== local.request.source) return;
    setSaving(true); setStatus("");
    const abort = new AbortController(); controller.current = abort;
    try {
      if (!session?.sessionToken) return;
      const { stage } = await readAidtStage(projectId, 2, session.sessionToken, abort.signal);
      if (!mounted.current || abort.signal.aborted) return;
      if (!stage || interviewDiscoverySource(stage.content.draft, projectId, interview.id) !== local.request.source
        || latest.current.scope !== local.request.scope || latest.current.source !== local.request.source
        || getAidtInterviewFinding(stage.content.draft, interview).headline !== local.expectedHeadline) {
        setStatus("来源、授权或已保存的发现已改变。独立草稿仍保留，请先核对最新内容。"); return;
      }
      const selection = { projectId, entityId: interview.id, source: local.request.source, threadId: local.request.threadId,
        messageId: local.messageId, requestId: local.request.id, headline: local.headline.trim(), expectedHeadline: local.expectedHeadline };
      let accepted = false;
      const saved = await saveDraft(old => {
        const next = applyInterviewDiscoveryCandidate(old, selection);
        accepted = next !== old;
        return next;
      });
      if (!mounted.current) return;
      if (!saved || !accepted) { setStatus("发现草稿尚未保存，本地文字保留，请核对版本或权限后重试。"); return; }
      setLocal(null); setStatus("发现草稿已保存，尚未确认。请核对原话和来源，再按原流程确认发现卡。");
    } catch { if (mounted.current && !abort.signal.aborted) setStatus("保存未完成，独立草稿仍保留。请核对后重试。"); }
    finally { if (mounted.current) setSaving(false); }
  };
  const hasHeadline = !!local?.headline.trim() || !!getAidtInterviewFinding(draft, interview).headline.trim();
  return <section aria-label="AI 归纳发现" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4" data-testid="aidt-interview-discovery-candidates">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-13 font-medium">{observation ? "从观察中整理发现" : "从访谈中整理发现"}</h4><p className="mt-1 text-12 text-muted-foreground">AI 提供表达候选，由你判断和修改。也可以直接填写下方卡片。</p></div>
      <Button type="button" size="sm" variant="outline" disabled={!!local || saving || !!unavailable || !action?.available || loading || running || pending || !!requestRef.current} onClick={() => void start()}>AI 归纳发现</Button></div>
    {unavailable && <p className="text-12 text-muted-foreground">{unavailable}</p>}
    {status && <p role="status" className="text-12 text-muted-foreground">{status}</p>}
    {preview && <div className="space-y-3"><p className="text-12 text-muted-foreground">{interview.code} · {observation ? "当前观察对话" : "当前访谈对话"} · AI 概括草稿，不是受访者原话</p>
      <fieldset className="space-y-2" disabled={applying}><legend className="sr-only">选择一句发现</legend>{preview.candidates.map((text, index) => <label key={text} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-background p-3 text-13"><input className="mt-1" type="radio" name={`finding-candidate-${interview.id}`} checked={choice === index} onChange={() => { setChoice(index); setReplace(false); }} /><span>{text}</span></label>)}</fieldset>
      {hasHeadline && <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={replace} disabled={applying} onChange={event => setReplace(event.currentTarget.checked)} /><span>用所选表达替换当前“一句发现”，其余内容保留</span></label>}
      <Button type="button" size="sm" disabled={choice === null || applying || hasHeadline && !replace} onClick={() => void apply()}>{applying ? "核对中…" : "填入草稿"}</Button>
    </div>}
    {requestRef.current && <Button type="button" size="sm" variant="ghost" disabled={applying} onClick={() => { reset(); setStatus("已取消采用候选。对话请求若已发出仍会完成，原卡片内容保留。"); }}>保留原内容，取消</Button>}
    {local && <section className="space-y-3 border-t border-border pt-3" aria-label="独立 AI 表达草稿">
      <label className="block text-13">AI 辅助的一句发现<textarea className="mt-1 w-full rounded-control border border-border bg-background p-2" rows={3} value={local.headline} maxLength={500} disabled={saving} onChange={event => { const headline = event.currentTarget.value; setLocal(old => old ? { ...old, headline } : old); }} /></label>
      <p className="text-12 text-muted-foreground">此处编辑仅保存在当前页面，尚未改变小组发现卡。原话、具体情况与来源保留；确认发现卡仍需按原流程核对。</p>
      {!saveDraft && <p role="status" className="text-12">当前保存通道尚未就绪，文字保留。</p>}
      {(local.request.source !== source || local.request.scope !== scope) && <p role="status" className="text-12">当前来源已改变，本地表达保留，暂不写入小组。</p>}
      <div className="flex gap-2"><Button type="button" size="sm" disabled={!saveDraft || saving || running || action?.running || !local.headline.trim() || local.request.source !== source || local.request.scope !== scope} onClick={() => void saveLocal()}>{saving ? "保存中…" : "保存发现草稿"}</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setLocal(null)}>保留原卡片，放弃此草稿</Button></div>
    </section>}
  </section>;
}
