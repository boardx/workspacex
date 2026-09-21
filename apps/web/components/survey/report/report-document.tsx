"use client";

import { useState } from "react";
import { SurveyReportChart } from "./report-chart";
export { SurveyReportChart } from "./report-chart";
import type { survey } from "@repo/contracts";

import { reportNumber, REPORT_COLORS } from "./report-format";
export { reportNumber } from "./report-format";
const rowLabel = (row: survey.SurveyReportRow) =>
  [row.label, row.group].filter(Boolean).join(" · ");

function ReportImage({ block }: { block: survey.CompiledSurveyBlock }) {
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
          {failed ? "图片加载失败，请检查图片地址后重试" : "尚未配置图片"}
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
  return (
    <table className="w-full border-collapse text-13">
      <thead>
        <tr>
          {[
            "指标",
            "数值",
            "有效样本",
            ...(block.type === "gap" ? ["目标", "差距"] : []),
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
              {reportNumber(row.value)}
            </td>
            <td className="border-b border-border px-3 py-2">{row.count}</td>
            {block.type === "gap" && (
              <>
                <td className="border-b border-border px-3 py-2">
                  {row.target === undefined
                    ? "未设置"
                    : reportNumber(row.target)}
                </td>
                <td className="border-b border-border px-3 py-2">
                  {row.gap === undefined ? "无法计算" : reportNumber(row.gap)}
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
  return (
    <article
      data-testid="survey-report-document"
      className="mx-auto max-w-5xl bg-background p-6 font-sans text-background-foreground sm:p-10"
    >
      <h1 className="mb-10 border-b border-border pb-6 text-24 font-bold leading-relaxed">{report.title}</h1>
      {!report.sections.length && (
        <p className="text-muted-foreground">尚无报告章节</p>
      )}
      {report.sections.map((section, sectionIndex) => (
        <section
          key={section.id}
          id={`survey-report-anchor-${section.id}`}
          data-section-id={section.id}
          className="mb-10 scroll-mt-4"
        >
          <h2 style={{ color: REPORT_COLORS[sectionIndex % REPORT_COLORS.length], borderLeftColor: REPORT_COLORS[sectionIndex % REPORT_COLORS.length] }} className="mb-6 border-l-2 border-primary pl-4 text-20 font-semibold">{section.title}</h2>
          {!section.blocks.length && (
            <p className="text-muted-foreground">本章尚无内容</p>
          )}
          {section.blocks.map((block) =>
            block.type === "page-break" ? (
              <div
                key={block.id}
                data-page-break="true"
                style={{ breakAfter: "page" }}
              />
            ) : (
              <div key={block.id} className="mb-8 rounded-lg border border-border p-5 sm:p-6" data-report-block={block.id}>
                <h3 className="mb-3 text-16 font-semibold">{block.title}</h3>
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
                        <p className="text-13 text-muted-foreground">
                          暂无可展示数据
                        </p>
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
                                    {reportNumber(row.value)}
                                  </dd>
                                  <dd className="text-12 text-muted-foreground">
                                    有效样本 {row.count}
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
                    aria-label="数据说明"
                  >
                    {[...block.issues, ...(block.warnings ?? [])].map(
                      (issue, i) => (
                        <li key={i}>{issue}</li>
                      ),
                    )}
                  </ul>
                )}
              </div>
            ),
          )}
        </section>
      ))}
    </article>
  );
}
