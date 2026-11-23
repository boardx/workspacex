"use client";
import * as React from "react";
import type { AidtSavedSyntheticAsr } from "@repo/contracts/aidt-test-research";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtSyntheticAudioTranscription } from "./aidt-synthetic-audio-transcription";
import { verifySavedAidtAudioTranscription, type AidtReviewedAudioTranscription } from "../lib/aidt-synthetic-audio-transcription";
import { aidtSavedSyntheticAsr, aidtSyntheticAsrSourceKey, readAidtSavedSyntheticAsr, saveAidtSyntheticAsr } from "../lib/aidt-test-synthetic-asr";
import { readAidtStage } from "../lib/live-aidt-stages";
import { readAidtTestGroups, type AidtTestGroup } from "../lib/aidt-test-groups";
import { aidtTestResearchPath } from "../lib/aidt-test-research";
import { readAidtResearchMaterial } from "../lib/aidt-research-materials";
import { loadAidtTestResearchContext } from "../lib/aidt-test-prototype-context";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtSavedSyntheticAsrReportPrint } from "./aidt-saved-synthetic-asr-report-print";

export function AidtTestSyntheticAsr({ projectId, group, draft, readOnly, update, requestSave }: {
  projectId: string; group: AidtTestGroup; draft: AidtUiStageDraft; readOnly: boolean;
  update: (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void; requestSave: () => void;
}) {
  const session = useOptionalSession()?.session;
  const actor = JSON.stringify([projectId, session?.currentOrgId, session?.userId, session?.sessionToken, group.id]);
  const sourceKey = aidtTestResearchPath(group) === "offline" && group.audioConsentAt && group.material?.projectId === projectId && group.material.mime.startsWith("audio/") ? aidtSyntheticAsrSourceKey(group) : null;
  const scope = JSON.stringify([actor, sourceKey, readOnly]);
  const latest = React.useRef(scope); latest.current = scope;
  const [buffer, setBuffer] = React.useState<{ scope: string; value: AidtReviewedAudioTranscription } | null>(null);
  const [checked, setChecked] = React.useState(false);
  const [pending, setPending] = React.useState(false), [error, setError] = React.useState("");
  const aborter = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => { aborter.current?.abort(); }, [scope]);
  const editable = buffer?.scope === scope ? buffer : null;
  async function readCurrentSource(signal: AbortSignal) {
    if (!sourceKey || !session?.sessionToken || !session.userId || readOnly) return null;
    const { stage } = await readAidtStage(projectId, 6, session.sessionToken, signal);
    const saved = stage && readAidtTestGroups(stage.content.draft.fields).find(item => item.id === group.id && !item.archived);
    if (!saved || !saved.material || !saved.audioConsentAt || saved.material.projectId !== projectId || aidtTestResearchPath(saved) !== "offline" || aidtSyntheticAsrSourceKey(saved) !== sourceKey) return null;
    await readAidtResearchMaterial({ projectId, sessionToken: session.sessionToken, signal }, saved.material);
    await loadAidtTestResearchContext({ projectId, sessionToken: session.sessionToken, userId: session.userId, signal }, saved);
    return !signal.aborted && latest.current === scope ? sourceKey : null;
  }
  async function save() {
    if (!editable || !checked || pending || readOnly || !session?.sessionToken || !editable.value.reviewedText.trim() || editable.value.reviewedText.length > 1700) return;
    const expected = scope, value = editable.value, controller = new AbortController(); aborter.current = controller;
    setPending(true); setError("");
    try {
      if (await readCurrentSource(controller.signal) !== sourceKey || latest.current !== expected) throw new Error("SOURCE_CHANGED");
      if (!await verifySavedAidtAudioTranscription({ projectId, entityId: group.id, audioSource: value.audioSource, nativeAudio: value.nativeAudio, transcript: value.transcript }, session.sessionToken, controller.signal)) throw new Error("ASR_PROOF_UNAVAILABLE");
      const pin = aidtSavedSyntheticAsr({ ...value, reviewedText: value.reviewedText.trim() });
      if (latest.current !== expected || controller.signal.aborted || saveAidtSyntheticAsr(draft, group, pin) === draft) throw new Error("SAVE_CAPACITY_OR_SOURCE_CHANGED");
      update(current => {
        const saved = readAidtTestGroups(current.fields).find(item => item.id === group.id && !item.archived);
        return saved && aidtSyntheticAsrSourceKey(saved) === sourceKey ? saveAidtSyntheticAsr(current, saved, pin) : current;
      });
      requestSave(); setBuffer(null); setChecked(false);
    } catch { if (!controller.signal.aborted && latest.current === expected) setError("未保存校对摘录：来源、权限、实际转写产物或小组版本无法核对。当前编辑保留，请核对后重试。"); }
    finally { if (aborter.current === controller) { aborter.current = null; setPending(false); } }
  }
  const saved = readAidtSavedSyntheticAsr(draft, group);
  return <section className="space-y-3" aria-label="合成音频校对与保存">
    {!readOnly && <details className="text-12"><summary className="cursor-pointer">合成音频文件转写（软件验收）</summary><div className="mt-3"><AidtSyntheticAudioTranscription projectId={projectId} entityId={group.id} audioSource={group.material ?? null} sourceKey={sourceKey}
      enabled={Boolean(sourceKey && !readOnly)} readCurrentSource={readCurrentSource} onReviewed={value => { setBuffer({ scope, value }); setChecked(false); setError(""); }} /></div></details>}
    {editable && <section className="space-y-3 rounded-container border border-border p-4" aria-label="待保存的合成转写摘录">
      <p className="text-12 text-muted-foreground">仅本页临时摘录，未保存。合成音频技术验收不是真人访谈或用户行为证据。</p>
      <label className="block text-12">校对摘录<Textarea rows={5} maxLength={1700} value={editable.value.reviewedText} disabled={pending} onChange={event => { setBuffer({ ...editable, value: { ...editable.value, reviewedText: event.currentTarget.value } }); setChecked(false); }} /></label>
      <p className="text-12">实际转写文件 {editable.value.transcript.artifactId} · V{editable.value.transcript.version}</p>
      {editable.value.warnings.length > 0 && <p className="break-words text-12 text-muted-foreground">转写边界：{editable.value.warnings.join("；")}</p>}
      <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={checked} disabled={pending} onChange={event => setChecked(event.currentTarget.checked)} /><span>我已核对合成音频内容与本摘录，知道它只属于合成软件验收，不是任何真人结论</span></label>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={pending || !checked || !editable.value.reviewedText.trim()} onClick={() => void save()}>{pending ? "核对实际来源…" : "保存合成转写摘录"}</Button><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setBuffer(null); setChecked(false); }}>取消，保留原记录</Button></div>
      {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
    </section>}
    {saved && <AidtSavedSyntheticAsrView key={JSON.stringify([actor, saved])} projectId={projectId} group={group} draft={draft} />}
  </section>;
}

export function AidtSavedSyntheticAsrView({ projectId, group, draft }: { projectId: string; group: AidtTestGroup; draft: AidtUiStageDraft }) {
  const session = useOptionalSession()?.session;
  const pinKey = JSON.stringify(readAidtSavedSyntheticAsr(draft, group));
  const pin = React.useMemo(() => pinKey === "null" ? null : JSON.parse(pinKey) as AidtSavedSyntheticAsr, [pinKey]);
  const [status, setStatus] = React.useState<"loading" | "verified" | "unavailable">("loading");
  const key = JSON.stringify([projectId, session?.currentOrgId, session?.userId, session?.sessionToken, group.id, group.material, pin]);
  const [accepted, setAccepted] = React.useState("");
  const [retry, refresh] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController(); setStatus("loading"); setAccepted("");
    if (!pin || !group.material || !session?.sessionToken) return () => controller.abort();
    void verifySavedAidtAudioTranscription({ projectId, entityId: group.id, audioSource: group.material, nativeAudio: pin.nativeAudio, transcript: pin.transcript }, session.sessionToken, controller.signal).then(ok => {
      if (!controller.signal.aborted) { setAccepted(key); setStatus(ok ? "verified" : "unavailable"); }
    }).catch(() => { if (!controller.signal.aborted) { setAccepted(key); setStatus("unavailable"); } });
    return () => controller.abort();
  }, [projectId, group.id, group.material, pin, session?.sessionToken, key, retry]);
  if (!pin) return null;
  const current = accepted === key ? status : "loading";
  return <section className="space-y-2 rounded-container border border-border p-3 text-12" aria-label="合成转写校对摘录与来源">
    <h4 className="font-medium">合成音频校对摘录 · 软件验收</h4>
    <p className="text-muted-foreground">摘录的小组保存状态以本页回执为准；下方另核原生来源。</p>
    <p>不是真人访谈、实际行为或已完成课堂测试。</p>
    {current === "loading" ? <p role="status">正在核对原生工具回执与原件…</p> : current === "verified" ? <><p role="status">当前原件、实际工具回执与转写文件已核对。</p><p className="whitespace-pre-wrap break-words">{pin.reviewedText}</p></> : <p role="alert">当前无法核对已保存转写的原件或回执，保留精确引用，不以新内容替换。</p>}
    <details><summary className="cursor-pointer">查看保存的真实引用与边界</summary><div className="mt-2 space-y-1 break-all"><p>原件 {pin.audio.artifactId} · 版本 {pin.audio.versionId} · SHA256 {pin.audio.sha256}</p><p>原生附件 {pin.nativeAudio.attachmentId} · 消息 {pin.nativeAudio.messageId}</p><p>转写 {pin.transcript.artifactId} · V{pin.transcript.version} · SHA256 {pin.transcript.sha256}</p><p>实际 run {pin.transcript.producedByRunId} · 产物 step 引用 {pin.transcript.producedByStepId}</p><p>工具警告：{pin.warnings.join("；") || "未提供额外警告；仍不包含说话人身份或真人授权证明"}</p></div></details>
    <Button type="button" size="xs" variant="outline" onClick={refresh}>重新核对转写来源</Button>
    <AidtSavedSyntheticAsrReportPrint projectId={projectId} stageId={6} entityId={group.id} draft={draft} />
  </section>;
}
