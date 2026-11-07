"use client";
import { useI18n } from "@/lib/i18n/provider";
import { Loader2, Check } from "lucide-react";
import type { InterviewGenerationSession } from "@/lib/interview-generation-session";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { InterviewStepHeader } from "./interview-step-header";
const stages = [["context", "itv.report.stage.context"], ["model", "itv.report.stage.model"], ["validation", "itv.report.stage.validation"], ["storage", "itv.report.stage.storage"]] as const;
export function InterviewReportGeneration({ session }: { session: InterviewGenerationSession }) {
 const { t } = useI18n();
  const index = stages.findIndex(([stage]) => stage === session.stage);
  return <section aria-busy="true" data-testid="itv-report-generation">
    <InterviewStepHeader title={t("itv.report.title")} />
    <ol aria-label={t("itv.report.progress")} className="mb-6 grid gap-3 sm:grid-cols-4">
      {stages.map(([stage, label], order) => <li key={stage} aria-current={order === index ? "step" : undefined} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
        {order < index ? <Check className="size-4" aria-hidden /> : order === index ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <span className="text-muted-foreground">{order + 1}</span>}{t(label)}
      </li>)}
    </ol>
    <p role="status" className="mb-4 text-sm text-muted-foreground">{session.attempt && session.attempt > 1 ? t("itv.report.revising") : t("itv.report.streaming")}{t("itv.report.incomplete")}</p>
    {session.markdown ? <InterviewReportMarkdown markdown={session.markdown} longForm testId="itv-report-stream-markdown" /> : session.previousCandidateMarkdown ? <div><p className="mb-3 text-sm text-muted-foreground">{t("itv.report.previous")}</p><InterviewReportMarkdown markdown={session.previousCandidateMarkdown} longForm testId="itv-report-previous-candidate" /></div> : <p className="py-10 text-sm text-muted-foreground">{t("itv.report.preparing")}</p>}
  </section>;
}
