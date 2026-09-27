import { InterviewReportMarkdown } from "./interview-report-markdown";

export function InterviewMarkdownSurface({
  title,
  markdown,
  version,
  evidenceLabel,
  failure,
}: {
  readonly title: string;
  readonly markdown: string;
  readonly version?: number;
  readonly evidenceLabel: string;
  readonly failure?: string | null;
}) {
  if (!markdown.trim()) return null;
  return <aside data-testid="itv-step-markdown-artifact" className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-medium text-primary">Markdown 产物{version ? ` · v${version}` : " · 待确认"}</p><h2 className="mt-1 text-sm font-semibold">{title}</h2></div><span className="rounded-full bg-background px-2.5 py-1 text-xs text-muted-foreground">{evidenceLabel}</span></div>
    <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">查看 Markdown 源</summary><pre data-testid="itv-markdown-source" className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-xs leading-5 text-muted-foreground">{markdown}</pre></details>
    <div className="mt-4 border-t border-primary/10 pt-3"><p className="text-xs font-medium text-muted-foreground">渲染预览</p><InterviewReportMarkdown markdown={markdown} testId="itv-markdown-preview" /></div>
    {failure && <p role="alert" className="mt-3 text-sm text-destructive">生成失败：{failure}。已保存内容，可重试。</p>}
  </aside>;
}
