"use client";

import { interviewMarkdown } from "@repo/contracts";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { InterviewStepHeader, InterviewStepActions } from "./interview-step-header";

/** Cards are a read-only AST view of the saved Markdown, never a second research body. */
export function InterviewAnalysisStep({ document, pending, onGenerate, onConfirm, failure }: {
  readonly document: InterviewMarkdownDocument | null;
  readonly pending: boolean;
  readonly onGenerate: () => void;
  readonly onConfirm: () => void;
  readonly failure?: string | null;
}) {
  const projection = document ? interviewMarkdown.projectInterviewAnalysis(document) : null;
  const sections = projection?.sections ?? [];
  const isSuggestion = (kind: string | null) => ["recommendations", "hypotheses", "boundaries"].includes(kind ?? "");
  const suggestions = sections.filter(section => isSuggestion(section.kind));
  const cards = sections.filter(section => !isSuggestion(section.kind));
  const missingSuggestions = interviewMarkdown.INTERVIEW_ANALYSIS_SECTIONS.filter(item => isSuggestion(item.kind) && projection?.missing.includes(item.kind));
  return <section data-testid="itv-analysis-workbench">
    <InterviewStepHeader title="AI 分析结果" />
    {failure && <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{failure}。已保存内容保留，可重试。</p>}
    {!document && <div data-testid={pending ? "loading" : "empty"} className="mt-5 rounded-xl border border-dashed border-border p-8 text-center"><p className="text-sm text-muted-foreground">{pending ? "正在载入分析…" : "尚未生成分析。"}</p></div>}
    {document && <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="grid min-w-0 auto-rows-min gap-4 md:grid-cols-2">{cards.map((section) => <article key={section.headingId ?? "intro"} className="min-w-0 rounded-xl border border-border bg-card p-5"><h3 className="text-lg font-semibold">{section.title}</h3><InterviewReportMarkdown markdown={section.markdown} testId={`itv-analysis-card-${section.headingId ?? "intro"}`} /></article>)}</div>
      <aside className="rounded-xl border border-border bg-muted/30 p-5"><h3 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5" aria-hidden />AI 建议与边界</h3>{suggestions.map((section) => <div key={section.headingId} className="mt-5"><h4 className="text-sm font-semibold">{section.title}</h4><InterviewReportMarkdown markdown={section.markdown} testId={`itv-analysis-suggestion-${section.headingId}`} /></div>)}{missingSuggestions.length > 0 && <p className="mt-4 text-sm leading-6 text-muted-foreground">缺少{missingSuggestions.map(item => item.title).join("、")}。请重新生成分析，补齐与本次需求相关的访谈设计。</p>}</aside>
    </div>}
    <InterviewStepActions>{document && <ActionButton variant="outline" loading={pending} icon={<RotateCcw className="size-4" aria-hidden />} disabled={pending} onClick={onGenerate}>重新生成分析</ActionButton>}{!document && <ActionButton variant="outline" loading={pending} icon={<Sparkles className="size-4" aria-hidden />} disabled={pending} onClick={onGenerate}>{pending ? "正在生成…" : "生成研究分析"}</ActionButton>}<ActionButton variant="primary" loading={pending} icon={<ArrowRight className="size-4" aria-hidden />} disabled={pending || !document || Boolean(failure)} onClick={onConfirm}>选择专家</ActionButton></InterviewStepActions>
  </section>;
}
