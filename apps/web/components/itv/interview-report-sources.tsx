"use client";
import { interviewMarkdown } from "@repo/contracts";

/** Source text is displayed verbatim; model role claims never supply attribution. */
export function InterviewReportSources({ report, sources, experts }: {
  report: interviewMarkdown.InterviewMarkdownDocument;
  sources: readonly interviewMarkdown.InterviewMarkdownDocument[];
  experts: readonly { expertId: string; displayName: string }[];
}) {
  const references = report.references.filter(reference => reference.locator);
  if (!references.length) return null;
  return <section aria-label="报告引用原文" className="mt-8 space-y-4 border-t border-border pt-6">
    <h3 className="text-lg font-semibold">引用原文</h3>
    <p className="text-sm leading-6 text-muted-foreground">逐字引用可核对保存的回答；结论和推断仍需复核。</p>
    {references.map(reference => {
      const locator = reference.locator!;
      const source = sources.find(document => document.documentId === reference.documentId && document.version === reference.version);
      const matches = Boolean(source && source.contentHash === locator.sourceHash && source.evidenceMode === locator.evidenceMode && locator.end <= source.markdown.length && source.markdown.slice(locator.start, locator.end) === locator.quote);
      const span = source?.answerSpans?.find(item => item.taskKey === locator.taskKey && item.expertId === locator.expertId && item.start <= locator.start && item.end >= locator.end);
      const attributed = matches && Boolean(span);
      const name = attributed ? experts.find(expert => expert.expertId === locator.expertId)?.displayName ?? "已保存专家回答" : "身份未验证";
      return <article id={`itv-source-${reference.anchor}`} key={reference.anchor} tabIndex={-1} style={{ scrollMarginTop: "calc(var(--itv-header-height, 8rem) + 1rem)" }} className="rounded-xl border border-border bg-muted/20 p-4 focus-visible:ring-2 focus-visible:ring-ring">
        <p className="mb-3 text-sm font-medium">{name} · 回答版本 {reference.version} · {locator.evidenceMode === "simulated" ? "模拟证据，需真人验证" : "证据资格以来源审核为准"}</p>
        {matches ? <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-4 text-sm leading-7">{source!.markdown.slice(locator.start, locator.end)}</blockquote> : <p role="alert" className="text-sm leading-6 text-destructive">当前可用材料与引用版本或原文不一致，无法验证此引用。报告原文保留，请审阅来源。</p>}
      </article>;
    })}
  </section>;
}
