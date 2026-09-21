"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, RadarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { survey } from "@repo/contracts";

echarts.use([BarChart, LineChart, RadarChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, SVGRenderer]);

const wrap = (text: string) => text.match(/.{1,16}/gu)?.join("\n") ?? text;
export function reportChartOptions(block: survey.CompiledSurveyBlock): echarts.EChartsCoreOption {
  const singleQuestion = new Set(block.rows.map(row => row.label)).size === 1;
  const prefix = block.rows[0]?.label.split(" · ").slice(0, -1).join(" · ");
  const sharedPrefix = prefix && block.rows.every(row => row.label.startsWith(`${prefix} · `));
  const labels = block.rows.map(row => {
    if (singleQuestion && row.group) return row.group;
    const label = sharedPrefix && ["distribution", "percentage"].includes(block.statistic) ? row.label.slice(prefix.length + 3) : row.label;
    return [label, row.group].filter(Boolean).join(" · ");
  });
  const base = {
    animation: false,
    color: ["#237c74", "#548bc1", "#b58b46", "#8c78ad", "#ce7663"],
    textStyle: { fontFamily: "sans-serif", fontSize: 12 },
    aria: { enabled: true },
    tooltip: { trigger: "item", renderMode: "richText" },
  };
  if (block.type === "bar") return {
    ...base,
    grid: { left: 12, right: 55, top: 12, bottom: 24, containLabel: true },
    xAxis: { type: "value", minInterval: ["distribution", "count"].includes(block.statistic) ? 1 : undefined, splitLine: { lineStyle: { color: "#e8eeec" } } },
    yAxis: { type: "category", inverse: true, data: labels, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { formatter: wrap, color: "#405450", lineHeight: 18 } },
    series: [{ type: "bar", data: block.rows.map(row => row.value), barMaxWidth: 22, itemStyle: { borderRadius: 3 }, label: { show: true, position: "right" } }],
  };
  const categories = [...new Set(block.rows.map(row => row.label))];
  const groups = [...new Set(block.rows.map(row => row.group ?? "数据"))];
  const series = groups.map(name => ({ name, values: categories.map(label => block.rows.find(row => row.label === label && (row.group ?? "数据") === name)?.value ?? null) }));
  if (block.type === "radar") return {
    ...base,
    legend: { bottom: 0, type: "scroll" },
    radar: { radius: "58%", indicator: categories.map(name => ({ name: wrap(name), min: Math.min(0, ...block.rows.map(row => row.value)), max: Math.max(1, ...block.rows.map(row => row.value)) })), axisName: { color: "#405450" } },
    series: [{ type: "radar", data: series.map(item => ({ name: item.name, value: item.values })), areaStyle: { opacity: 0.08 } }],
  };
  return {
    ...base,
    legend: { bottom: 0, type: "scroll" },
    grid: { left: 15, right: 30, top: 20, bottom: 65, containLabel: true },
    xAxis: { type: "category", data: categories, axisLabel: { formatter: wrap } },
    yAxis: { type: "value" },
    series: series.map(item => ({ name: item.name, type: "line", data: item.values, connectNulls: false, symbolSize: 7 })),
  };
}
export const reportChartHeight = (block: survey.CompiledSurveyBlock) => block.type === "bar"
  ? Math.max(180, block.rows.reduce((height, row) => height + Math.max(44, Math.ceil((row.group || row.label).length / 16) * 18 + 12), 50)) : 400;

/** The same options power browser interaction and static export. */
export function reportChartSvg(block: survey.CompiledSurveyBlock) {
  const chart = echarts.init(null, undefined, { renderer: "svg", ssr: true, width: 760, height: reportChartHeight(block) });
  try { chart.setOption(reportChartOptions(block)); return chart.renderToSVGString(); }
  finally { chart.dispose(); }
}

export function SurveyReportChart({ block }: { block: survey.CompiledSurveyBlock }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !block.rows.length) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.setOption(reportChartOptions(block));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [block]);
  if (!block.rows.length) return null;
  return <div ref={ref} data-chart={block.type} role="img" aria-label={block.title} style={{ width: "100%", height: reportChartHeight(block) }} />;
}
