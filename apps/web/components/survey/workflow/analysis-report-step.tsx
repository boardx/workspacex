"use client";

import * as React from "react";
import { CheckCircle2, Download, FileText, Lightbulb, RefreshCw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SurveyMetrics, SurveyWorkflowModel } from "@/lib/survey/workflow-model";
import { SectionTitle } from "./survey-workflow-shell";
import { useSectionNavigation } from "./use-section-navigation";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

export function AnalysisReportStep({ model, metrics }: { model: SurveyWorkflowModel; metrics: SurveyMetrics }) {
  const sectionIds = React.useMemo(() => model.report.sections.map((section) => section.id), [model.report.sections]);
  const { activeId, navigateTo } = useSectionNavigation(sectionIds, "survey-report-anchor");

  return <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 xl:grid-cols-[18rem_1fr]">
    <aside className="border-b border-border bg-card p-4 xl:sticky xl:top-0 xl:self-start xl:border-b-0 xl:border-r" data-testid="survey-report-toc">
      <SectionTitle title="报告目录" description="快捷定位章节，也可直接向下阅读全文" />
      {model.reportTemplate.sections.map((item) => <button key={item.id} type="button" data-testid={`survey-report-nav-${item.id}`} aria-current={activeId === item.id ? "location" : undefined} onClick={() => navigateTo(item.id)} className={`mb-1 flex w-full items-center gap-2 rounded-md border-l-2 px-3 py-2 text-left text-12 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeId === item.id ? "border-primary bg-accent text-primary" : "border-transparent hover:bg-muted"}`}><FileText className="h-3.5 w-3.5" aria-hidden />{item.title}</button>)}
    </aside>
    <section className="p-5" data-testid="survey-report-content">
      <div className="mb-4 flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm"><RefreshCw className="h-3.5 w-3.5" aria-hidden />重新生成</Button><Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" aria-hidden />导出 PDF</Button><Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" aria-hidden />导出 Word</Button><Button variant="primary" size="sm"><Share2 className="h-3.5 w-3.5" aria-hidden />分享</Button></div>
      <article className="rounded-lg border border-border bg-card p-6 shadow-sm"><h2 className="text-24 font-bold">{model.survey.title} 分析报告</h2><p className="mt-2 text-11 text-muted-foreground">{metrics.received} 份答卷 · {model.reportTemplate.sections.length} 个模板章节 · 生成于 {new Date(model.report.generatedAt).toLocaleString("zh-CN")}</p><div className="my-4 border-t border-border" />
        {metrics.valid === 0 && <div className="mb-2 rounded-md border border-warning/40 bg-warning/5 p-4 text-12 text-warning" role="status">当前没有可纳入分析的有效答卷，以下仅展示报告结构，暂不生成统计结论。</div>}
        <div className="divide-y divide-border">{model.report.sections.map((section, index) => <section key={section.id} id={`survey-report-anchor-${section.id}`} data-section-id={section.id} data-testid={`survey-report-section-${section.id}`} className="scroll-mt-4 py-7 first:pt-2"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-11 font-semibold text-primary">{index + 1}</span><h3 className="text-18 font-semibold">{section.title}</h3></div><p className="mt-3 text-13 leading-7">{section.body}</p>{section.id === "summary" && <SummaryContent metrics={metrics} />}</section>)}</div>
      </article>
    </section>
  </div>;
}

function SummaryContent({ metrics }: { metrics: SurveyMetrics }) {
  const hasData = metrics.valid > 0;
  return <><div className="mt-5 grid gap-3 md:grid-cols-3"><Summary label="有效样本" value={hasData ? String(metrics.valid) : "暂无"} note={hasData ? `共 ${metrics.received} 份答卷，${metrics.validRate}% 纳入分析` : "至少需要 1 份有效答卷"} /><Summary label="综合成熟度" value="待计算" note="需要按问卷量表和题目权重计算" /><Summary label="平均用时" value={hasData ? `${Math.floor(metrics.averageDurationSeconds / 60)}分${metrics.averageDurationSeconds % 60}秒` : "暂无"} note="仅统计纳入分析的答卷" /></div><h4 className="mt-6 text-14 font-semibold">样本与质量概览</h4><div className="mt-2 overflow-x-auto"><Table className="w-full min-w-[40rem] text-11"><TableHeader><TableRow className="border-b border-border text-muted-foreground"><TableHead className="py-2 text-left">指标</TableHead><TableHead>数值</TableHead><TableHead>口径</TableHead></TableRow></TableHeader><TableBody>{[["收到答卷", metrics.received, "当前发布批次"], ["有效样本", metrics.valid, "质量为有效且未排除"], ["待复核", metrics.needsReview, "需要人工确认"], ["完成率", `${metrics.completionRate}%`, "相对发布目标"]].map(([name, value, note]) => <TableRow key={String(name)} className="border-b border-border-subtle"><TableCell className="py-2">{name}</TableCell><TableCell className="text-center">{value}</TableCell><TableCell className="text-muted-foreground">{note}</TableCell></TableRow>)}</TableBody></Table></div><div className="mt-6 grid gap-3 lg:grid-cols-3"><Callout icon={<FileText aria-hidden />} title="事实" lines={[hasData ? `基于 ${metrics.valid} 份有效答卷` : "当前没有有效答卷", "统计口径与答卷质量状态同步"]} /><Callout icon={<Lightbulb aria-hidden />} title="推断" lines={[hasData ? "报告结论应结合题目分布与样本量解读" : "样本不足时不输出推断", "小样本结论需要人工复核"]} /><Callout icon={<CheckCircle2 aria-hidden />} title="建议" lines={[hasData ? "先复核异常答卷，再使用报告结论" : "先完成发布并收集有效答卷", "导出时保留问卷版本与数据截止时间"]} /></div></>;
}

function Summary({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-lg border border-border p-4"><p className="text-11 text-muted-foreground">{label}</p><p className="mt-2 text-20 font-semibold">{value}</p><p className="mt-1 text-10 text-muted-foreground">{note}</p></div>; }
function Callout({ icon, title, lines }: { icon: React.ReactNode; title: string; lines: string[] }) { return <div className="rounded-lg border border-border p-4"><div className="flex items-center gap-2 text-primary">{icon}<p className="font-semibold">{title}</p></div><ul className="mt-2 space-y-1 text-11 text-muted-foreground">{lines.map((line) => <li key={line}>• {line}</li>)}</ul></div>; }
