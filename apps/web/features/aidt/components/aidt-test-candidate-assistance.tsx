"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalSession } from "@/components/session/session-provider";
import { loadInterviewMarkdown } from "@/lib/interview-markdown-api";
import { listProjectResources } from "@/lib/live-project-resources";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { AidtCandidatePicker } from "./aidt-candidate-picker";
import { useAidtCandidateRequest } from "../lib/use-aidt-candidate-request";
import { parseAidtTestPlanCandidate, parseAidtTestResultCandidate, type AidtTestPlanCandidate, type AidtTestResultCandidate, type AidtTestTurn } from "../lib/aidt-test-proposal";
import { readAidtTestGroups, updateAidtTestGroup, type AidtTestGroup } from "../lib/aidt-test-groups";
import { aidtTestResearchPath, readAidtVirtualResearch, verifyAidtVirtualResearch } from "../lib/aidt-test-research";
import { readAidtStage, readAidtStageRevision } from "../lib/live-aidt-stages";
import { resolveAidtPrototypeVersion } from "../lib/aidt-prototype-versions";
import { readAidtResearchMaterial } from "../lib/aidt-research-materials";
import { createAidtQuestionSnapshot } from "../lib/aidt-verification-loop";
import type { AidtReadPrototypeEntity } from "./aidt-test-prototype-source";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { readAidtSavedSyntheticAsr } from "../lib/aidt-test-synthetic-asr";
import { verifySavedAidtAudioTranscription } from "../lib/aidt-synthetic-audio-transcription";

type Candidate = AidtTestPlanCandidate | AidtTestResultCandidate;
type Props = { phase: "plan" | "result"; projectId: string; group: AidtTestGroup; draft: AidtUiStageDraft; savedDraft?: AidtUiStageDraft; messages: readonly AidtTestTurn[]; loading: boolean; running: boolean; readOnly: boolean; canSave: boolean; readPrototypeEntity?: AidtReadPrototypeEntity; update: (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void; requestSave: () => void };
export function AidtTestCandidateAssistance({ phase, projectId, group, draft, savedDraft, messages, loading, running, readOnly, canSave, readPrototypeEntity, update, requestSave }: Props) {
  const session = useOptionalSession()?.session;
  const saved = savedDraft && readAidtTestGroups(savedDraft.fields).find(item => item.id === group.id && !item.archived);
  const binding = readAidtVirtualResearch(draft, group.id);
  const syntheticAsr = readAidtSavedSyntheticAsr(draft, group);
  const snapshotKey = JSON.stringify([phase, group, binding, syntheticAsr]);
  const savedKey = saved && JSON.stringify([phase, saved, readAidtVirtualResearch(savedDraft!, group.id), readAidtSavedSyntheticAsr(savedDraft!, saved)]);
  const sourceKey = savedKey === snapshotKey ? snapshotKey : null;
  const path = aidtTestResearchPath(group);
  const actorScope = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, projectId, group.id, phase]);
  const [buffer, setBuffer] = React.useState<{ sourceKey: string; actorScope: string; candidate: Candidate } | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState("");
  const applyAbort = React.useRef<AbortController | null>(null);
  const current = React.useRef({ actorScope, sourceKey }); current.current = { actorScope, sourceKey };
  React.useEffect(() => () => { applyAbort.current?.abort(); }, [actorScope, sourceKey]);
  const editable = buffer?.sourceKey === sourceKey && buffer.actorScope === actorScope ? buffer : null;
  async function readCurrentSource(signal: AbortSignal) {
      if (!session?.sessionToken || !session.userId || !sourceKey) return null;
      const { stage } = await readAidtStage(projectId, 6, session.sessionToken, signal);
      const latest = stage && readAidtTestGroups(stage.content.draft.fields).find(item => item.id === group.id && !item.archived);
      if (!stage || !latest || JSON.stringify([phase, latest, readAidtVirtualResearch(stage.content.draft, group.id), readAidtSavedSyntheticAsr(stage.content.draft, latest)]) !== sourceKey) return null;
      const frozen = await readAidtStageRevision(projectId, 5, latest.stage5Revision, session.sessionToken, signal);
      const prototype = frozen && (latest.prototypeEntity ? readPrototypeEntity?.(frozen.content.draft, latest.prototypeEntity) : frozen.content.draft);
      const question = prototype && createAidtQuestionSnapshot(prototype, latest.stage5Revision);
      if (!question || !question.ok || question.snapshot.prototypeDesignId !== latest.designId || question.snapshot.prototypeVersionId !== latest.versionId) return null;
      await resolveAidtPrototypeVersion({ projectId, sessionToken: session.sessionToken, userId: session.userId, signal }, latest.designId, latest.versionId, "linked-reader");
      if (phase === "result") {
        if (path === "virtual") {
          const pin = readAidtVirtualResearch(stage.content.draft, latest.id);
          if (!pin || latest.source?.kind !== "interview" || latest.source.id !== pin.interviewId) return null;
          const links = await listProjectResources(projectId);
          if (signal.aborted || !links.items.some(item => item.kind === "interview" && item.id === pin.interviewId)) return null;
          if (!await verifyAidtVirtualResearch(await loadInterviewMarkdown(pin.interviewId, signal), pin)) return null;
        } else if (latest.evidenceOrigin === "synthetic-file-asr") {
          const pin = readAidtSavedSyntheticAsr(stage.content.draft, latest);
          if (!pin || !latest.material || !await verifySavedAidtAudioTranscription({ projectId, entityId: latest.id, audioSource: latest.material, nativeAudio: pin.nativeAudio, transcript: pin.transcript }, session.sessionToken, signal)) return null;
        } else if (latest.material) {
          if (latest.material.projectId !== projectId || latest.material.mime.startsWith("audio/") && !latest.audioConsentAt) return null;
          await readAidtResearchMaterial({ projectId, sessionToken: session.sessionToken, signal }, latest.material);
        } else if (path === "survey" && latest.source?.kind === "survey" && latest.surveyResponseId) {
          const links = await listProjectResources(projectId);
          if (!links.items.some(item => item.kind === "survey" && item.id === latest.source!.id)) return null;
          const survey = await surveyRequest(`/surveys/${encodeURIComponent(latest.source.id)}`, { signal, sessionToken: session.sessionToken }, SurveyRuntimeSchema);
          if (survey.id !== latest.source.id || !survey.responses.some(item => item.id === latest.surveyResponseId && item.analysis !== "excluded")) return null;
        } else if (!latest.evidenceGap?.trim()) return null;
      }
      return signal.aborted ? null : sourceKey;
  }
  const controller = useAidtCandidateRequest<Candidate>({
    kind: "test", projectId, entityId: group.id, sourceKey, messages, loading, running,
    enabled: !readOnly && canSave && !group.archived && Boolean(sourceKey && session?.sessionToken && session.userId),
    instruction: [`当前研究路径：${path === "virtual" ? "虚拟用户研究（仅模拟，非真人证据）" : path === "survey" ? "实际调查（仅绑定答卷内容）" : "线下访谈（仅获授权原件）"}。`,
      group.evidenceOrigin === "synthetic-file-asr" ? `本组实际来源为合成音频软件验收，不是真人访谈。校对摘录：${syntheticAsr?.reviewedText || "当前没有可用摘录"}；真实工具边界：${syntheticAsr?.warnings.join("；") || "须核对原生回执"}。不得推断任何真人行为，understandingChangeStatus仅可insufficient。` : "保持当前渠道的来源边界。",
      `被测原型：第5步V${group.stage5Revision} / Design ${group.designId} / 精确版本 ${group.versionId}。`,
      `学生当前测试问题：${group.task || "尚未填写"}；情境：${group.situation || "尚未填写"}。`,
      phase === "result" ? `学生当前反思：${group.reflection || "尚未填写"}；学生解释：${group.interpretation || "尚未填写"}。` : "先等待学生自己的判断，不替代首轮思考。",
      phase === "result" && path === "virtual" && binding ? `已选择的模拟报告 ${binding.report.documentId} V${binding.report.version}，模拟对话 ${binding.runs.documentId} V${binding.runs.version}；以下为已保存模拟摘录，不是真人证据：${binding.findings.map(item => `${item.category === "function" ? "功能反馈" : "用户需求"}：${item.quote}（字符${item.start}–${item.end}，引用#${item.anchor}）`).join("\n") || "尚未整理，先追问，不编造发现。"}` : "未提供可核对材料正文时先追问，不根据原件名称或权限通过推断内容。",
      phase === "plan" ? `只提出可编辑的测试问题和任务草稿，围绕这份原型已保存的验证问题，等待学生判断；输出一个 aidt-test-plan JSON代码块，字段为 entityId=${JSON.stringify(group.id)}、task（最多300字）、situation（最多300字）。` : `基于本实体已保存材料提出反思草稿，区分原话、行为、解释与模拟；不宣布测试成功。输出一个 aidt-test-result JSON代码块，entityId=${JSON.stringify(group.id)}，task最多300字，reflection最多400字，其余仅填写有来源的字段；证据不足使用evidenceGap和understandingChangeStatus=insufficient，允许未改变。虚拟研究绝不填写真人said或实际did。`,
      "此请求只生成候选；不要自动保存、确认、发布问卷、开始虚拟研究或改变研究路径。"].join("\n"),
    parseReply: text => { const candidate = phase === "plan" ? parseAidtTestPlanCandidate(text, group.id) : parseAidtTestResultCandidate(text, group.id); return candidate ? [candidate] : []; },
    readCurrentSource,
  });
  async function applyBuffer() {
    if (!editable || readOnly || !canSave || applying) return;
    const captured = editable; const abort = new AbortController(); applyAbort.current = abort;
    setApplying(true); setError("");
    try {
      if (await readCurrentSource(abort.signal) !== captured.sourceKey || abort.signal.aborted || current.current.actorScope !== captured.actorScope || current.current.sourceKey !== captured.sourceKey) throw new Error("SOURCE_CHANGED");
      const candidate = captured.candidate;
      update(current => {
        const latest = readAidtTestGroups(current.fields).find(item => item.id === group.id && !item.archived);
        if (!latest || JSON.stringify([phase, latest, readAidtVirtualResearch(current, group.id), readAidtSavedSyntheticAsr(current, latest)]) !== snapshotKey) return current;
        const result: AidtTestGroup = { ...latest, task: candidate.task, situation: candidate.situation ?? latest.situation };
        if ("reflection" in candidate) {
          result.reflection = candidate.reflection; result.interpretation = candidate.interpretation ?? latest.interpretation;
          result.evidenceGap = latest.evidenceOrigin ? "合成音频软件验收，不是真人访谈或真实行为证据。" : path === "virtual" ? "仅有虚拟用户模拟反馈，尚未开展真实用户验证。" : candidate.evidenceGap ?? latest.evidenceGap;
          result.afterTestBelief = candidate.round?.afterTestBelief; result.understandingChange = path === "virtual" || latest.evidenceOrigin ? "insufficient" : candidate.round?.understandingChangeStatus;
          result.said = latest.said; result.did = latest.did;
        }
        delete result.confirmedFromMessageId; return updateAidtTestGroup(current, result);
      });
      requestSave(); setBuffer(null);
    } catch { if (!abort.signal.aborted) setError("来源、权限或小组版本已改变，未应用候选。当前编辑保留，请核对后重试。"); }
    finally { if (applyAbort.current === abort) { applyAbort.current = null; setApplying(false); } }
  }
  return <div className="space-y-3"><AidtCandidatePicker title={phase === "plan" ? "研究前，完善测试问题" : "研究后，整理学习与反思"} actionLabel={phase === "plan" ? "请 AI 提供问题草稿" : "请 AI 整理反思草稿"} controller={controller}
    hasExisting={Boolean(phase === "plan" ? group.task.trim() : group.reflection.trim())}
    renderCandidate={candidate => <div className="space-y-2"><p>{candidate.task}</p>{"reflection" in candidate && <p>{candidate.reflection}</p>}{(path === "virtual" || group.evidenceOrigin) && <p className="text-12 text-muted-foreground">仅模拟或合成软件验收，仍缺真实用户证据</p>}</div>}
    onAdopt={candidate => { if (sourceKey) { setBuffer({ sourceKey, actorScope, candidate }); setError(""); } }} />
    {editable && <section className="space-y-3 rounded-container border border-border p-4" aria-label="编辑 AI 测试草稿">
      <p className="text-12 text-muted-foreground">仅本页临时草稿，尚未保存或确认本轮完成。</p>
      <label className="block text-12">测试问题与任务<Textarea rows={3} maxLength={300} value={editable.candidate.task} disabled={applying} onChange={event => setBuffer({ ...editable, candidate: { ...editable.candidate, task: event.currentTarget.value } })} /></label>
      {"reflection" in editable.candidate && <><label className="block text-12">学生反思<Textarea rows={3} maxLength={400} value={editable.candidate.reflection} disabled={applying} onChange={event => setBuffer({ ...editable, candidate: { ...editable.candidate, reflection: event.currentTarget.value } })} /></label>
        <label className="block text-12">学生解释<Textarea rows={3} maxLength={500} value={editable.candidate.interpretation ?? ""} disabled={applying} onChange={event => setBuffer({ ...editable, candidate: { ...editable.candidate, interpretation: event.currentTarget.value } })} /></label></>}
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={applying || readOnly || !canSave || !editable.candidate.task.trim() || "reflection" in editable.candidate && !editable.candidate.reflection.trim()} onClick={() => void applyBuffer()}>{applying ? "核对来源…" : "保存为测试草稿"}</Button><Button type="button" size="sm" variant="ghost" disabled={applying} onClick={() => setBuffer(null)}>取消，保留原内容</Button></div>
      {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
    </section>}
  </div>;
}
