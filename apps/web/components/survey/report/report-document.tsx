"use client";

import { useState } from "react";
import type { survey } from "@repo/contracts";

export const reportNumber = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
const rowLabel = (row: survey.SurveyReportRow) =>
  [row.label, row.group].filter(Boolean).join(" · ");

/** Shared SVG geometry is also rasterized for Word: charts never substitute invented data. */
export function SurveyReportChart({
  block,
}: {
  block: survey.CompiledSurveyBlock;
}) {
  const rows = block.rows;
  if (!rows.length) return null;
  const min = Math.min(0, ...rows.map((row) => row.value));
  const max = Math.max(0, ...rows.map((row) => row.value));
  const span = max - min || 1;
  const x = (value: number) => 170 + ((value - min) / span) * 350;
  if (block.type === "bar")
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        data-chart="bar"
        role="img"
        aria-label={`${block.title} 柱状图`}
        width={640}
        height={rows.length * 36 + 35}
        viewBox={`0 0 640 ${rows.length * 36 + 35}`}
        className="w-full text-primary"
        style={{ fontFamily: "sans-serif", height: "auto" }}
      >
        <line
          x1={x(0)}
          x2={x(0)}
          y1={0}
          y2={rows.length * 36}
          stroke="currentColor"
        />
        {rows.map((row, i) => (
          <g key={i}>
            <text x={0} y={i * 36 + 22} fontSize={12} fill="currentColor">
              {rowLabel(row).slice(0, 20)}
            </text>
            <rect
              x={Math.min(x(0), x(row.value))}
              y={i * 36 + 6}
              width={Math.abs(x(row.value) - x(0))}
              height={22}
              fill="currentColor"
              opacity={0.7}
            />
            <text x={535} y={i * 36 + 22} fontSize={12} fill="currentColor">
              {reportNumber(row.value)}
            </text>
          </g>
        ))}
        <text
          x={170}
          y={rows.length * 36 + 24}
          fontSize={12}
          fill="currentColor"
        >
          {reportNumber(min)}
        </text>
        <text
          x={500}
          y={rows.length * 36 + 24}
          fontSize={12}
          fill="currentColor"
        >
          {reportNumber(max)}
        </text>
      </svg>
    );
  const groups = [...new Set(rows.map((row) => row.group ?? "数据"))];
  const labels = [...new Set(rows.map((row) => row.label))].sort((a, b) =>
    block.type === "line" ? a.localeCompare(b) : 0,
  );
  const point = (i: number, value: number) => {
    if (block.type === "radar") {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / labels.length;
      const radius = ((value - min) / span) * 130;
      return `${320 + Math.cos(angle) * radius},${170 + Math.sin(angle) * radius}`;
    }
    const dates = labels.map((label) => Date.parse(label.slice(0, 10)));
    const first = dates[0] ?? 0,
      last = dates.at(-1) ?? first;
    const ratio =
      dates.every(Number.isFinite) && last !== first
        ? (dates[i]! - first) / (last - first)
        : i / Math.max(1, labels.length - 1);
    return `${60 + ratio * 500},${290 - ((value - min) / span) * 240}`;
  };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      data-chart={block.type}
      role="img"
      aria-label={`${block.title} ${block.type === "radar" ? "雷达图" : "时间趋势"}`}
      width={640}
      height={360 + groups.length * 20}
      viewBox={`0 0 640 ${360 + groups.length * 20}`}
      className="w-full text-primary"
      style={{ fontFamily: "sans-serif", height: "auto" }}
    >
      {block.type === "radar" ? (
        labels.map((label, i) => (
          <g key={label}>
            <line
              x1={320}
              y1={170}
              x2={point(i, max).split(",")[0]}
              y2={point(i, max).split(",")[1]}
              stroke="currentColor"
              opacity={0.3}
            />
            <text
              x={point(i, max).split(",")[0]}
              y={Number(point(i, max).split(",")[1]) - 8}
              textAnchor="middle"
              fontSize={11}
              fill="currentColor"
            >
              {label.slice(0, 20)}
            </text>
          </g>
        ))
      ) : (
        <>
          <path d="M60 50V290H560" fill="none" stroke="currentColor" />
          <text x={5} y={55} fontSize={12} fill="currentColor">
            {reportNumber(max)}
          </text>
          <text x={5} y={290} fontSize={12} fill="currentColor">
            {reportNumber(min)}
          </text>
          {labels.map((label, i) => (
            <text
              key={label}
              x={point(i, min).split(",")[0]}
              y={310 + (i % 2) * 16}
              fontSize={10}
              textAnchor="middle"
              fill="currentColor"
            >
              {label}
            </text>
          ))}
        </>
      )}
      {groups.map((group, gi) => {
        const series = labels.flatMap((label, i) => {
          const row = rows.find(
            (r) => r.label === label && (r.group ?? "数据") === group,
          );
          return row ? [{ row, p: point(i, row.value) }] : [];
        });
        const points = series.map((item) => item.p).join(" ");
        return (
          <g key={group}>
            {block.type === "radar" ? (
              <polygon
                points={points}
                fill="currentColor"
                fillOpacity={0.08}
                stroke="currentColor"
                strokeDasharray={gi ? `${gi * 3} 3` : undefined}
              />
            ) : (
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray={gi ? `${gi * 3} 3` : undefined}
              />
            )}
            {series.map(({ row, p }, i) => (
              <circle
                key={i}
                cx={p.split(",")[0]}
                cy={p.split(",")[1]}
                r={3}
                fill="currentColor"
              >
                <title>
                  {rowLabel(row)}：{reportNumber(row.value)}
                </title>
              </circle>
            ))}
            <text x={60} y={350 + gi * 20} fontSize={12} fill="currentColor">
              {group}
              {gi ? `（虚线 ${gi}）` : "（实线）"} · 范围 {reportNumber(min)}–
              {reportNumber(max)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ReportImage({ block }: { block: survey.CompiledSurveyBlock }) {
  const [failed, setFailed] = useState(false);
  // Report images retain their original URLs for isolated print and Word export.
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <figure>
      {block.imageUrl && !failed ? (
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
      className="bg-background p-6 font-sans text-background-foreground sm:p-10"
    >
      <h1 className="mb-8 text-24 font-bold">{report.title}</h1>
      {!report.sections.length && (
        <p className="text-muted-foreground">尚无报告章节</p>
      )}
      {report.sections.map((section) => (
        <section
          key={section.id}
          id={`survey-report-anchor-${section.id}`}
          data-section-id={section.id}
          className="mb-10 scroll-mt-4"
        >
          <h2 className="mb-6 text-20 font-semibold">{section.title}</h2>
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
              <div key={block.id} className="mb-8" data-report-block={block.id}>
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
                      {!block.rows.length ? (
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
                                    {rowLabel(row)}
                                  </dt>
                                  <dd className="text-24 font-semibold">
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
                          <SurveyReportDataTable block={block} />
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
