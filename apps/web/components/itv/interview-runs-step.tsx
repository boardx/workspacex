"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { ExpertAvatar } from "./expert-avatar";
import { InterviewReportMarkdown } from "./interview-report-markdown";
type RunMetadata = Readonly<{ expertId: string; displayName: string; status: "pending" | "running" | "completed" | "failed"; completedQuestions: number; totalQuestions: number }>;
export function InterviewRunsStep({ runs, document, pending, onGenerateReport, taskProgress = false }: {
  readonly runs: readonly RunMetadata[]; readonly document?: interviewMarkdown.InterviewMarkdownDocument;
  readonly pending: boolean; readonly onGenerateReport: () => void;
  readonly taskProgress?: boolean;
}) {
  const [expert, setExpert] = React.useState<string | null>(null);
  const projection = document ? interviewMarkdown.parseInterviewMarkdown(document) : null;
  const attributed = projection?.blocks.filter((block) => block.links.some((link) => link.url === `#expert-${expert}`)) ?? [];
  const summaryMarkdown = !expert ? document?.markdown : attributed.map((block) => document!.markdown.slice(block.start, block.end)).join("\n\n");
  const total = runs.reduce((sum, run) => sum + run.totalQuestions, 0);
  const answered = runs.reduce((sum, run) => sum + Math.min(run.completedQuestions, run.totalQuestions), 0);
  const progress = total ? Math.round(answered / total * 100) : 0;
  const ready = runs.length > 0 && runs.every((run) => run.status === "completed") && Boolean(document?.markdown.trim());
  return <div data-testid="itv-source-runs">
    <section className="mb-5 rounded-xl border border-border p-5"><h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">开始访谈</h2><p className="mt-2 text-base leading-7 text-muted-foreground">{taskProgress ? "已完成专家" : "已保存回答"} {answered}/{total} · 模拟内容不替代真实受访者证据</p><div role="progressbar" aria-label="访谈整体进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-foreground" style={{ width: `${progress}%` }} /></div></section>
    <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
<aside className="rounded-xl border border-border p-5"><h3 className="mb-4 font-semibold">专家进度</h3><div className="space-y-3">{runs.map((run) => <section key={run.expertId} className="rounded-lg border border-border p-4"><div className="flex items-center gap-3"><ExpertAvatar expertId={run.expertId} displayName={run.displayName} /><h4 className="font-medium">{run.displayName}</h4></div><p className="mt-2 text-sm text-muted-foreground">{run.status === "completed" ? "已完成" : run.status === "failed" ? "执行失败，已保存内容保留" : run.status === "pending" ? "等待访谈" : "进行中"} · {run.completedQuestions}/{run.totalQuestions}</p></section>)}</div>{!runs.length && <p className="text-sm text-muted-foreground">暂无已登记访谈任务，不会显示示例进度。</p>}</aside>
      <section className="min-w-0 rounded-xl border border-border p-5"><h3 className="font-semibold">实时访谈摘要</h3>
        <div role="tablist" aria-label="访谈摘要范围" className="mt-4 flex flex-wrap gap-2">
          {[{ id: null, name: "全部（实时汇总）" }, ...runs.map((run) => ({ id: run.expertId, name: run.displayName }))].map((tab) => <button key={tab.id ?? "all"} type="button" role="tab" aria-selected={expert === tab.id} onClick={() => setExpert(tab.id)} className={`rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring ${expert === tab.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{tab.name}</button>)}
        </div>
        <div role="tabpanel" aria-label={expert ? `${runs.find((run) => run.expertId === expert)?.displayName ?? "专家"}访谈摘要` : "全部访谈摘要"}>
          {summaryMarkdown ? <InterviewReportMarkdown document={expert ? undefined : document} markdown={summaryMarkdown} testId="itv-source-runs-markdown" /> : <p className="mt-4 text-sm text-muted-foreground">{expert ? "暂无归属于该专家的已保存回答。" : "暂无已保存的 Markdown 回答。"}</p>}
        </div>
        <div className="mt-5 flex justify-end"><Button disabled={!ready || pending} onClick={onGenerateReport}>{pending ? "正在汇总…" : "汇总报告"}</Button></div></section>
    </div>
  </div>;
}
