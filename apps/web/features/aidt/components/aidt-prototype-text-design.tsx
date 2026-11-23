"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalSession } from "@/components/session/session-provider";
import { readAidtStageRevision, listAidtStageHistory, type AidtSharedStage } from "../lib/live-aidt-stages";
import { readAidtPrototypeEntityDraft, readAidtPrototypeInputSelection, updateAidtPrototypeEntityDraft } from "../lib/aidt-prototype-handoff";
import { AIDT_PROTOTYPE_TEXT_MAX_CHARS, confirmAidtPrototypeText, editAidtPrototypeText, isAidtPrototypeTextConfirmed, readAidtPrototypeLineage, readAidtPrototypeTextConfirmation } from "../lib/aidt-prototype-text-state";
import { aidtPrototypeSourceFailure, loadAidtPrototypeTextSources, type AidtPrototypeSources } from "../lib/aidt-prototype-text-sources";
import { previewAidtText } from "../lib/aidt-print-preview";
import { AidtResearchMaterialPreview } from "./aidt-research-material";
import { AidtPrototypeTextCandidates } from "./aidt-prototype-text-candidates";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Props = { projectId: string; designId: string; stageDraft: AidtUiStageDraft; savedStage?: AidtSharedStage;
  matchesServer: boolean; readOnly: boolean; update: (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void; requestSave: () => void;
  messages?: readonly { id: string; role: string; content?: unknown }[]; loading?: boolean; running?: boolean };
const empty: AidtUiStageDraft = { fields: {}, ideas: [], selectedIdeaId: "" };

/** Formal text is saved by the existing S5 save action; history is the real
 * project stage revision history, never a local counter or a Chat transcript. */
export function AidtPrototypeTextDesign(props: Props) {
  const session = useOptionalSession()?.session;
  const requested = useSearchParams()?.get("textRevision") ?? null;
  const scope = JSON.stringify([props.projectId, props.designId, session?.currentOrgId, session?.userId, session?.sessionToken, requested]);
  return <TextDesign key={scope} {...props} scope={scope} requested={requested} sessionToken={session?.sessionToken} />;
}

function TextDesign({ projectId, designId, stageDraft, savedStage, matchesServer, readOnly, update, requestSave, scope, requested, sessionToken, messages = [], loading = false, running = false }: Props & { scope: string; requested: string | null; sessionToken?: string }) {
  const [historical, setHistorical] = React.useState<{ stage?: AidtSharedStage; error?: string }>();
  const [sourceState, setSourceState] = React.useState<{ key: string; value?: AidtPrototypeSources; error?: string }>();
  const [reload, refresh] = React.useReducer(value => value + 1, 0);
  const [history, setHistory] = React.useState<{ items: AidtSharedStage[]; next: number | null; failed?: boolean }>();
  const [showHistory, setShowHistory] = React.useState(false);
  const [historyBusy, setHistoryBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const historic = requested !== null;
  const viewStage = historic ? historical?.stage : savedStage?.projectId === projectId ? savedStage : undefined;
  const draft = readAidtPrototypeEntityDraft(historic ? viewStage?.content.draft ?? empty : stageDraft, designId) ?? empty;
  const selection = readAidtPrototypeInputSelection(draft);
  const lineage = readAidtPrototypeLineage(draft);
  const sourceKey = JSON.stringify([scope, draft.fields.prototypeIdeaSource, draft.fields.prototypeTextLineage, reload]);
  const sources = sourceState?.key === sourceKey ? sourceState : undefined;
  const readable = !!sources?.value && !sources.value.restricted;
  const text = draft.fields.prototypeTextDesign ?? "";
  const confirmed = isAidtPrototypeTextConfirmed(draft);
  const confirmation = readAidtPrototypeTextConfirmation(draft);
  const savedDraft = savedStage?.projectId === projectId ? readAidtPrototypeEntityDraft(savedStage.content.draft, designId) : null;
  const editable = !historic && !readOnly && draft.fields.prototypeArchived !== "true";
  const versionHref = (revision?: number) => `/aidt/${encodeURIComponent(projectId)}?${new URLSearchParams({ step: "5", entity: designId, ...(revision ? { textRevision: String(revision) } : {}) })}`;
  const lifecycle = JSON.stringify([scope, sourceKey, readable, sources?.value, text, viewStage?.revision]);
  const current = React.useRef(lifecycle); current.current = lifecycle;
  const live = React.useRef(true);
  React.useEffect(() => { live.current = true; return () => { live.current = false; current.current = "unmounted"; }; }, []);
  React.useEffect(() => {
    if (!historic || !sessionToken) return;
    const controller = new AbortController();
    if (!requested || !/^[1-9]\d*$/.test(requested) || !Number.isSafeInteger(Number(requested))) {
      setHistorical({ error: "文字设计版本链接无效；未改用当前稿。" }); return () => controller.abort();
    }
    void readAidtStageRevision(projectId, 5, Number(requested), sessionToken, controller.signal).then(stage => {
      if (controller.signal.aborted) return;
      const stored = stage && readAidtPrototypeEntityDraft(stage.content.draft, designId);
      setHistorical(stage?.projectId === projectId && stored?.fields.prototypeTextDesign
        ? { stage } : { error: "此确切版本没有可读取的文字设计；未替换成最新稿。" });
    }).catch(() => { if (!controller.signal.aborted) setHistorical({ error: "无法读取这个保存版本；请核对访问权限。" }); });
    return () => controller.abort();
  }, [designId, historic, projectId, requested, sessionToken]);
  React.useEffect(() => {
    const controller = new AbortController();
    setSourceState(undefined);
    if (!sessionToken || !selection) return () => controller.abort();
    void loadAidtPrototypeTextSources({ projectId, sessionToken, selection, lineage: lineage ?? undefined, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setSourceState({ key: sourceKey, value }); })
      .catch(error => { if (!controller.signal.aborted) setSourceState({ key: sourceKey, error: aidtPrototypeSourceFailure(error) }); });
    return () => controller.abort();
    // sourceKey includes the exact selected revision and serialized frozen lineage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sessionToken, sourceKey]);
  React.useEffect(() => {
    const recheck = () => { current.current = "rechecking-access"; setSourceState(undefined); refresh(); };
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, []);

  const change = (mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) => update(old => updateAidtPrototypeEntityDraft(old, designId, mutate));
  function saveText() {
    if (!editable || !readable || !sources?.value || !text.trim()) return;
    const serialized = JSON.stringify(sources.value.lineage);
    if (serialized.length > 6000) { setNotice("来源引用超过单项保存上限；请减少本轮组合的点子或分成不同原型。"); return; }
    change(old => old.fields.prototypeIdeaSource === draft.fields.prototypeIdeaSource && old.fields.prototypeTextVersion === draft.fields.prototypeTextVersion
      ? { ...old, fields: { ...old.fields, prototypeTextRequired: "true", prototypeTextLineage: serialized,
        prototypeTextConfirmation: old.fields.prototypeTextLineage === serialized ? old.fields.prototypeTextConfirmation ?? "" : "" } } : old);
    requestSave(); setNotice("正在请求保存文字设计；以小组保存回执为准。");
  }
  function confirmText() {
    if (!editable || !selection?.brainstormId || !readable || !matchesServer || !savedStage || !savedDraft || savedDraft.fields.prototypeTextDesign !== text
      || savedDraft.fields.prototypeTextVersion !== draft.fields.prototypeTextVersion) return;
    const next = confirmAidtPrototypeText(savedDraft, projectId, designId, savedStage.revision);
    if (!next) { setNotice("请先保存文字与来源，再确认；文字或来源过长时需精简后保存。"); return; }
    change(old => old.fields.prototypeTextDesign === text && old.fields.prototypeIdeaSource === savedDraft.fields.prototypeIdeaSource
      && old.fields.prototypeTextLineage === savedDraft.fields.prototypeTextLineage
      ? { ...old, fields: { ...old.fields, prototypeTextRequired: "true", prototypeTextConfirmation: next.fields.prototypeTextConfirmation!,
        prototypeTextConfirmedText: next.fields.prototypeTextConfirmedText!, prototypeTextConfirmedLineage: next.fields.prototypeTextConfirmedLineage!, aidtPrototypeConfirmedHandoff: "" } } : old);
    requestSave();
  }
  async function loadHistory(beforeRevision?: number) {
    if (!sessionToken || historyBusy) return;
    setHistoryBusy(true);
    const identity = current.current;
    try {
      const page = await listAidtStageHistory(projectId, 5, sessionToken, { limit: 20, beforeRevision });
      if (!live.current || current.current !== identity) return;
      setHistory(old => ({ items: beforeRevision ? [...(old?.items ?? []), ...page.items] : page.items, next: page.nextBeforeRevision }));
    } catch { if (live.current && current.current === identity) setHistory(old => ({ items: old?.items ?? [], next: old?.next ?? null, failed: true })); }
    finally { if (live.current) setHistoryBusy(false); }
  }
  async function print() {
    if (!readable || !viewStage || !text.trim() || !sessionToken || !selection) return;
    const identity = current.current;
    try {
      const access = await loadAidtPrototypeTextSources({ projectId, sessionToken, selection, lineage: lineage ?? undefined });
      if (current.current !== identity || access.restricted) throw new Error("AIDT_CONTEXT_CHANGED");
      const result = await previewAidtText(text, `文字设计 · 第 5 步 V${viewStage.revision}`, { isCurrent: () => live.current && current.current === identity });
      if (current.current === identity && result === "print-requested") setNotice("已请求系统打印／另存为 PDF；是否保存文件请以系统回执为准。");
    } catch { if (current.current === identity) setNotice("无法预览文字设计；请重新核对当前保存版本与权限。"); }
  }
  return <section aria-label="文字设计" data-testid="aidt-prototype-text-design" className="space-y-3 rounded-container border border-border p-3 text-13">
    <h3 className="font-semibold">文字设计</h3>
    <p className="text-12 text-muted-foreground">先保存并确认文字设计的确切修订，再制作原型。改稿会失效当前确认；旧文字与旧输出仍保留在各自历史版本中。</p>
    {historic && <><p>查看文字设计 · 第 5 步 V{requested}（只读历史）</p><Link className="text-primary underline" href={versionHref()}>编辑当前文字设计</Link></>}
    {historical?.error && historic && <p role="alert">{historical.error}</p>}
    {!selection ? <p role="status">先选择本轮已确认的点子与版本。</p> : sources?.error ? <p role="alert">{sources.error}</p>
      : !sources?.value ? <p role="status">正在核对每个点子的冻结来源与当前授权…</p>
      : sources.value.restricted ? <p role="alert">研究文字授权已撤回或当前无法核对。保留历史记录，暂不显示、打印或继续制作。</p> : <>
        {!historic && !selection.brainstormId && <p role="status">此原型保留旧来源记录。如需制作新版，请先明确选择一个已确认列表及本轮点子。</p>}
        <details><summary className="cursor-pointer">查看每个点子的来源与缺口</summary>
          {sources.value.items.map(item => <section key={item.ideaId} className="mt-3 space-y-1"><h4 className="font-medium">{item.title}</h4>
            {item.views.map(view => <details key={JSON.stringify(view.reference)}><summary><Link className="text-primary underline" href={view.href}>第 {view.reference.stageId} 步 V{view.reference.revision} · {view.title}</Link></summary><p className="whitespace-pre-wrap break-words">{view.text}</p>{view.image && <AidtResearchMaterialPreview projectId={projectId} reference={view.image} alt={`${item.title} · 第4步 V${view.reference.revision} 冻结描述单图片`} />}</details>)}
            {item.missing.map(message => <p key={message} className="text-muted-foreground">待补：{message}</p>)}
          </section>)}
        </details>
        {editable && <AidtPrototypeTextCandidates key={JSON.stringify([draft.fields.prototypeTextVersion, draft.fields.prototypeIdeaSource, draft.fields.prototypeTextLineage])} projectId={projectId} designId={designId} savedRevision={savedStage?.revision} matchesServer={matchesServer}
          draft={draft} sources={sources.value} messages={messages} loading={loading} running={running} readOnly={readOnly} onAdopt={change} />}
        {editable ? <label className="block space-y-1">可编辑文字设计<Textarea aria-label="可编辑文字设计" value={text} maxLength={AIDT_PROTOTYPE_TEXT_MAX_CHARS} rows={9}
          placeholder="写清怎样组合本轮点子、用户如何操作、关键界面或接触点，以及本轮验证范围。"
          onChange={event => { const value = event.currentTarget.value; change(old => editAidtPrototypeText(old, value, crypto.randomUUID())); setNotice(""); }} /></label>
          : <p className="whitespace-pre-wrap break-words">{text || "这个版本尚未记录文字设计。"}</p>}
        {editable && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!text.trim()} onClick={saveText}>保存文字设计</Button>
          <Button size="sm" variant="outline" disabled={!selection.brainstormId || !matchesServer || !savedDraft?.fields.prototypeTextLineage || !text.trim() || confirmed} onClick={confirmText}>确认已保存文字设计</Button></div>}
        {confirmed && confirmation && <p role="status">学生已确认<Link href={versionHref(confirmation.stageRevision)} className="text-primary underline">文字设计 · 第 5 步 V{confirmation.stageRevision}</Link>{!matchesServer && !historic ? "；确认尚待小组保存回执。" : "。"}</p>}
        {viewStage && text.trim() && (historic || matchesServer) && <Button size="sm" variant="outline" onClick={() => void print()}>预览／打印文字设计</Button>}
      </>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => { setShowHistory(value => !value); if (!showHistory) void loadHistory(); }}>文字设计版本历史</Button>
      <Button size="sm" variant="ghost" onClick={() => { setSourceState(undefined); refresh(); }}>重新核对来源与授权</Button></div>
    {showHistory && <div className="space-y-1" aria-label="文字设计版本历史">{historyBusy && <p role="status">正在读取保存修订…</p>}
      {history?.failed && <p role="alert">历史读取失败；未用当前稿代替。</p>}
      {history?.items.filter(stage => !!readAidtPrototypeEntityDraft(stage.content.draft, designId)?.fields.prototypeTextDesign).map(stage => <p key={stage.revision}><Link className="text-primary underline" href={versionHref(stage.revision)}>文字设计 · 第 5 步 V{stage.revision}</Link></p>)}
      {history?.next && <Button size="sm" variant="ghost" disabled={historyBusy} onClick={() => void loadHistory(history.next!)}>更多保存修订</Button>}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
