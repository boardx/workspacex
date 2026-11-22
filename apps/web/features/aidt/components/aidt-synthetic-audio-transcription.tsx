"use client";
import * as React from "react";
import { ATTACHMENT_LIMITS } from "@repo/contracts/chat-file-upload";
import { ChatHostTextActionContext } from "@/components/chat/chat-host-panel";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import type { AidtResearchMaterialReference } from "../lib/aidt-research-materials";
import { loadAidtAudioTranscriptions, makeAidtSyntheticAudioRequest, readAidtSyntheticAudioFile,
  type AidtAudioTranscriptionOption, type AidtReviewedAudioTranscription, type AidtSyntheticAudioRequest } from "../lib/aidt-synthetic-audio-transcription";

type OwnedRequest = { scope: string; sourceKey: string; request: AidtSyntheticAudioRequest };
const resultKey = (result: AidtAudioTranscriptionOption) => JSON.stringify([result.transcript.artifactId, result.transcript.version, result.transcript.sha256, result.nativeAudio.attachmentId, result.audioSource.sha256]);
const MAX_REVIEWED_EXCERPT = 1700;

/** Synthetic file pipeline only. No recorder/notice/session, no automatic send, save or confirmation. */
export function AidtSyntheticAudioTranscription({ projectId, entityId, audioSource, sourceKey, enabled = false, readCurrentSource, onReviewed }: {
  projectId: string; entityId: string; audioSource: AidtResearchMaterialReference | null; sourceKey: string | null; enabled?: boolean;
  readCurrentSource: (signal: AbortSignal) => Promise<string | null>;
  onReviewed: (result: AidtReviewedAudioTranscription) => void | Promise<void>;
}) {
  const action = React.useContext(ChatHostTextActionContext);
  const session = useOptionalSession()?.session;
  const scope = JSON.stringify([session?.currentOrgId, session?.userId, projectId, entityId, action?.threadId]);
  const latest = React.useRef({ scope, sourceKey, enabled, audioSource, readCurrentSource, onReviewed });
  latest.current = { scope, sourceKey, enabled, audioSource, readCurrentSource, onReviewed };
  const mounted = React.useRef(true);
  const owner = React.useRef<OwnedRequest | null>(null);
  const pending = React.useRef<AbortController | null>(null);
  const [synthetic, setSynthetic] = React.useState(false);
  const [request, setRequest] = React.useState<OwnedRequest | null>(null);
  const [results, setResults] = React.useState<readonly AidtAudioTranscriptionOption[]>([]);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [text, setText] = React.useState("");
  const [checked, setChecked] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const owns = (value: OwnedRequest) => mounted.current && owner.current === value && latest.current.enabled && latest.current.scope === value.scope && latest.current.sourceKey === value.sourceKey;
  const clear = React.useCallback(() => { owner.current = null; pending.current?.abort(); pending.current = null; setRequest(null); setResults([]); setSelected(null); setText(""); setChecked(false); setBusy(false); }, []);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; owner.current = null; pending.current?.abort(); }; }, []);
  React.useEffect(() => { clear(); setSynthetic(false); setStatus(""); }, [scope, sourceKey, enabled, clear]);
  const eligible = enabled && !!sourceKey && !!audioSource && audioSource.projectId === projectId && ["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg"].includes(audioSource.mime)
    && audioSource.bytes > 0 && audioSource.bytes <= ATTACHMENT_LIMITS.maxBytesPerFile;
  const sameSource = async (value: OwnedRequest, signal: AbortSignal) => (await latest.current.readCurrentSource(signal)) === value.sourceKey && owns(value);

  const prepare = async () => {
    if (pending.current || !eligible || !audioSource || !sourceKey || !synthetic || busy || owner.current || !action?.available || action.running || action.occupied || !action.offerAudioDraft || !action.threadId || action.projectId !== projectId || !session?.sessionToken) return;
    const value: OwnedRequest = { scope, sourceKey, request: makeAidtSyntheticAudioRequest(projectId, entityId, action.threadId, audioSource) };
    owner.current = value; setBusy(true); setStatus("正在核对已保存原件与当前权限…");
    const abort = new AbortController(); pending.current = abort;
    try {
      if (!await sameSource(value, abort.signal)) { if (owns(value)) { clear(); setStatus("来源或权限已改变，请先保存并核对当前材料。"); } return; }
      const file = await readAidtSyntheticAudioFile(audioSource, session.sessionToken, abort.signal);
      if (!owns(value)) return;
      if (!await sameSource(value, abort.signal)) { if (owns(value)) { clear(); setStatus("原件读取期间来源或权限已改变，未加入 Chat。"); } return; }
      const offered = action.offerAudioDraft(file, value.request.prompt);
      if (!owns(value)) return;
      if (offered !== "accepted") { clear(); setStatus(offered === "occupied" ? "输入框已有内容、附件或录音，未替换。请先处理，再准备转写。" : "当前对话尚未就绪，原件保留。"); return; }
      setRequest(value); setStatus("已把同一字节的音频放入当前 Chat 的正常附件队列并预填请求。请核对上传状态后自己点发送，并按原生界面审阅工具；尚未完成转写。");
    } catch { if (owns(value)) { clear(); setStatus("无法准备转写。原件与已有聊天草稿保留，请核对权限、文件格式后重试。"); } }
    finally { if (mounted.current && pending.current === abort) { pending.current = null; setBusy(false); } }
  };

  const load = async () => {
    if (pending.current || !request || busy || action?.running || !session?.sessionToken || !owns(request)) return;
    setBusy(true); setStatus("正在读取本次实际工具回执与已发布文件…");
    const abort = new AbortController(); pending.current = abort;
    try {
      if (!await sameSource(request, abort.signal)) { if (owns(request)) setStatus("当前材料或权限已变化，不能关联旧结果。"); return; }
      const next = await loadAidtAudioTranscriptions(request.request, session.sessionToken, abort.signal);
      if (!owns(request)) return;
      if (!await sameSource(request, abort.signal)) { if (owns(request)) { setResults([]); setSelected(null); setStatus("读取期间来源或权限已改变，未关联转写。"); } return; }
      setResults(next); setSelected(null); setText(""); setChecked(false);
      setStatus(next.length ? "找到经过真实 ASR 工具回执和文件哈希核对的产物。请选择并校对，尚未写入测试成果。" : "尚无可核验的已发布转写。请查看 Chat 是否待发送、待审阅或失败；不会根据助手文字补造结果，也不会自动重新调用。");
    } catch (error) {
      if (!owns(request)) return;
      const reason = error instanceof Error ? error.message : "";
      setStatus(reason === "AIDT_ASR_REQUEST_NOT_SENT_OR_CHANGED" ? "尚未找到本次原样发送的请求。请核对 Chat 上传和发送状态；修改过请求需取消后重新准备。"
        : reason.includes("HASH") || reason.includes("SOURCE_CHANGED") ? "原音频或来源核对未通过，未关联转写。请检查实际文件与版本。"
        : "无法取得完整可验证回执，请查看 Chat 的实际工具结果或稍后重新读取。原件保留，不会自动重跑转写。");
    } finally { if (mounted.current && pending.current === abort) { pending.current = null; setBusy(false); } }
  };
  const adopt = async () => {
    const chosen = selected === null ? undefined : results[selected];
    if (pending.current || !request || !chosen || !chosen.recognizedText.trim() || !checked || busy || !text.trim() || text.length > MAX_REVIEWED_EXCERPT || !session?.sessionToken || !owns(request)) return;
    setBusy(true); setStatus("再次核对来源和所选版本…");
    const abort = new AbortController(); pending.current = abort;
    const reviewedText = text.trim();
    try {
      if (!await sameSource(request, abort.signal)) { if (owns(request)) setStatus("当前来源或权限已变化，未采用摘录。"); return; }
      const actual = await loadAidtAudioTranscriptions(request.request, session.sessionToken, abort.signal);
      if (!owns(request) || !await sameSource(request, abort.signal) || !actual.some(item => resultKey(item) === resultKey(chosen) && item.recognizedText === chosen.recognizedText)) { if (owns(request)) setStatus("来源、产物或权限已改变，未采用旧结果。"); return; }
      await latest.current.onReviewed({ ...chosen, reviewedText });
      if (mounted.current && owner.current === request) { clear(); setStatus("校对摘录已交给本地测试草稿。请检查后按正常流程保存；尚未确认本轮，也不是真人测试结论。"); }
    } catch { if (owns(request)) setStatus("未能采用校对摘录，已有成果保留。请重新核对实际版本。"); }
    finally { if (mounted.current && pending.current === abort) { pending.current = null; setBusy(false); } }
  };
  const chosen = selected === null ? undefined : results[selected];
  return <section aria-label="合成音频文件转写" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
    <h4 className="text-13 font-medium">合成音频文件转写</h4>
    <p className="text-12 text-muted-foreground">仅用于合成测试音频，不在这里提交真人访谈录音。转写后先由你校对，不会自动成为研究结论。</p>
    {!eligible && <p role="status" className="text-12">先保存本组可访问的合成音频原件；当前文件、权限或类型不满足转写条件。</p>}
    {audioSource && <details className="text-12 text-muted-foreground"><summary className="cursor-pointer">已保存原件：{audioSource.name}</summary><p className="mt-2 break-all">版本 {audioSource.versionId} · SHA256 {audioSource.sha256}</p></details>}
    <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={synthetic} disabled={busy || !!request || !eligible} onChange={event => setSynthetic(event.currentTarget.checked)} /><span>这是获准用于本次 QA 的合成音频，不包含真人访谈。为使用原生工具，同一字节会再上传到当前 Chat 附件，两处保存；哈希不一致时不关联。</span></label>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={!eligible || !synthetic || busy || !!request || !action?.available || action.running || action.occupied || !action.offerAudioDraft} onClick={() => void prepare()}>将同一音频附到 Chat 并准备转写</Button>
      {request && <Button type="button" size="sm" variant="outline" disabled={busy || action?.running} onClick={() => void load()}>读取本次已发布转写</Button>}</div>
    {status && <p role="status" className="text-12">{status}</p>}
    {results.length > 0 && <fieldset className="space-y-2" disabled={busy}><legend className="text-13 font-medium">选择实际转写产物</legend>{results.map((result, index) => <label key={resultKey(result)} className="flex items-start gap-2 rounded-lg border border-border bg-background p-3 text-12"><input type="radio" className="mt-1" name={`asr-result-${entityId}`} checked={selected === index} onChange={() => { setSelected(index); setText(result.recognizedText.length <= MAX_REVIEWED_EXCERPT ? result.recognizedText : ""); setChecked(false); }} /><span className="break-all">{result.transcript.name} · V{result.transcript.version}</span></label>)}</fieldset>}
    {chosen && <div className="space-y-3"><details><summary className="cursor-pointer text-12">查看实际完整转写与来源</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-12">{chosen.recognizedText}</pre><p className="mt-2 break-all text-11 text-muted-foreground">转写文件 SHA256 {chosen.transcript.sha256} · 实际 run {chosen.transcript.producedByRunId} · 服务端产物 step 引用 {chosen.transcript.producedByStepId}。此处保留该引用，没有独立重建 step 映射。时间为源 chunk 范围，不是逐字对齐；没有说话人身份或可信度校准。</p></details>
      {!chosen.recognizedText.trim() ? <p role="status" className="text-12">本次没有识别到语音。原件和真实转写产物保留，不能把空结果作为校对摘录采用。</p> : chosen.warnings.includes("some_chunks_without_recognized_speech") && <p className="text-12 text-muted-foreground">部分片段未识别到语音，请回听核对，保留不确定之处。</p>}
      {chosen.recognizedText.length > MAX_REVIEWED_EXCERPT && <p className="text-12">完整转写超过本步摘录容量，请手动选取并校对需要引用的部分；完整产物仍保留。</p>}
      <label className="block text-13">校对后的摘录<textarea className="mt-1 w-full rounded-control border border-border bg-background p-2" rows={4} value={text} maxLength={MAX_REVIEWED_EXCERPT} disabled={busy} onChange={event => { setText(event.currentTarget.value); setChecked(false); }} /></label>
      <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={checked} disabled={busy || !chosen.recognizedText.trim() || !text.trim()} onChange={event => setChecked(event.currentTarget.checked)} /><span>已核对合成音频内容与这段转写摘录；它仅是软件测试材料，不代表真人反馈或实际行为。</span></label>
      <Button type="button" size="sm" disabled={busy || !chosen.recognizedText.trim() || !checked || !text.trim()} onClick={() => void adopt()}>采用校对摘录到本地草稿</Button>
    </div>}
    {request && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { clear(); setStatus("已取消本处关联。Chat 中已准备的附件、草稿或已发出的工具请求不会被删除，请在原生 Chat 内自行处理；不会自动重跑。"); }}>取消关联，保留原件</Button>}
  </section>;
}
