"use client";

import * as React from "react";
import { BarChart3, FileText, Image, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { survey } from "@repo/contracts";
import { SectionTitle } from "./survey-workflow-shell";

const OUTPUTS = [
  { value: "text" as const, label: "文本", icon: FileText },
  { value: "chart" as const, label: "图表", icon: BarChart3 },
  { value: "image" as const, label: "图片", icon: Image },
];

const CHART_TYPES: { value: survey.SurveyChartType; label: string; description: string }[] = [
  { value: "gap-matrix", label: "差距矩阵", description: "当前值与目标值对比" },
  { value: "capability-table", label: "能力表", description: "能力项评分与等级汇总" },
  { value: "grouped-bar", label: "分组柱状图", description: "不同业务分组横向比较" },
  { value: "line", label: "折线图", description: "时间或阶段趋势变化" },
  { value: "radar", label: "雷达图", description: "多能力维度轮廓对比" },
];

export function ReportTemplateStep({ model, setModel, readonly }: { model: survey.SurveyWorkflowModel; setModel: React.Dispatch<React.SetStateAction<survey.SurveyWorkflowModel>>; readonly: boolean }) {
  const [sectionId, setSectionId] = React.useState("gap");
  const section = model.reportTemplate.sections.find((item) => item.id === sectionId) ?? model.reportTemplate.sections[0]!;
  const updateSection = (patch: Partial<typeof section>) => setModel((current) => ({
    ...current,
    reportTemplate: { sections: current.reportTemplate.sections.map((item) => item.id === section.id ? { ...item, ...patch } : item) },
  }));
  const chartType = CHART_TYPES.find((item) => item.value === section.chartType);

  return <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 xl:grid-cols-[18rem_minmax(32rem,1fr)_26rem]">
    <aside className="border-b border-border bg-card p-4 xl:border-b-0 xl:border-r" data-testid="survey-template-section-list"><SectionTitle title="报告章节" description="定义正式报告的结构与管理问题" />{!readonly && <Button className="mb-3 w-full" variant="ai" size="sm"><Sparkles className="h-3.5 w-3.5" aria-hidden />重新生成章节</Button>}<ol className="space-y-1">{model.reportTemplate.sections.map((item, index) => <li key={item.id}><button type="button" data-testid={`survey-template-section-${item.id}`} onClick={() => setSectionId(item.id)} className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-11 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${section.id === item.id ? "border-primary bg-accent text-primary" : "border-transparent hover:bg-muted"}`}><span className="flex h-5 w-5 items-center justify-center rounded-full border border-border">{index + 1}</span><span>{item.title}</span></button></li>)}</ol>{!readonly && <Button className="mt-4 w-full" variant="outline" size="sm"><Plus className="h-3.5 w-3.5" aria-hidden />新增章节</Button>}</aside>
    <section className="p-5" data-testid="survey-template-editor"><SectionTitle title={section.title} description="定义本章要解决的管理问题，并指定输出方式与约束" /><div className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-sm"><div><Label htmlFor="management-question">本章要回答的管理问题</Label><Textarea id="management-question" className="mt-1" value={section.managementQuestion} readOnly /></div><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="analysis-method">分析方法</Label><Input id="analysis-method" className="mt-1" value={section.method} readOnly /></div><div><Label htmlFor="evidence-scope">证据范围</Label><Input id="evidence-scope" className="mt-1" value="有效样本 + 历史基线（2024 H1）" readOnly /></div></div>
      <div><Label>指定本章输出方式</Label><div className="mt-2 grid grid-cols-3 rounded-md border border-border">{OUTPUTS.map(({ value, label, icon: Icon }) => <Button key={value} type="button" data-testid={`survey-template-output-${value}`} aria-pressed={section.output === value} disabled={readonly} onClick={() => updateSection({ output: value, chartType: value === "chart" ? section.chartType ?? "gap-matrix" : undefined })} variant={section.output === value ? "ai" : "ghost"} className="rounded-none"><Icon className="h-4 w-4" />{label}</Button>)}</div></div>
      {section.output === "chart" && <div data-testid="survey-template-chart-types"><Label>具体图表类型</Label><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{CHART_TYPES.map((item) => <Button key={item.value} type="button" data-testid={`survey-template-chart-type-${item.value}`} aria-pressed={section.chartType === item.value} disabled={readonly} onClick={() => updateSection({ chartType: item.value })} variant={section.chartType === item.value ? "ai" : "outline"} className="h-auto justify-start px-3 py-3 text-left"><span><span className="block text-11 font-medium">{item.label}</span><span className="mt-1 block text-9 font-normal text-muted-foreground">{item.description}</span></span></Button>)}</div></div>}
      <div><Label>输出组件（可多选与排序）</Label><div className="mt-2 grid gap-2 md:grid-cols-3">{["差距矩阵","能力表","分组图表"].map((item) => <div key={item} className="rounded-md border border-primary/30 bg-accent p-3"><p className="text-12 font-medium">{item}</p><p className="mt-1 text-10 text-muted-foreground">按能力维度与分组展示差距</p></div>)}</div></div><div className="grid gap-3 md:grid-cols-2"><div><Label htmlFor="structure-rule">结构要求</Label><Textarea id="structure-rule" className="mt-1" value="1. 先总览后细节；\n2. 先差距矩阵，再能力表；\n3. 每个图表带一句结论。" readOnly /></div><div><Label htmlFor="risk-boundary">禁止项 / 风险边界</Label><Textarea id="risk-boundary" className="mt-1" value="不得展示个人层面数据；不得用过小样本做分组；避免得出因果性结论。" readOnly /></div></div></div></section>
    <aside className="border-t border-border bg-card p-5 xl:border-l xl:border-t-0" data-testid="survey-template-preview"><SectionTitle title="约束预览" description="当前章节的输出边界与效果示例" /><div className="rounded-lg border border-border p-4"><span className="text-10 text-primary">本章</span><h3 className="mt-1 text-18 font-semibold">{section.title}</h3><dl className="mt-4 space-y-3 text-12"><div className="flex justify-between"><dt className="text-muted-foreground">主要输出方式</dt><dd>{OUTPUTS.find((item) => item.value === section.output)?.label}</dd></div>{chartType && <div className="flex justify-between"><dt className="text-muted-foreground">图表类型</dt><dd>{chartType.label}</dd></div>}<div className="flex justify-between"><dt className="text-muted-foreground">证据样本数</dt><dd>1,248</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">分组维度数</dt><dd>2（业务单元、职能）</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">有效样本</dt><dd>1,183（95%）</dd></div></dl></div><div className="mt-4 rounded-lg border border-border p-4"><p className="text-12 font-semibold">输出效果预览{chartType ? ` · ${chartType.label}` : ""}</p><div className="mt-3 grid grid-cols-5 gap-2">{[72,48,58,84,92].map((height,index) => <div key={index} className="flex h-28 items-end rounded-sm bg-muted p-1"><div className="w-full rounded-sm bg-primary" style={{ height: `${height}%` }} /></div>)}</div></div><div className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-4 text-11"><p className="font-semibold">模板不是直接正文</p><p className="mt-1 text-muted-foreground">正式生成时会重新读取最新数据、执行分析并生成文字与图表。</p></div></aside>
  </div>;
}
