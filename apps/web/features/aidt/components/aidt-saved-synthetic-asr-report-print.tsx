"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { getThread } from "@/lib/live-chat";
import { previewAidtPdf } from "../lib/aidt-print-preview";
import { readAidtStage } from "../lib/live-aidt-stages";
import { readAidtInterviewMaterials } from "../lib/aidt-interviews";
import { aidtInterviewSyntheticAsrSourceKey, readAidtSavedInterviewSyntheticAsr } from "../lib/aidt-interview-synthetic-asr";
import { readAidtTestGroups } from "../lib/aidt-test-groups";
import { aidtSyntheticAsrSourceKey, readAidtSavedSyntheticAsr } from "../lib/aidt-test-synthetic-asr";
import { readSavedAidtAudioTranscription, type AidtAudioTranscriptionOption } from "../lib/aidt-synthetic-audio-transcription";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Props = { projectId: string; stageId: 2 | 6; entityId: string; draft: AidtUiStageDraft; materialKey?: string };

function selectedSavedSource(draft: AidtUiStageDraft, props: Pick<Props,"projectId" | "stageId" | "entityId" | "materialKey">) {
  const { projectId, stageId, entityId, materialKey } = props;
  if (stageId === 2) {
    if (!materialKey) return null;
    const sourceKey = aidtInterviewSyntheticAsrSourceKey(draft,entityId,projectId,materialKey);
    const audioSource = readAidtInterviewMaterials(draft.fields,entityId,projectId).find(material => material.key === materialKey)?.reference;
    const pin = readAidtSavedInterviewSyntheticAsr(draft,entityId,projectId);
    return sourceKey && audioSource && pin && audioSource.artifactId === pin.audio.artifactId && audioSource.versionId === pin.audio.versionId
      && audioSource.runId === pin.audio.runId && audioSource.sha256 === pin.audio.sha256 ? {sourceKey,audioSource,pin} : null;
  }
  const group = readAidtTestGroups(draft.fields).find(item => item.id === entityId && !item.archived);
  const pin = group && readAidtSavedSyntheticAsr(draft,group);
  return group?.material?.projectId === projectId && pin ? {sourceKey:aidtSyntheticAsrSourceKey(group),audioSource:group.material,pin} : null;
}

function asrReportDocument(option: AidtAudioTranscriptionOption, excerpt: string, stageId: number, revision: number) {
  if (!option.recognizedText.trim() || !option.toolProof) throw new Error("尚无可核对的实际转写全文。");
  const root = document.createElement("article");
  const append = (tag: "h2" | "h3" | "p", text: string) => {
    const node = document.createElement(tag); node.textContent = text; node.style.whiteSpace = "pre-wrap";
    node.style.overflowWrap = "anywhere"; root.append(node);
  };
  append("h2","合成 ASR 全文报告 · 软件 QA");
  append("p",`第 ${stageId} 步 · 小组保存版本 V${revision}。这不是任何真人访谈、用户原话、实际行为或课堂验收。`);
  append("h3","实际发布的原始转写全文");
  append("p","以下全文来自同一真实运行已发布的原始 ASR JSON，经原音频、原生附件、工具回执和文件哈希核对。未用学生摘录或助手总结代替。");
  append("p",option.recognizedText);
  append("h3","ASR 关联记录中保存的学生校对摘录");
  append("p",excerpt);
  append("p","这是 ASR 关联记录中另行保存的摘录，不覆盖后来可能编辑的访谈或测试内容；它与上方原始转写分层展示，不代表真人证据或阶段完成。");
  append("h3","实际来源与核对回执");
  const lines = [
    `原音频：${option.audioSource.name}\n${option.audioSource.artifactId} · 版本 ${option.audioSource.versionId}\nSHA256 ${option.audioSource.sha256}`,
    `原生音频：thread ${option.nativeAudio.threadId}\n附件 ${option.nativeAudio.attachmentId} · 用户消息 ${option.nativeAudio.messageId}\nSHA256 ${option.nativeAudio.sha256}`,
    `转写文件：${option.transcript.name}\n${option.transcript.artifactId} · V${option.transcript.version}\n附件 ${option.transcript.attachmentId}\nSHA256 ${option.transcript.sha256}`,
    `实际运行：${option.transcript.producedByRunId}\n产物 step 引用：${option.transcript.producedByStepId}`,
    `实际工具：${option.toolProof.audioTool} → ${option.toolProof.publishTool}\n工具原始输出：${option.toolProof.workspacePath}\n音频回执 sourceHash ${option.toolProof.sourceHash}\n转写回执 SHA256 ${option.toolProof.transcriptSha256}\n工具回执 outputDigest ${option.toolProof.receiptOutputDigest}`,
  ];
  for (const line of lines) append("p",line);
  append("h3","转写边界与警告");
  append("p",option.warnings.join("；") || "工具未提供额外警告；这仍不是说话人身份、真人授权或研究结论的证明。");
  return root;
}

/** Opens only a current saved pin's actual published full transcript; never generates or saves. */
export function AidtSavedSyntheticAsrReportPrint(props: Props) {
  const session = useOptionalSession()?.session;
  const selected = selectedSavedSource(props.draft,props);
  const selectedKey = selected ? JSON.stringify(selected) : "";
  const scope = JSON.stringify([props.projectId,props.stageId,props.entityId,props.materialKey,session?.currentOrgId,session?.userId,session?.sessionToken,selectedKey]);
  const current = React.useRef(scope); current.current = scope;
  const alive = React.useRef(true), button = React.useRef<HTMLButtonElement>(null), controller = React.useRef<AbortController | null>(null);
  const [busy,setBusy] = React.useState(false), [error,setError] = React.useState("");
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; },[]);
  React.useEffect(() => { controller.current?.abort(); controller.current = null; setBusy(false); setError(""); },[scope]);
  if (!selected) return null;
  const print = async () => {
    if (busy || !session?.sessionToken) return;
    const token = session.sessionToken;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError("");
    const expected = scope;
    let permitted = true, poll: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => permitted && !abort.signal.aborted && alive.current && current.current === expected && button.current?.isConnected === true;
    const readCurrent = async () => {
      const {stage} = await readAidtStage(props.projectId,props.stageId,token,abort.signal);
      const source = stage && selectedSavedSource(stage.content.draft,props);
      if (!stage || !source || JSON.stringify(source) !== selectedKey || !isCurrent()) throw new Error("来源、保存版本或当前授权已变化，请重新打开。");
      return {stage,source};
    };
    try {
      const {stage,source} = await readCurrent();
      const actual = await readSavedAidtAudioTranscription({projectId:props.projectId,entityId:props.entityId,audioSource:source.audioSource,
        nativeAudio:source.pin.nativeAudio,transcript:source.pin.transcript},token,abort.signal);
      if (!actual || !actual.toolProof || !isCurrent()) throw new Error("当前无法核对同一运行的实际转写全文，未打开预览。");
      await readCurrent();
      const watch = async () => {
        try {
          await readCurrent();
          const detail = await getThread(source.pin.nativeAudio.threadId,props.projectId,token);
          if (detail.thread.id !== source.pin.nativeAudio.threadId || detail.thread.projectId !== props.projectId
            || detail.thread.groupId !== null || detail.thread.visibilityScope !== "plenary" || !isCurrent()) throw new Error("SOURCE_CHANGED");
        } catch { permitted = false; abort.abort(); return; }
        if (isCurrent()) poll = setTimeout(() => void watch(),3000);
      };
      poll = setTimeout(() => void watch(),3000);
      await previewAidtPdf(asrReportDocument(actual,source.pin.reviewedText,props.stageId,stage.revision),"合成 ASR 全文报告 · 软件 QA",{defaultPaper:"A4",layout:"flow",isCurrent});
    } catch (failure) {
      if (alive.current && current.current === expected) setError(failure instanceof Error ? failure.message : "无法读取实际转写，请核对来源后重试。");
    } finally {
      if (poll !== undefined) clearTimeout(poll); abort.abort();
      if (controller.current === abort) { controller.current = null; if (alive.current) setBusy(false); }
    }
  };
  return <div className="space-y-2" data-aidt-asr-print-entity={props.entityId}>
    <Button ref={button} type="button" size="sm" variant="outline" disabled={busy} onClick={() => void print()}>{busy ? "正在核对实际转写…" : "预览合成 ASR 全文报告"}</Button>
    {error && <p role="alert" className="text-12 text-muted-foreground">{error}</p>}
  </div>;
}
