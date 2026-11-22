"use client";

import * as React from "react";
import Link from "next/link";
import { formatSurveyAnswer } from "@repo/contracts/survey";
import { SurveyRuntimeSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { useOptionalSession } from "@/components/session/session-provider";
import { withProjectId } from "@/components/project/project-breadcrumb";
import { Button } from "@/components/ui/button";
import { surveyPath } from "@/lib/survey/paths";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { AidtTestSurveyPrint } from "./aidt-test-survey-print";
import { AidtResearchMaterialIdentifier } from "../lib/aidt-research-material-reference";

export function AidtTestSurveyCollection({ projectId, groupId, surveyId, responseId, canEdit = false, onSelect }: {
  projectId: string;
  groupId?: string;
  surveyId: string;
  responseId?: string;
  canEdit?: boolean;
  onSelect?: (responseId: string | undefined, locator: string) => void;
}) {
  const sessionToken = useOptionalSession()?.session?.sessionToken;
  const [attempt, refresh] = React.useReducer((value: number) => value + 1, 0);
  const [state, setState] = React.useState<SurveyRuntime | "failed" | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    setState(null);
    if (!sessionToken) return;
    void surveyRequest(`/surveys/${encodeURIComponent(surveyId)}`, { signal: controller.signal, sessionToken }, SurveyRuntimeSchema).then(
      value => { if (!controller.signal.aborted) setState(value.id === surveyId ? value : "failed"); },
      () => { if (!controller.signal.aborted) setState("failed"); },
    );
    return () => controller.abort();
  }, [attempt, projectId, sessionToken, surveyId]);
  if (state === null) return <p role="status">正在读取原生问卷…</p>;
  if (state === "failed") return <div><p role="alert">无法读取关联问卷。已保存的来源引用会保留。</p><Button type="button" variant="ghost" size="xs" onClick={refresh}>重试读取问卷</Button></div>;
  if (state.id !== surveyId) return null;
  const included = state.responses.filter(response => response.analysis !== "excluded" && AidtResearchMaterialIdentifier.safeParse(response.id).success);
  const selected = included.find(response => response.id === responseId);
  const batches = state.collectionBatches ?? [];
  const publication = selected?.collectionBatchId
    ? batches.find(batch => batch.id === selected.collectionBatchId)
    : batches.length <= 1 ? state.publication : null;
  const answers = (selected?.answers ?? []).flatMap(answer => {
    const question = publication?.questions?.find(item => item.id === answer.questionId);
    return question ? [{ id: question.id, title: question.title, text: formatSurveyAnswer(question, answer.value) }] : [];
  });
  const active = state.publication?.status === "collecting" ? state.publication : null;
  return <div className="space-y-2 text-12" aria-label="问卷收集与回读">
    <div className="flex flex-wrap gap-3">
      {canEdit && <Link className="text-primary underline" href={withProjectId(surveyPath(surveyId, "publish"), projectId)}>打开问卷发布</Link>}
      {active && canEdit && <Link className="text-primary underline" href={`/surveys/${encodeURIComponent(active.token)}`} target="_blank" rel="noreferrer">打开填写链接</Link>}
      <Link className="text-primary underline" href={withProjectId(surveyPath(surveyId, "responses"), projectId)}>查看原生答卷</Link>
      <Link className="text-primary underline" href={withProjectId(surveyPath(surveyId, "report"), projectId)}>查看调查报告与导出</Link>
      {canEdit && <Button type="button" variant="ghost" size="xs" onClick={refresh}>刷新答卷</Button>}
    </div>
    <p>{state.publication ? (active ? "收集中" : "收集已结束") : "待发布"} · {included.length} 份可用答卷</p>
    {canEdit && included.length > 0 && <label className="block">选择本测试的答卷证据
      <select className="mt-1 w-full rounded-control border border-border bg-background p-2" value={selected?.id ?? ""} onChange={event => {
        const chosen = included.find(response => response.id === event.currentTarget.value);
        onSelect?.(chosen?.id, chosen ? `答卷 ${chosen.id}`.slice(0, 180) : "");
      }}>
        <option value="">暂未选择</option>
        {included.map((response, index) => <option key={response.id} value={response.id}>答卷 {index + 1} · {response.submittedAt.slice(0, 10)}</option>)}
      </select>
    </label>}
    {responseId && <p className="break-all">{selected ? `已定位答卷 ${selected.id}` : "已保存的答卷当前不可读取。"}</p>}
    {answers.length > 0 && <details>
      <summary className="cursor-pointer">查看所选答卷的原始回答</summary>
      <dl className="mt-2 space-y-2">{answers.map(answer => <div key={answer.id}><dt className="font-medium">{answer.title}</dt><dd className="whitespace-pre-wrap break-words">{answer.text}</dd></div>)}</dl>
    </details>}
    <AidtTestSurveyPrint projectId={projectId} groupId={groupId} surveyId={surveyId} responseId={responseId} runtime={state} />
    <p className="text-muted-foreground">填写意向与真实购买、耗时分别记录。</p>
  </div>;
}
