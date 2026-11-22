"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { formatSurveyAnswer, isSurveyPageElement } from "@repo/contracts/survey";
import { surveyReportShareBlockedReason } from "@repo/contracts/survey-report";
import { SurveyRuntimeSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { useOptionalSession } from "@/components/session/session-provider";
import { SurveyQuestionRenderer } from "@/components/survey/live/question-renderer";
import { SurveyReportDocument } from "@/components/survey/report/report-document";
import { Button } from "@/components/ui/button";
import { listProjectResources } from "@/lib/live-project-resources";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { previewAidtPdf } from "../lib/aidt-print-preview";
import { readAidtStage } from "../lib/live-aidt-stages";
import { readAidtTestGroups } from "../lib/aidt-test-groups";

type PrintDocument = { kind: "questionnaire" | "report"; runtime: SurveyRuntime; scope: string };

/** Read-only native documents. Printing never compiles, publishes or changes a survey. */
export function AidtTestSurveyPrint({ projectId, groupId, surveyId, responseId, runtime }: {
  projectId: string; groupId?: string; surveyId: string; responseId?: string; runtime: SurveyRuntime;
}) {
  const session = useOptionalSession()?.session;
  const [document, setDocument] = React.useState<PrintDocument | null>(null);
  const [pending, setPending] = React.useState(false), [error, setError] = React.useState("");
  const root = React.useRef<HTMLDivElement>(null);
  const scope = JSON.stringify([projectId, groupId, surveyId, responseId, runtime, session?.sessionToken, session?.userId, session?.currentOrgId]);
  const current = React.useRef(scope); current.current = scope;
  const abort = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    current.current = scope;
    return () => { abort.current?.abort(); if (current.current === scope) current.current = ""; };
  }, [scope]);

  async function print(kind: PrintDocument["kind"]) {
    if (pending || !session?.sessionToken || !groupId) return;
    const expected = scope, controller = new AbortController(); abort.current = controller;
    let stillAvailable = true, checking = false;
    let watch: ReturnType<typeof setInterval> | undefined;
    setPending(true); setError("");
    async function readCurrent() {
      const [fresh, stageResult, resources] = await Promise.all([
        surveyRequest(`/surveys/${encodeURIComponent(surveyId)}`, { sessionToken: session!.sessionToken, signal: controller.signal }, SurveyRuntimeSchema),
        readAidtStage(projectId, 6, session!.sessionToken, controller.signal),
        listProjectResources(projectId),
      ]);
      const group = stageResult.stage && readAidtTestGroups(stageResult.stage.content.draft.fields).find(item => item.id === groupId && !item.archived);
      if (controller.signal.aborted || current.current !== expected || fresh.id !== surveyId || JSON.stringify(fresh) !== JSON.stringify(runtime)
        || !resources.items.some(item => item.kind === "survey" && item.id === surveyId)
        || group?.source?.kind !== "survey" || group.source.id !== surveyId || group.surveyResponseId !== responseId) throw new Error("问卷、答卷、项目关联或访问状态已变化，请刷新后重试。");
      return fresh;
    }
    try {
      const fresh = await readCurrent();
      const selectedResponse = responseId && fresh.responses.find(item => item.id === responseId && item.analysis !== "excluded");
      const selectedBatch = selectedResponse && selectedResponse.collectionBatchId ? fresh.collectionBatches?.find(item => item.id === selectedResponse.collectionBatchId) : null;
      if (responseId && !selectedResponse) throw new Error("已保存的答卷当前不可读取，未打开打印预览。");
      if (selectedResponse && (selectedResponse.collectionBatchId && !selectedBatch
        || !selectedResponse.collectionBatchId && (fresh.collectionBatches?.length ?? 0) > 1))
        throw new Error("无法确定答卷对应的发布版本，未打开打印预览。");
      const sourceQuestions = selectedBatch?.questions ?? fresh.publication?.questions ?? fresh.questions;
      if (!sourceQuestions.length) throw new Error("当前保存版本没有可打印的问题，未打开空白文档。");
      if (kind === "report") {
        if (!fresh.report || !fresh.report.sections.length || fresh.reportBasisVersion !== fresh.version - 1 || fresh.reportBasisAnswerRevision !== fresh.answerRevision)
          throw new Error("调查报告尚未生成或已过期，请在原生问卷中生成当前版本报告后再打印。");
        const blocked = surveyReportShareBlockedReason(fresh.report);
        if (blocked) throw new Error(blocked);
        const response = responseId && fresh.responses.find(item => item.id === responseId && item.analysis !== "excluded");
        if (!response) throw new Error("请先保存本次测试的可用答卷，再打印答卷与调查报告。");
        if (response.collectionBatchId && !fresh.collectionBatches?.some(batch => batch.id === response.collectionBatchId)
          || !response.collectionBatchId && (fresh.collectionBatches?.length ?? 0) > 1)
          throw new Error("无法确定答卷对应的发布版本，未打开打印预览。");
      }
      if (controller.signal.aborted || current.current !== expected) return;
      flushSync(() => setDocument({ kind, runtime: fresh, scope: expected }));
      const original = root.current;
      if (!original) throw new Error("原生文档尚未就绪，请重试。");
      const snapshot = original.cloneNode(true) as HTMLElement;
      // Preserve native question options when stripping interactive form controls.
      snapshot.querySelectorAll("select").forEach(select => {
        const list = window.document.createElement("ul");
        for (const option of Array.from(select.options)) { const item = window.document.createElement("li"); item.textContent = option.text; list.append(item); }
        select.replaceWith(list);
      });
      snapshot.querySelectorAll("input,textarea").forEach(control => {
        const field = control as HTMLInputElement | HTMLTextAreaElement;
        const text = window.document.createElement("span");
        text.textContent = field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type) ? "□ " : field.value || "________________";
        control.replaceWith(text);
      });
      watch = setInterval(() => {
        if (checking || controller.signal.aborted || current.current !== expected) return;
        checking = true;
        void readCurrent().catch(() => { stillAvailable = false; controller.abort(); }).finally(() => { checking = false; });
      }, 5000);
      await previewAidtPdf(snapshot, fresh.title + (kind === "questionnaire" ? " · 调查问卷" : " · 答卷与调查报告"), {
        defaultPaper: kind === "questionnaire" ? "A4" : "A3",
        isCurrent: () => stillAvailable && !controller.signal.aborted && current.current === expected && root.current === original,
      });
    } catch (cause) {
      if (current.current === expected) setError(cause instanceof Error ? cause.message : "原生文档无法读取，未打印。");
    } finally {
      if (watch) clearInterval(watch);
      controller.abort();
      if (abort.current === controller) { abort.current = null; setPending(false); }
    }
  }
  const visible = document?.scope === scope ? document : null;
  const selected = visible?.runtime.responses.find(item => item.id === responseId && item.analysis !== "excluded");
  const batch = selected?.collectionBatchId ? visible?.runtime.collectionBatches?.find(item => item.id === selected.collectionBatchId) : null;
  const questions = batch?.questions ?? visible?.runtime.publication?.questions ?? visible?.runtime.questions ?? [];
  return <section className="space-y-3" aria-label="原生问卷与报告打印">
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="xs" disabled={pending || !session?.sessionToken || !groupId} onClick={() => void print("questionnaire")}>打印调查问卷</Button>
      <Button type="button" variant="outline" size="xs" disabled={pending || !session?.sessionToken || !groupId} onClick={() => void print("report")}>打印答卷与调查报告</Button>
    </div>
    {error && <p role="alert" className="text-12 text-destructive">{error}</p>}
    {visible && <details open><summary className="cursor-pointer">查看本次打印的原生文档</summary><div ref={root} className="space-y-5 rounded-lg border border-border bg-card p-4">
      <p>问卷 {visible.runtime.id} · 保存 V{visible.runtime.version} · 答卷修订 {visible.runtime.answerRevision}</p>
      {visible.kind === "questionnaire" ? <article aria-label="已保存调查问卷"><h1>{visible.runtime.title}</h1>
        <p>{batch ? `发布批次 ${batch.id} · V${batch.version}` : visible.runtime.publication ? `发布版本 V${visible.runtime.publication.version}` : "已保存草稿，尚未发布"}</p>
        <fieldset disabled className="space-y-4">{questions.map(question => <SurveyQuestionRenderer key={question.id} question={question} onChange={() => undefined} shuffleSeed="aidt-print" />)}</fieldset>
      </article> : <>
        <p>报告依据：问卷 V{visible.runtime.reportBasisVersion} · 答卷修订 {visible.runtime.reportBasisAnswerRevision} · 生成时间 {visible.runtime.reportGeneratedAt || "未记录"}</p>
        {visible.runtime.report && <SurveyReportDocument report={visible.runtime.report} />}
        {selected && <section aria-label="本测试已保存答卷"><h2>本测试答卷原始回答</h2>
          <p>答卷 {selected.id} · {selected.submittedAt} · {selected.durationSeconds} 秒 · 发布批次 {selected.collectionBatchId || "旧版单批次"} · {selected.quality === "normal" ? "正常质量" : "待复核"}</p>
          <ol>{questions.filter(question => !isSurveyPageElement(question)).map(question => {
            const answer = selected.answers.find(item => item.questionId === question.id);
            return <li key={question.id}><h3>{question.title}</h3><p className="whitespace-pre-wrap">{answer ? formatSurveyAnswer(question, answer.value) : "未填写"}</p></li>;
          })}</ol>
        </section>}
      </>}
    </div></details>}
  </section>;
}
