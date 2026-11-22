"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtSyntheticAudioTranscription } from "./aidt-synthetic-audio-transcription";
import { readAidtStage } from "../lib/live-aidt-stages";
import { readAidtResearchMaterial } from "../lib/aidt-research-materials";
import { readAidtInterviewMaterials, readAidtInterviews, isAidtObservation } from "../lib/aidt-interviews";
import { aidtInterviewSyntheticAsrSlotId, aidtInterviewSyntheticAsrSourceKey, aidtReviewedInterviewSyntheticAsr, readAidtSavedInterviewSyntheticAsr, saveAidtInterviewSyntheticAsr, aidtInterviewSyntheticAsrLines } from "../lib/aidt-interview-synthetic-asr";
import { verifySavedAidtAudioTranscription, type AidtReviewedAudioTranscription } from "../lib/aidt-synthetic-audio-transcription";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtSavedSyntheticAsrReportPrint } from "./aidt-saved-synthetic-asr-report-print";

type Props = { projectId: string; entityId: string; materialKey: string; draft: AidtUiStageDraft;
  saveDraft?: (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean> };

/** Placement only. The native Chat contribution owns the state and guarded actions. */
export function AidtInterviewSyntheticAsrSlot({ projectId, entityId, materialKey }: Pick<Props, "projectId" | "entityId" | "materialKey">) {
  return <div id={aidtInterviewSyntheticAsrSlotId(projectId, entityId, materialKey)} data-aidt-asr-project={projectId} data-aidt-asr-entity={entityId} data-aidt-asr-material={materialKey} />;
}

/** One owned container survives material-tab detach/re-attach without rebuilding the ASR request. */
export function AidtInterviewSyntheticAsrPortal(props: Props) {
  const [container] = React.useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  const slotId = aidtInterviewSyntheticAsrSlotId(props.projectId, props.entityId, props.materialKey);
  React.useEffect(() => {
    if (!container) return;
    const attach = () => {
      const target = document.getElementById(slotId);
      if (target?.dataset.aidtAsrProject === props.projectId && target.dataset.aidtAsrEntity === props.entityId && target.dataset.aidtAsrMaterial === props.materialKey && container.parentElement !== target) target.append(container);
    };
    const observer = new MutationObserver(records => { if (!records.every(record => container.contains(record.target))) attach(); });
    observer.observe(document.body, { childList: true, subtree: true }); attach();
    return () => { observer.disconnect(); container.remove(); };
  }, [container, slotId, props.projectId, props.entityId, props.materialKey]);
  return container ? createPortal(<InterviewSyntheticAsr {...props} />, container) : null;
}

function InterviewSyntheticAsr({ projectId, entityId, materialKey, draft, saveDraft }: Props) {
  const session = useOptionalSession()?.session;
  const native = React.useContext(ChatHostTextActionContext);
  const record = readAidtInterviews(draft.fields).find(item => item.id === entityId);
  const recordLabel = record && isAidtObservation(record) ? "观察" : "访谈";
  const sourceKey = aidtInterviewSyntheticAsrSourceKey(draft, entityId, projectId, materialKey);
  const material = readAidtInterviewMaterials(draft.fields, entityId, projectId).find(item => item.key === materialKey)?.reference;
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId, entityId, materialKey, sourceKey, native?.threadId]);
  const latest = React.useRef({ scope, draft }); latest.current = { scope, draft };
  const alive = React.useRef(true), busy = React.useRef<AbortController | null>(null);
  const [buffer, setBuffer] = React.useState<{ scope: string; value: AidtReviewedAudioTranscription; previousTranscript: string | null } | null>(null);
  const [replace, setReplace] = React.useState(false);
  const [saving, setSaving] = React.useState(false), [status, setStatus] = React.useState("");
  const [proof, setProof] = React.useState<"unchecked" | "checking" | "verified" | "failed">("unchecked");
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; busy.current?.abort(); }; }, []);
  React.useEffect(() => { busy.current?.abort(); busy.current = null; setSaving(false); setProof("unchecked"); setReplace(false); setBuffer(null); setStatus(""); }, [scope]);
  const editable = buffer?.scope === scope ? buffer : null;
  const saved = readAidtSavedInterviewSyntheticAsr(draft, entityId, projectId);
  const savedForMaterial = saved && material && saved.audio.artifactId === material.artifactId && saved.audio.versionId === material.versionId && saved.audio.sha256 === material.sha256 ? saved : null;
  const savedKey = savedForMaterial ? JSON.stringify(savedForMaterial) : "";
  React.useEffect(() => setProof("unchecked"), [savedKey]);
  const isCurrent = (expected: string) => alive.current && latest.current.scope === expected;
  const transcriptRaw = (value: AidtUiStageDraft) => value.fields["interviewTranscript:" + entityId] ?? null;
  async function readCurrentSource(signal: AbortSignal): Promise<string | null> {
    if (!sourceKey || !session?.sessionToken) return null;
    const expected = scope;
    const { stage } = await readAidtStage(projectId, 2, session.sessionToken, signal);
    if (!stage || aidtInterviewSyntheticAsrSourceKey(stage.content.draft, entityId, projectId, materialKey) !== sourceKey) return null;
    const source = readAidtInterviewMaterials(stage.content.draft.fields, entityId, projectId).find(item => item.key === materialKey)?.reference;
    if (!source) return null;
    await readAidtResearchMaterial({ projectId, sessionToken: session.sessionToken, signal }, source);
    return !signal.aborted && isCurrent(expected) ? sourceKey : null;
  }
  const save = async () => {
    if (!editable || !replace || !saveDraft || !sourceKey || !material || busy.current || !session?.sessionToken || !editable.value.reviewedText.trim() || editable.value.reviewedText.length > 1700) return;
    const abort = new AbortController(); busy.current = abort; setSaving(true); setStatus("");
    const expected = scope, value = editable.value;
    try {
      if (await readCurrentSource(abort.signal) !== sourceKey || !isCurrent(expected) || transcriptRaw(latest.current.draft) !== editable.previousTranscript) throw new Error("SOURCE_CHANGED");
      if (!await verifySavedAidtAudioTranscription({ projectId, entityId, audioSource: value.audioSource, nativeAudio: value.nativeAudio, transcript: value.transcript }, session.sessionToken, abort.signal)) throw new Error("ASR_PROOF_UNAVAILABLE");
      const { stage } = await readAidtStage(projectId, 2, session.sessionToken, abort.signal);
      if (!stage || !isCurrent(expected) || abort.signal.aborted || aidtInterviewSyntheticAsrSourceKey(stage.content.draft, entityId, projectId, materialKey) !== sourceKey || transcriptRaw(stage.content.draft) !== editable.previousTranscript) throw new Error("TRANSCRIPT_CHANGED");
      const pin = aidtReviewedInterviewSyntheticAsr({ ...value, reviewedText: value.reviewedText.trim() });
      let accepted = false;
      const ok = await saveDraft(old => {
        if (!isCurrent(expected) || aidtInterviewSyntheticAsrSourceKey(old, entityId, projectId, materialKey) !== sourceKey || transcriptRaw(old) !== editable.previousTranscript) return old;
        const next = saveAidtInterviewSyntheticAsr(old, entityId, projectId, materialKey, pin); accepted = next !== old; return next;
      });
      if (!isCurrent(expected)) return;
      if (!ok || !accepted) throw new Error("SAVE_NOT_CONFIRMED");
      setBuffer(null); setReplace(false); setProof("unchecked"); setStatus("合成转写摘录已保存为待校对记录。请在下方确认原件、定位和摘录，再独立勾选校对；尚未确认人物发现卡。");
    } catch { if (isCurrent(expected) && !abort.signal.aborted) setStatus("未保存：原件、权限、实际转写或当前摘录版本无法核对。独立草稿保留，请核对后重试。"); }
    finally { if (busy.current === abort) { busy.current = null; if (alive.current) setSaving(false); } }
  };
  const recheck = async () => {
    if (!savedForMaterial || !material || !session?.sessionToken || busy.current) return;
    const abort = new AbortController(); busy.current = abort; setProof("checking"); const expected = scope;
    try {
      const current = await readCurrentSource(abort.signal);
      const valid = current === sourceKey && await verifySavedAidtAudioTranscription({ projectId, entityId, audioSource: material, nativeAudio: savedForMaterial.nativeAudio, transcript: savedForMaterial.transcript }, session.sessionToken, abort.signal);
      if (isCurrent(expected) && !abort.signal.aborted) setProof(valid ? "verified" : "failed");
    } catch { if (isCurrent(expected) && !abort.signal.aborted) setProof("failed"); }
    finally { if (busy.current === abort) busy.current = null; }
  };
  return <section className="space-y-3" aria-label={`${recordLabel}合成音频转写`}>
    {sourceKey && !editable && <details className="text-12"><summary className="cursor-pointer">合成音频文件转写（软件验收）</summary><div className="mt-3"><AidtSyntheticAudioTranscription projectId={projectId} entityId={entityId} audioSource={material ?? null} sourceKey={sourceKey}
      enabled={!!sourceKey} readCurrentSource={readCurrentSource} onReviewed={value => { if (!isCurrent(scope) || !sourceKey) throw new Error("SOURCE_CHANGED"); setBuffer({ scope, value, previousTranscript: transcriptRaw(latest.current.draft) }); setReplace(false); setStatus(""); }} /></div></details>}
    {editable && <section className="space-y-3 rounded-xl border border-border p-4" aria-label={`待保存的${recordLabel}合成转写`}><p className="text-12 text-muted-foreground">仅本页独立草稿，未写入{recordLabel}摘录。合成材料不是真人原话或研究已经验证的证据。</p>
      <label className="block text-13">校对后的合成摘录<textarea className="mt-1 w-full rounded-control border border-border bg-background p-2" rows={4} maxLength={1700} value={editable.value.reviewedText} disabled={saving} onChange={event => { const reviewedText = event.currentTarget.value; setBuffer(old => old ? { ...old, value: { ...old.value, reviewedText } } : old); setReplace(false); }} /></label>
      <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={replace} disabled={saving} onChange={event => setReplace(event.currentTarget.checked)} /><span>已对照原件或合成基准内容核对，同意将这段文字保存为本{recordLabel}的待校对摘录；原音保留，已有摘录若存在将被替换。</span></label>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={saving || !saveDraft || !replace || !editable.value.reviewedText.trim()} onClick={() => void save()}>{saving ? "核对实际来源…" : `保存${recordLabel}合成转写摘录`}</Button><Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setBuffer(null)}>取消，保留原摘录</Button></div>
    </section>}
    {status && <p role="status" className="text-12">{status}</p>}
    {savedForMaterial && <AidtSavedSyntheticAsrReportPrint projectId={projectId} stageId={2} entityId={entityId} materialKey={materialKey} draft={draft} />}
    {savedForMaterial && <details className="text-12"><summary className="cursor-pointer">已保存合成 ASR 来源（{proof === "verified" ? "本次已核对" : proof === "checking" ? "核对中" : "尚待重新核对"}）</summary><div className="mt-2 space-y-1 break-all">{aidtInterviewSyntheticAsrLines(draft, entityId, projectId).map(line => <p key={line}>{line}</p>)}</div><Button type="button" size="xs" variant="outline" disabled={proof === "checking"} onClick={() => void recheck()}>重新核对实际转写来源</Button>{proof === "failed" && <p role="status">当前来源无法核对，不能据此称为已验证的转写或真人证据。</p>}</details>}
  </section>;
}
