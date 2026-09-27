"use client";

import { interviewMarkdown } from "@repo/contracts";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { InterviewReportMarkdown } from "./interview-report-markdown";

/** Cards are a read-only AST view of the saved Markdown, never a second research body. */
export function InterviewAnalysisStep({ document, pending, onGenerate, onConfirm, failure }: {
  readonly document: InterviewMarkdownDocument | null;
  readonly pending: boolean;
  readonly onGenerate: () => void;
  readonly onConfirm: () => void;
  readonly failure?: string | null;
}) {
  const projection = document ? interviewMarkdown.parseInterviewMarkdown(document) : null;
  const sections = projection?.sections.map((section) => {
    const blockIndex = projection.blocks.findIndex((block) => block.headingId === section.headingId);
    const block = projection.blocks[blockIndex];
    return { ...section,
      title: projection.headings.find((heading) => heading.id === section.headingId)?.text ?? "分析说明",
      markdown: document!.markdown.slice(block?.contentStart ?? 0, projection.blocks[blockIndex + 1]?.start ?? document!.markdown.length),
    };
  }).filter((section) => section.text.trim()) ?? [];
  const suggestions = sections.filter((section) => /建议|假设|局限|边界/u.test(section.title));
  const cards = sections.filter((section) => !suggestions.includes(section));
  return <section data-testid="itv-analysis-workbench">
    <header><h2 className="text-2xl font-semibold tracking-tight">AI 分析结果</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">基于已确认需求生成。请审阅研究范围与假设，再继续选择专家。</p></header>
    {failure && <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{failure}。已保存内容保留，可重试。</p>}
    {!document && <div className="mt-5 rounded-xl border border-dashed border-border p-8 text-center"><p className="text-sm text-muted-foreground">尚未生成分析，不展示预设结论。</p><Button className="mt-4" variant="primary" disabled={pending} onClick={onGenerate}><Sparkles className="size-4" aria-hidden />{pending ? "正在生成…" : "生成研究分析"}</Button></div>}
    {document && <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="space-y-4">{cards.map((section) => <article key={section.headingId ?? "intro"} className="rounded-xl border border-border bg-card p-5"><h3 className="text-lg font-semibold">{section.title}</h3><InterviewReportMarkdown markdown={section.markdown} testId={`itv-analysis-card-${section.headingId ?? "intro"}`} /></article>)}</div>
      <aside className="rounded-xl border border-border bg-muted/30 p-5"><h3 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5" aria-hidden />AI 建议与边界</h3>{suggestions.length ? suggestions.map((section) => <div key={section.headingId} className="mt-5"><h4 className="text-sm font-semibold">{section.title}</h4><InterviewReportMarkdown markdown={section.markdown} testId={`itv-analysis-suggestion-${section.headingId}`} /></div>) : <p className="mt-4 text-sm leading-6 text-muted-foreground">当前文档未单列建议。请补充审阅，不自动生成通用建议。</p>}<p className="mt-5 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">文档版本 {document.version}。AI 分析是研究规划建议，不替代真实用户证据。</p></aside>
    </div>}
    <footer className="mt-6 flex flex-wrap justify-end gap-3">{document && <Button variant="outline" disabled={pending} onClick={onGenerate}><RotateCcw className="size-4" aria-hidden />重新生成分析</Button>}<Button variant="primary" disabled={pending || !document || Boolean(failure)} onClick={onConfirm}>确认分析并选择专家<ArrowRight className="size-4" aria-hidden /></Button></footer>
  </section>;
}
