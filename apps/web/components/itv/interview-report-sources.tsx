"use client";
import { useI18n } from "@/lib/i18n/provider";
import { interviewMarkdown } from "@repo/contracts";

/** Source text is displayed verbatim; model role claims never supply attribution. */
export function InterviewReportSources({ report, sources, experts }: {
  report: interviewMarkdown.InterviewMarkdownDocument;
  sources: readonly interviewMarkdown.InterviewMarkdownDocument[];
  experts: readonly { expertId: string; displayName: string }[];
}) {
 const { t } = useI18n();
  const references = report.references.filter(reference => reference.locator);
  if (!references.length) return null;
  return <section aria-label={t("itv.sources.region")} className="mt-8 space-y-4 border-t border-border pt-6">
    <h3 className="text-lg font-semibold">{t("itv.sources.title")}</h3>
    {references.map(reference => {
      const locator = reference.locator!;
      const source = sources.find(document => document.documentId === reference.documentId && document.version === reference.version);
      const matches = Boolean(source && source.contentHash === locator.sourceHash && source.evidenceMode === locator.evidenceMode && locator.end <= source.markdown.length && source.markdown.slice(locator.start, locator.end) === locator.quote);
      const span = source?.answerSpans?.find(item => item.taskKey === locator.taskKey && item.expertId === locator.expertId && item.start <= locator.start && item.end >= locator.end);
      const attributed = matches && Boolean(span);
      const name = attributed ? experts.find(expert => expert.expertId === locator.expertId)?.displayName ?? t("itv.sources.savedAnswer") : t("itv.sources.unverified");
      return <article id={`itv-source-${reference.anchor}`} key={reference.anchor} tabIndex={-1} style={{ scrollMarginTop: "calc(var(--itv-header-height, 8rem) + 1rem)" }} className="rounded-xl border border-border bg-muted/20 p-4 focus-visible:ring-2 focus-visible:ring-ring">
        <p className="mb-3 text-sm font-medium">{t("itv.sources.version", { name, version: reference.version })}</p>
        {matches ? <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-4 text-sm leading-7">{source!.markdown.slice(locator.start, locator.end)}</blockquote> : <p role="alert" className="text-sm leading-6 text-destructive">{t("itv.sources.mismatch")}</p>}
      </article>;
    })}
  </section>;
}
