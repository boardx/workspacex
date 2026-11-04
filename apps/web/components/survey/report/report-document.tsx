"use client";
import { displaySurveyReportIssue } from "@/lib/survey/display-report-issue";
import { useI18n } from "@/lib/i18n/provider";

import { useState } from "react";
import { SurveyReportChart } from "./report-chart";
export { SurveyReportChart } from "./report-chart";
import type { survey } from "@repo/contracts";
import { SURVEY_INSIGHT_ACTION_LABELS, surveyInsightAction, surveySampleNotice } from "./report-sample-qualification";

import { reportNumber, REPORT_COLORS } from "./report-format";
export { reportNumber } from "./report-format";
const rowLabel = (row: survey.SurveyReportRow) =>
  [row.label, row.group].filter(Boolean).join(" · ");

function ReportImage({ block }: { block: survey.CompiledSurveyBlock }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  // Report images retain their original URLs for isolated print and Word export.
  return (
    <figure>
      {block.imageUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageUrl}
          alt={block.caption ?? block.title}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="max-w-full"
        />
      ) : (
        <p role="status" data-report-image-error="true">
          {failed ? t("survey.results.imageFailed") : t("survey.results.imageMissing")}
        </p>
      )}
      {block.caption && (
        <figcaption className="mt-2 text-12 text-muted-foreground">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}
export function SurveyReportDataTable({
  block,
}: {
  block: survey.CompiledSurveyBlock;
}) {
  const { t, locale } = useI18n();
  return (
    <table className="w-full border-collapse text-13">
      <thead>
        <tr>
          {[
            t("survey.results.metric"),
            t("survey.results.value"),
            t("survey.results.validSample"),
            ...(block.type === "gap" ? [t("survey.results.target"), t("survey.results.gap")] : []),
          ].map((text) => (
            <th
              key={text}
              className="border-b border-border px-3 py-2 text-left"
            >
              {text}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row, i) => (
          <tr key={i}>
            <td className="border-b border-border px-3 py-2">
              {rowLabel(row)}
            </td>
            <td className="border-b border-border px-3 py-2">
              {reportNumber(row.value, locale)}
            </td>
            <td className="border-b border-border px-3 py-2">{row.count}</td>
            {block.type === "gap" && (
              <>
                <td className="border-b border-border px-3 py-2">
                  {row.target === undefined
                    ? t("survey.results.notSet")
                    : reportNumber(row.target, locale)}
                </td>
                <td className="border-b border-border px-3 py-2">
                  {row.gap === undefined ? t("survey.results.cannotCalculate") : reportNumber(row.gap, locale)}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function SurveyReportDocument({
  report,
}: {
  report: survey.CompiledSurveyReport;
}) {
  const { t, locale } = useI18n();
  const sampleNotice = surveySampleNotice(report.sampleSummary?.included);
  return (
    <article
      data-testid="survey-report-document"
      className="mx-auto max-w-5xl border border-border bg-card p-6 font-sans text-card-foreground shadow-sm sm:p-10"
    >
      <h1 className="mb-10 border-b border-border pb-6 text-24 font-bold leading-relaxed">{report.title}</h1>
      {report.sampleSummary && <p className="mb-6 text-12 text-muted-foreground" data-testid="survey-report-sample-summary">
        {t("survey.results.sampleSummary", { total: report.sampleSummary.total, review: report.sampleSummary.pendingReview, excluded: report.sampleSummary.excluded, included: report.sampleSummary.included })}
      </p>}
      {sampleNotice && report.sampleSummary && (
        <p role="status" aria-label={t(sampleNotice.tier === "descriptive" ? "survey.results.sampleLowLabel" : "survey.results.sampleExploreLabel")} className="mb-6 rounded-lg border border-warning/40 bg-warning/5 p-4 text-13 leading-6">
          {t(sampleNotice.tier === "descriptive" ? "survey.results.sampleLowText" : "survey.results.sampleExploreText", { count: report.sampleSummary.included })}
        </p>
      )}
      {!report.sections.length && (
        <p className="text-muted-foreground">{t("survey.results.noChapters")}</p>
      )}
      {report.sections.map((section, sectionIndex) => (
        <section
          key={section.id}
          id={`survey-report-anchor-${section.id}`}
          data-section-id={section.id}
          className="mb-10 scroll-mt-4"
        >
          <h2 style={{ color: REPORT_COLORS[sectionIndex % REPORT_COLORS.length], borderLeftColor: REPORT_COLORS[sectionIndex % REPORT_COLORS.length] }} className="mb-6 border-l-2 border-primary pl-4 text-20 font-semibold">{section.title}</h2>
          {!!section.analysis?.length && (
            <div className="mb-6 space-y-4" data-testid="survey-section-analysis">
              {section.analysis.map((insight, index) => {
                const action = surveyInsightAction(report, section, insight);
                return <div key={index} className="rounded-lg border border-border bg-muted/30 p-5">
                  <h3 className="mb-2 text-16 font-semibold text-primary">{insight.title}</h3>
                  <p className="text-14 leading-7">{insight.evidence}</p>
                  {action && <p className="mt-3 text-14 leading-7"><strong>{t(action.label === SURVEY_INSIGHT_ACTION_LABELS.exploratory ? "survey.results.actionExplore" : "survey.results.actionSufficient")}</strong>{action.text}</p>}
                </div>;
              })}
            </div>
          )}
          {!section.blocks.length && (
            <p className="text-muted-foreground">{t("survey.results.noChapterContent")}</p>
          )}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {section.blocks.map((block) =>
            block.type === "page-break" ? (
              <div
                key={block.id}
                data-page-break="true"
                style={{ breakAfter: "page" }}
              />
            ) : (
              <div key={block.id} className={`rounded-lg border border-border p-5 ${block.type === "metric" ? "" : "sm:col-span-2"}`} data-report-block={block.id}>
                <h3 className="mb-3 text-16 font-semibold">{block.title}</h3>
                {!["text", "image", "page-break"].includes(block.type) && (
                  <p className="mb-3 text-12 text-muted-foreground" data-testid={`survey-report-block-sample-${block.id}`}>
                    {t("survey.results.samplePolicy", { policy: t(block.samplePolicy === "all" ? "survey.results.allIncluded" : "survey.results.normalOnly"), count: block.sampleSize ?? t("survey.results.notRecorded") })}
                  </p>
                )}
                {block.text && (
                  <p className="mb-4 whitespace-pre-wrap text-14 leading-7">
                    {block.text}
                  </p>
                )}
                {block.type === "image" ? (
                  <ReportImage key={block.imageUrl} block={block} />
                ) : (
                  block.type !== "text" && (
                    <>
                      {block.answerTexts?.length ? (
                        <dl className="space-y-3">
                          {block.answerTexts.map((answer, index) => (
                            <div key={index}>
                              <dt className="text-13 font-medium">
                                {answer.label !== block.title ? answer.label : null}
                              </dt>
                              <dd className="whitespace-pre-wrap text-14 leading-7">
                                {answer.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : !block.rows.length ? (
                        <p className="text-13 text-muted-foreground">{t("survey.results.noData")}</p>
                      ) : (
                        <>
                          {block.type === "metric" && (
                            <dl className="mb-4 grid gap-4 sm:grid-cols-2">
                              {block.rows.map((row, i) => (
                                <div
                                  key={i}
                                  className="border-l-2 border-primary pl-4"
                                >
                                  <dt className="text-13 text-muted-foreground">
                                    {rowLabel(row) !== block.title ? rowLabel(row) : null}
                                  </dt>
                                  <dd style={{ color: REPORT_COLORS[sectionIndex % REPORT_COLORS.length] }} className="text-24 font-semibold">
                                    {reportNumber(row.value, locale)}
                                  </dd>
                                  <dd className="text-12 text-muted-foreground">{t("survey.results.validSample")}{" "}{row.count}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          {["bar", "radar", "line"].includes(block.type) && (
                            <SurveyReportChart block={block} />
                          )}
                          {["table", "gap"].includes(block.type) && <SurveyReportDataTable block={block} />}
                        </>
                      )}
                    </>
                  )
                )}
                {block.type !== "image" && block.caption && (
                  <p className="mt-2 text-12 text-muted-foreground">
                    {block.caption}
                  </p>
                )}
                {[...block.issues, ...(block.warnings ?? [])].length > 0 && (
                  <ul
                    className="mt-3 text-13 text-muted-foreground"
                    aria-label={t("survey.results.notes")}
                  >
                    {[...block.issues, ...(block.warnings ?? [])].map(
                      (issue, i) => (
                        <li key={i}>{displaySurveyReportIssue(issue, t)}</li>
                      ),
                    )}
                  </ul>
                )}
              </div>
            ),
          )}
          </div>
        </section>
      ))}
    </article>
  );
}
