"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { ExpertAvatar } from "./expert-avatar";
import { InterviewReportMarkdown } from "./interview-report-markdown";
type RunMetadata = Readonly<{ expertId: string; displayName: string; status: "pending" | "running" | "completed" | "failed"; completedQuestions: number; totalQuestions: number }>;
type InsightKind = "观点" | "发现" | "风险" | "追问";
const insightTitles: Record<InsightKind, string> = { 观点: "关键观点", 发现: "核心发现", 风险: "争议点与风险", 追问: "后续追问方向" };
function insightKind(title: string): InsightKind | null {
  if (/关键观点|主要观点/u.test(title)) return "观点";
  if (/核心发现|关键发现/u.test(title)) return "发现";
  if (/争议|风险/u.test(title)) return "风险";
  if (/后续追问|追问方向/u.test(title)) return "追问";
  return null;
}
/** UI-only projection from the saved document; no generated or duplicate research content. */
function savedInsights(document: interviewMarkdown.InterviewMarkdownDocument, projection: interviewMarkdown.InterviewMarkdownProjection) {
  const insights: { kind: InsightKind; headingId: string; markdown: string; count: number; expertId: string | null }[] = [];
  let activeExpert: string | null = null;
  let expertDepth = 0;
  for (const block of projection.blocks) {
    if (activeExpert && block.depth <= expertDepth) activeExpert = null;
    const expertLink = block.links.find((link) => /^#expert-[a-zA-Z0-9_-]+$/u.test(link.url));
    if (expertLink) { activeExpert = expertLink.url.slice(8); expertDepth = block.depth; continue; }
    const kind = insightKind(block.title);
    if (!kind) continue;
    const markdown = document.markdown.slice(block.contentStart, block.end).trim();
    if (!markdown) continue;
    const entries = projection.entries.filter((entry) => entry.headingId === block.headingId).length;
    insights.push({ kind, headingId: block.headingId, markdown, count: entries || 1, expertId: activeExpert });
  }
  return insights;
}
export function InterviewRunsStep({ runs, document, pending, onGenerateReport, taskProgress = false }: {
  readonly runs: readonly RunMetadata[]; readonly document?: interviewMarkdown.InterviewMarkdownDocument;
  readonly pending: boolean; readonly onGenerateReport: () => void;
  readonly taskProgress?: boolean;
}) {
  const [expert, setExpert] = React.useState<string | null>(null);
  const projection = document ? interviewMarkdown.parseInterviewMarkdown(document) : null;
  const attributed = projection?.blocks.filter((block) => block.links.some((link) => link.url === `#expert-${expert}`)) ?? [];
  const summaryMarkdown = !expert ? document?.markdown : attributed.map((block) => document!.markdown.slice(block.start, block.end)).join("\n\n");
  const insights = document && projection ? savedInsights(document, projection).filter((item) => !expert || item.expertId === expert) : [];
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
<aside className="rounded-xl border border-border p-5"><h3 className="mb-4 font-semibold">专家进度（{runs.length}）</h3><div className="space-y-3">{runs.map((run) => <section key={run.expertId} className="rounded-lg border border-border p-4"><div className="flex items-center gap-3"><ExpertAvatar expertId={run.expertId} displayName={run.displayName} /><h4 className="font-medium">{run.displayName}</h4></div><p className="mt-2 text-sm text-muted-foreground">{run.status === "completed" ? "已完成" : run.status === "failed" ? "执行失败，已保存内容保留" : run.status === "pending" ? "等待访谈" : "进行中"}{taskProgress ? "" : ` · ${run.completedQuestions}/${run.totalQuestions}`}</p></section>)}</div>{!runs.length && <p className="text-sm text-muted-foreground">暂无已登记访谈任务，不会显示示例进度。</p>}</aside>
      <section className="min-w-0 rounded-xl border border-border p-5"><h3 className="font-semibold">实时访谈摘要</h3>
        <div role="tablist" aria-label="访谈摘要范围" className="mt-4 flex flex-wrap gap-2">
          {[{ id: null, name: "全部（实时汇总）" }, ...runs.map((run) => ({ id: run.expertId, name: run.displayName }))].map((tab) => <button key={tab.id ?? "all"} type="button" role="tab" aria-selected={expert === tab.id} onClick={() => setExpert(tab.id)} className={`rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring ${expert === tab.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{tab.name}</button>)}
        </div>
        <div role="tabpanel" aria-label={expert ? `${runs.find((run) => run.expertId === expert)?.displayName ?? "专家"}访谈摘要` : "全部访谈摘要"}>
          {insights.length > 0 && <div data-testid="itv-saved-insights" className="mt-4 grid gap-3 xl:grid-cols-2">{(["观点", "发现", "风险", "追问"] as const).map((kind) => { const group = insights.filter((item) => item.kind === kind); return group.length ? <section key={kind} className="rounded-lg border border-border bg-muted/30 p-4"><h4 className="font-semibold">{insightTitles[kind]}（{group.reduce((sum, item) => sum + item.count, 0)}）</h4>{group.map((item) => <InterviewReportMarkdown key={item.headingId} markdown={item.markdown} testId={`itv-saved-insight-${item.headingId}`} />)}</section> : null; })}</div>}
          {summaryMarkdown ? <InterviewReportMarkdown document={expert ? undefined : document} markdown={summaryMarkdown} testId="itv-source-runs-markdown" /> : <p className="mt-4 text-sm text-muted-foreground">{expert ? "暂无归属于该专家的已保存回答。" : "暂无已保存的 Markdown 回答。"}</p>}
        </div>
        <div className="mt-5 flex justify-end"><Button disabled={!ready || pending} onClick={onGenerateReport}>{pending ? "正在汇总…" : "汇总报告"}</Button></div></section>
    </div>
  </div>;
}
