"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { previewAidtText } from "../lib/aidt-print-preview";
import { readAidtStage } from "../lib/live-aidt-stages";
import { readAidtTestGroups, type AidtTestGroup } from "../lib/aidt-test-groups";
import { aidtTestResearchPath, AIDT_TEST_RESEARCH_LABELS, readAidtVirtualResearch, verifyAidtVirtualResearch } from "../lib/aidt-test-research";
import { readAidtResearchMaterial } from "../lib/aidt-research-materials";
import { loadInterviewMarkdown } from "@/lib/interview-markdown-api";
import { listProjectResources } from "@/lib/live-project-resources";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { readAidtSavedSyntheticAsr } from "../lib/aidt-test-synthetic-asr";
import { verifySavedAidtAudioTranscription } from "../lib/aidt-synthetic-audio-transcription";

/** Export an actual saved test record. Opening a preview cannot confirm a test. */
export function AidtTestRecordPrint({ projectId, group, visibleFields }: { projectId: string; group: AidtTestGroup; visibleFields: readonly { title: string; text: string }[] }) {
  const session = useOptionalSession()?.session;
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");
  const scope = JSON.stringify([projectId, session?.currentOrgId, session?.userId, session?.sessionToken, group, visibleFields]);
  const current = React.useRef(scope); current.current = scope;
  const abort = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    current.current = scope;
    return () => { abort.current?.abort(); if (current.current === scope) current.current = ""; };
  }, [scope]);
  async function preview() {
    if (!session?.sessionToken || pending) return;
    const expected = scope, controller = new AbortController(); abort.current = controller; setPending(true); setError("");
    try {
      const { stage } = await readAidtStage(projectId, 6, session.sessionToken, controller.signal);
      const saved = stage && readAidtTestGroups(stage.content.draft.fields).find(item => item.id === group.id);
      if (!stage || !saved || JSON.stringify(saved) !== JSON.stringify(group)) throw new Error("SAVED_VERSION_CHANGED");
      const path = aidtTestResearchPath(saved);
      const lines = [`# ${saved.name || "测试学习记录"}`, `记录 ${saved.id} · 第6步保存版本 V${stage.revision}`, `研究路径：${AIDT_TEST_RESEARCH_LABELS[path]}${path === "virtual" ? "（模拟，不是真人证据）" : ""}`, `被测原型：第5步V${saved.stage5Revision} / Design ${saved.designId} / 精确版本 ${saved.versionId}`];
      if (saved.material && path !== "virtual") {
        if (saved.material.projectId !== projectId || saved.material.mime.startsWith("audio/") && !saved.audioConsentAt) throw new Error("MATERIAL_UNAVAILABLE");
        await readAidtResearchMaterial({ projectId, sessionToken: session.sessionToken, signal: controller.signal }, saved.material);
      }
      if (saved.source) {
        const links = await listProjectResources(projectId);
        if (!links.items.some(item => item.id === saved.source!.id && item.kind === saved.source!.kind)) throw new Error("SOURCE_UNAVAILABLE");
        lines.push(`原生来源：${saved.source.kind} ${saved.source.id}`, `来源位置：${saved.sourceLocation || "未记录"}`);
      }
      if (path === "survey" && saved.source?.kind === "survey" && saved.surveyResponseId) {
        const survey = await surveyRequest(`/surveys/${encodeURIComponent(saved.source.id)}`, { sessionToken: session.sessionToken, signal: controller.signal }, SurveyRuntimeSchema);
        if (!survey.responses.some(item => item.id === saved.surveyResponseId && item.analysis !== "excluded")) throw new Error("RESPONSE_UNAVAILABLE");
        lines.push(`实际答卷引用：${saved.surveyResponseId}`);
      }
      if (path === "virtual") {
        const pin = readAidtVirtualResearch(stage.content.draft, saved.id);
        if (!pin || saved.source?.id !== pin.interviewId || !await verifyAidtVirtualResearch(await loadInterviewMarkdown(pin.interviewId, controller.signal), pin)) throw new Error("VIRTUAL_VERSION_UNAVAILABLE");
        lines.push("以下均为模拟摘录与学生分类，不能证明真实用户行为。", `原生研究修订 ${pin.revisionId}`, `大纲 ${pin.outline.documentId} / V${pin.outline.version} / ${pin.outline.contentHash}`, `模拟对话 ${pin.runs.documentId} / V${pin.runs.version} / ${pin.runs.contentHash}`, `模拟报告 ${pin.report.documentId} / V${pin.report.version} / ${pin.report.contentHash}`,
          ...pin.findings.map(item => `${item.category === "function" ? "功能反馈" : "用户需求"}（模拟摘录）：${item.quote}\n模拟原段 V${pin.runs.version} / 字符${item.start}–${item.end} / 引用#${item.anchor}`));
      }
      if (saved.evidenceOrigin === "synthetic-file-asr") {
        const pin = readAidtSavedSyntheticAsr(stage.content.draft, saved);
        if (!pin || !saved.material || !await verifySavedAidtAudioTranscription({ projectId, entityId: saved.id, audioSource: saved.material, nativeAudio: pin.nativeAudio, transcript: pin.transcript }, session.sessionToken, controller.signal)) throw new Error("SYNTHETIC_ASR_PROOF_UNAVAILABLE");
        lines.push("合成音频软件验收，不是真人访谈、用户行为或课堂成果。", `学生校对摘录：${pin.reviewedText}`, `原件 ${pin.audio.artifactId} / ${pin.audio.versionId} / SHA256 ${pin.audio.sha256}`, `原生附件 ${pin.nativeAudio.threadId} / ${pin.nativeAudio.attachmentId} / 消息 ${pin.nativeAudio.messageId}`, `转写文件 ${pin.transcript.artifactId} / V${pin.transcript.version} / SHA256 ${pin.transcript.sha256}`, `实际 run ${pin.transcript.producedByRunId} / 产物 step 引用 ${pin.transcript.producedByStepId}`, `工具边界：${pin.warnings.join("；") || "未提供额外警告"}`);
      }
      lines.push(...visibleFields.flatMap(item => [`## ${item.title}`, item.text]), "归档或确认本轮学习不等于方案验证成功，仍待核对真实证据与下一步计划。");
      if (controller.signal.aborted || current.current !== expected) return;
      await previewAidtText(lines.join("\n\n"), `${saved.name || "测试学习记录"} · V${stage.revision}`, { defaultPaper: "A4", isCurrent: () => !controller.signal.aborted && current.current === expected });
    } catch { if (!controller.signal.aborted && current.current === expected) setError("无法核对当前保存版本或来源，未打开打印预览。原记录保留，请刷新后重试。"); }
    finally { if (abort.current === controller) { abort.current = null; setPending(false); } }
  }
  return <div className="space-y-2"><Button type="button" size="sm" variant="outline" disabled={pending || !session?.sessionToken} onClick={() => void preview()}>{pending ? "核对来源…" : "预览与打印测试记录"}</Button>{error && <p role="alert" className="text-12 text-destructive">{error}</p>}</div>;
}
