"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { ExpertAvatar } from "./expert-avatar";
import { InterviewReportMarkdown } from "./interview-report-markdown";
type RunMetadata = Readonly<{ expertId: string; displayName: string; status: "pending" | "running" | "completed" | "failed"; completedQuestions: number; totalQuestions: number }>;
const statusLabel: Record<RunMetadata["status"], string> = {
  completed: "已完成", failed: "执行失败，已保存内容保留", pending: "等待访谈", running: "进行中",
};
export function InterviewRunsStep({ runs, document, pending, onGenerateReport, taskProgress = false }: {
  readonly runs: readonly RunMetadata[]; readonly document?: interviewMarkdown.InterviewMarkdownDocument;
  readonly pending: boolean; readonly onGenerateReport: () => void;
  readonly taskProgress?: boolean;
}) {
  const [expert, setExpert] = React.useState<string | null>(null);
  const projection = document ? interviewMarkdown.parseInterviewMarkdown(document) : null;
  const selectedExpertId = runs.some((run) => run.expertId === expert) ? expert : runs[0]?.expertId ?? null;
  const selectedRun = runs.find((run) => run.expertId === selectedExpertId);
  const selectedBlock = projection?.blocks.find((block) => block.links.some((link) => link.url === `#expert-${selectedExpertId}`));
  const selectedMarkdown = document
    ? selectedBlock
      ? document.markdown.slice(selectedBlock.start, selectedBlock.end).trim()
      : runs.length === 1 ? document.markdown : ""
    : "";
  const total = runs.reduce((sum, run) => sum + run.totalQuestions, 0);
  const answered = runs.reduce((sum, run) => sum + Math.min(run.completedQuestions, run.totalQuestions), 0);
  const completed = runs.filter((run) => run.status === "completed").length;
  const progress = total ? Math.round(answered / total * 100) : 0;
  const ready = runs.length > 0 && runs.every((run) => run.status === "completed") && Boolean(document?.markdown.trim());
  const statusCounts = [
    { status: "completed", label: "已完成", color: "bg-success/10 text-success" },
    { status: "running", label: "进行中", color: "bg-primary/10 text-primary" },
    { status: "pending", label: "等待访谈", color: "bg-muted text-muted-foreground" },
    { status: "failed", label: "执行失败", color: "bg-destructive/10 text-destructive" },
  ] as const;
  return <div data-testid="itv-source-runs">
    <section className="mb-5 rounded-xl border border-border p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">开始访谈</h2><p className="mt-2 text-base leading-7 text-muted-foreground">{taskProgress ? `已完成专家 ${completed}/${runs.length}` : `已保存回答 ${answered}/${total}`} · 模拟内容不替代真实受访者证据</p></div><div aria-label="专家任务状态" className="flex flex-wrap gap-2">{statusCounts.map(({ status, label, color }) => { const count = runs.filter((run) => run.status === status).length; return count ? <span key={status} className={`rounded-full px-3 py-1 text-sm font-medium ${color}`}>{label} {count}</span> : null; })}</div></div><div role="progressbar" aria-label="访谈整体进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div></section>
    <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="rounded-xl border border-border p-5"><h3 className="mb-4 font-semibold">专家进度（{runs.length}）</h3><div className="space-y-3">{runs.map((run) => { const selected = run.expertId === selectedExpertId; return <button key={run.expertId} type="button" aria-label={`查看${run.displayName}的模拟访谈`} aria-current={selected ? "true" : undefined} onClick={() => setExpert(run.expertId)} className={`w-full rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}><span className="flex items-center gap-3"><ExpertAvatar expertId={run.expertId} displayName={run.displayName} /><span className="font-medium">{run.displayName}</span></span><span className="mt-2 block text-sm text-muted-foreground">{statusLabel[run.status]}{taskProgress ? "" : ` · ${run.completedQuestions}/${run.totalQuestions}`}</span></button>; })}</div>{!runs.length && <p className="text-sm text-muted-foreground">暂无已登记访谈任务，不会显示示例进度。</p>}</aside>
      <section className="min-w-0 rounded-xl border border-border p-5" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{selectedRun ? `${selectedRun.displayName}模拟访谈` : "模拟访谈"}</h3>{selectedRun && <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">{statusLabel[selectedRun.status]}</span>}</div>
        <div aria-label={selectedRun ? `${selectedRun.displayName}模拟访谈内容` : "模拟访谈内容"}>
          {selectedMarkdown ? <InterviewReportMarkdown markdown={selectedMarkdown} testId="itv-source-runs-markdown" /> : <p className="mt-4 text-sm text-muted-foreground">{selectedRun ? "暂无该专家的已保存模拟访谈内容。" : "暂无已登记访谈任务。"}</p>}
        </div>
        <div className="mt-5 flex justify-end"><Button disabled={!ready || pending} onClick={onGenerateReport}>{pending ? "正在汇总…" : "汇总报告"}</Button></div></section>
    </div>
  </div>;
}
