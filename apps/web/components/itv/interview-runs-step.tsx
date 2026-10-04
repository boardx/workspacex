"use client";
import * as React from "react";
import { ArrowRight, Check, FileText, Loader2 } from "lucide-react";
import { interviewMarkdown } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { ExpertAvatar } from "./expert-avatar";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { interviewTranscriptDisplay } from "./interview-transcript-display";
import { InterviewStepHeader } from "./interview-step-header";
import styles from "./interview-runs-step.module.css";
type RunMetadata = Readonly<{ expertId: string; displayName: string; status: "pending" | "running" | "completed" | "failed"; completedQuestions: number; totalQuestions: number }>;
type InsightKind = "观点" | "发现" | "风险" | "追问";
const insightTitles: Record<InsightKind, string> = { 观点: "关键观点", 发现: "核心发现", 风险: "争议点与风险", 追问: "后续追问方向" };
function insightKind(title: string): InsightKind | null {
  const normalized = title.trim().replace(/[：:]$/u, "").replace(/\s+/gu, "");
  const headings: Record<string, InsightKind> = {
    关键观点: "观点", 主要观点: "观点", 核心发现: "发现", 关键发现: "发现",
    争议点与风险: "风险", 争议点: "风险", 风险: "风险",
    后续追问方向: "追问", 后续追问: "追问", 追问方向: "追问",
  };
  return headings[normalized] ?? null;
}
/** UI-only projection from the saved document; no generated or duplicate research content. */
function savedInsights(document: interviewMarkdown.InterviewMarkdownDocument, projection: interviewMarkdown.InterviewMarkdownProjection) {
  const insights: { kind: InsightKind; headingId: string; markdown: string; count: number; expertId: string | null }[] = [];
  let activeExpert: string | null = null;
  for (const block of projection.blocks) {
    const expertLink = block.links.find((link) => /^#expert-[a-zA-Z0-9_-]+$/u.test(link.url));
    if (expertLink) { activeExpert = expertLink.url.slice(8); continue; }
    const kind = insightKind(block.title);
    if (!kind) continue;
    const markdown = document.markdown.slice(block.contentStart, block.end).trim();
    if (!markdown) continue;
    const entries = projection.entries.filter((entry) => entry.headingId === block.headingId).length;
    insights.push({ kind, headingId: block.headingId, markdown, count: entries, expertId: activeExpert });
  }
  return insights;
}
export function InterviewRunsStep({ runs, document, pending, onGenerateReport, taskProgress = false, actions }: {
  readonly runs: readonly RunMetadata[]; readonly document?: interviewMarkdown.InterviewMarkdownDocument;
  readonly pending: boolean; readonly onGenerateReport: () => void;
  readonly taskProgress?: boolean;
  readonly actions?: React.ReactNode;
}) {
  const [expert, setExpert] = React.useState<string | null>(null);
  const projection = document ? interviewMarkdown.parseInterviewMarkdown(document) : null;
  // Provider headings may be shallower than the server's expert wrapper. Only
  // another attributed expert wrapper ends a saved expert segment.
  const attributed = projection?.blocks.filter((block) => block.links.some((link) => /^#expert-[a-zA-Z0-9_-]+$/u.test(link.url))) ?? [];
  const summaryMarkdown = !expert ? document?.markdown : attributed.flatMap((block, index) =>
    block.links.some((link) => link.url === `#expert-${expert}`)
      ? [document!.markdown.slice(block.start, attributed[index + 1]?.start ?? document!.markdown.length)] : [],
  ).join("\n\n");
  const displayMarkdown = summaryMarkdown ? interviewTranscriptDisplay(summaryMarkdown, document?.evidenceMode === "simulated", runs) : undefined;
  const displayDocument = document && displayMarkdown ? { ...document, markdown: displayMarkdown } : undefined;
  const insights = document && projection ? savedInsights(document, projection).filter((item) => !expert || item.expertId === expert) : [];
  const total = runs.reduce((sum, run) => sum + run.totalQuestions, 0);
  const completed = runs.filter((run) => run.status === "completed").length;
  const answered = runs.reduce((sum, run) => sum + Math.min(run.completedQuestions, run.totalQuestions), 0);
  const ready = runs.length > 0 && runs.every((run) => run.status === "completed") && Boolean(document?.markdown.trim());
  const statusCounts = [
    { status: "completed", label: "已完成", color: "bg-success/10 text-success" },
    { status: "running", label: "进行中", color: "bg-primary/10 text-primary" },
    { status: "pending", label: "等待访谈", color: "bg-muted text-muted-foreground" },
    { status: "failed", label: "执行失败", color: "bg-destructive/10 text-destructive" },
  ] as const;
  return <div data-testid="itv-source-runs" className="space-y-5">
    <InterviewStepHeader title="访谈内容" testId="itv-runs-report-action">
      {actions}
      <Button variant="primary" size="lg" disabled={!ready || pending} onClick={onGenerateReport}><FileText className="size-4" aria-hidden />{pending ? "正在生成报告…" : "生成报告"}<ArrowRight className="size-4" aria-hidden /></Button>
    </InterviewStepHeader>
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>{taskProgress ? `已完成专家 ${completed}/${runs.length}` : `已保存回答 ${answered}/${total}`}</span><div aria-label="专家任务状态" className="flex flex-wrap gap-2">{statusCounts.map(({ status, label, color }) => { const count = runs.filter((run) => run.status === status).length; return count ? <span key={status} className={`rounded-full px-2 py-1 ${color}`}>{label} {count}</span> : null; })}</div></div>
    <div className="grid items-start overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]">
      <aside aria-label="访谈专家" className="min-w-0 border-b border-border bg-muted/20 p-4 lg:self-stretch lg:border-b-0 lg:p-5">
        <div className="mb-4 flex items-center justify-between px-2"><h3 className="text-sm font-semibold">访谈专家</h3><span className="text-xs text-muted-foreground">{runs.length} 位</span></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{runs.map((run) => {
          const selected = expert === run.expertId;
          const name = run.displayName.match(/^(.+?)\s*[（(]([^）)]+)[）)]$/u);
          const status = run.status === "completed" ? "已完成" : run.status === "failed" ? "执行失败，已保存内容保留" : run.status === "pending" ? "等待访谈" : "进行中";
          return <button key={run.expertId} type="button" aria-label={`${run.displayName} ${status}`} aria-current={selected ? "true" : undefined} aria-pressed={selected} onClick={() => setExpert(selected ? null : run.expertId)} className={`min-w-0 w-full rounded-lg p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-background shadow-sm ring-1 ring-inset ring-border" : "hover:bg-background/80"}`}>
            <div className="flex items-start gap-3"><ExpertAvatar expertId={run.expertId} displayName={run.displayName} className="size-10" /><div className="min-w-0 flex-1">
              <h4 className="break-words text-sm font-semibold leading-6 [word-break:normal]">{name?.[1] ?? run.displayName}</h4>
              {name && <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground [word-break:normal]">{name[2]}</p>}
              <p className={`mt-2 flex items-center gap-1.5 text-xs ${run.status === "completed" ? "text-success" : "text-muted-foreground"}`}>
                {run.status === "completed" && <Check className="size-3.5" aria-hidden />}{run.status === "running" && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}
                {status}{taskProgress ? "" : ` · ${run.completedQuestions}/${run.totalQuestions}`}
              </p>
            </div></div>
          </button>;
        })}</div>
        {!runs.length && <p className="px-2 text-sm text-muted-foreground">暂无已登记访谈任务。</p>}
      </aside>
      <section className="min-w-0 overflow-hidden lg:border-l lg:border-border">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4 sm:px-8">
          <h3 className="text-base font-semibold">访谈记录</h3>
        </header>
        <div role="region" className={`${styles.transcript} px-5 py-6 sm:px-8 sm:py-7`} aria-label={expert ? `${runs.find((run) => run.expertId === expert)?.displayName ?? "专家"}访谈摘要` : "全部访谈摘要"}>
          {insights.length > 0 && <div data-testid="itv-saved-insights" className="mb-7 grid gap-4 border-b border-border pb-6 xl:grid-cols-2">{(["观点", "发现", "风险", "追问"] as const).map((kind) => { const group = insights.filter((item) => item.kind === kind); return group.length ? <section key={kind} className="min-w-0 border-l-2 border-border pl-4"><h4 className="font-semibold">{insightTitles[kind]}（{group.reduce((sum, item) => sum + item.count, 0)}）</h4>{group.map((item) => <InterviewReportMarkdown key={item.headingId} markdown={item.markdown} testId={`itv-saved-insight-${item.headingId}`} />)}</section> : null; })}</div>}
          {displayMarkdown ? <InterviewReportMarkdown longForm document={displayDocument} markdown={displayMarkdown} testId="itv-source-runs-markdown" /> : <p className="mt-4 text-sm text-muted-foreground">{expert ? "暂无归属于该专家的已保存回答。" : "暂无已保存的 Markdown 回答。"}</p>}
        </div>
        </section>
    </div>
  </div>;
}
