"use client";

import * as React from "react";
import { CheckCircle2, Download, FileText, Lightbulb, RefreshCw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SurveyMetrics, SurveyWorkflowModel } from "@/lib/survey/workflow-model";
import { SectionTitle } from "./survey-workflow-shell";
import { useSectionNavigation } from "./use-section-navigation";

const GAPS = [
  { name: "组织与协同文化", score: 3.6, pct: 58, gap: -0.9 },
  { name: "协作流程与规范", score: 3.2, pct: 52, gap: -1.0 },
  { name: "数字化工具与平台", score: 3.1, pct: 48, gap: -1.1 },
  { name: "系统集成", score: 2.0, pct: 22, gap: -2.1 },
  { name: "数据与信息治理", score: 2.6, pct: 34, gap: -1.5 },
  { name: "知识治理", score: 2.4, pct: 28, gap: -1.7 },
  { name: "安全与合规", score: 3.3, pct: 54, gap: -0.9 },
  { name: "度量与持续改进", score: 3.0, pct: 46, gap: -1.2 },
];

export function AnalysisReportStep({ model, metrics }: { model: SurveyWorkflowModel; metrics: SurveyMetrics }) {
  const sectionIds = React.useMemo(() => model.report.sections.map((section) => section.id), [model.report.sections]);
  const { activeId, navigateTo } = useSectionNavigation(sectionIds, "survey-report-anchor");

  return <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 xl:grid-cols-[18rem_1fr]">
    <aside className="border-b border-border bg-card p-4 xl:sticky xl:top-0 xl:self-start xl:border-b-0 xl:border-r" data-testid="survey-report-toc">
      <SectionTitle title="报告目录" description="快捷定位章节，也可直接向下阅读全文" />
      {model.reportTemplate.sections.map((item) => <button key={item.id} type="button" data-testid={`survey-report-nav-${item.id}`} aria-current={activeId === item.id ? "location" : undefined} onClick={() => navigateTo(item.id)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-12 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeId === item.id ? "bg-accent text-primary" : "hover:bg-muted"}`}><FileText className="h-3.5 w-3.5" />{item.title}</button>)}
    </aside>
    <section className="p-5" data-testid="survey-report-content">
      <div className="mb-4 flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm"><RefreshCw className="h-3.5 w-3.5" />重新生成</Button><Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" />导出 PDF</Button><Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" />导出 Word</Button><Button variant="primary" size="sm"><Share2 className="h-3.5 w-3.5" />分享</Button></div>
      <article className="rounded-lg border border-border bg-card p-6 shadow-sm"><h2 className="text-24 font-bold">{model.survey.title} 分析报告</h2><p className="mt-2 text-11 text-muted-foreground">{metrics.received} 份模拟答卷 · {model.reportTemplate.sections.length} 个模板章节 · 生成于 2026/08/12</p><div className="my-4 border-t border-border" />
        <div className="divide-y divide-border">{model.report.sections.map((section, index) => <section key={section.id} id={`survey-report-anchor-${section.id}`} data-section-id={section.id} data-testid={`survey-report-section-${section.id}`} className="scroll-mt-4 py-7 first:pt-2"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-11 font-semibold text-primary">{index + 1}</span><h3 className="text-18 font-semibold">{section.title}</h3></div><p className="mt-3 text-13 leading-7">{section.body}</p>{section.id === "summary" && <SummaryContent metrics={metrics} />}</section>)}</div>
      </article>
    </section>
  </div>;
}

function SummaryContent({ metrics }: { metrics: SurveyMetrics }) {
  return <><div className="mt-5 grid gap-3 md:grid-cols-3"><Summary label="综合成熟度" value="3.0 / 5" note="处于中等水平" /><Summary label="主要短板" value="系统集成" note="得分 2.0 / 5" /><Summary label="优先投入" value="知识治理" note="影响度高" /></div><h4 className="mt-6 text-14 font-semibold">能力缺口概览</h4><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[40rem] text-11"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 text-left">能力域</th><th>平均得分</th><th>百分位</th><th>相对强弱</th><th>与领先实践差距</th></tr></thead><tbody>{GAPS.map((item) => <tr key={item.name} className="border-b border-border-subtle"><td className="py-2">{item.name}</td><td className="text-center">{item.score}</td><td className="text-center">{item.pct}</td><td className="px-4"><div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${item.pct}%` }} /></div></td><td className="text-center">{item.gap}</td></tr>)}</tbody></table></div><div className="mt-6 grid gap-3 lg:grid-cols-3"><Callout icon={<FileText />} title="事实" lines={[`基于 ${metrics.received} 份模拟答卷的量化结果`, "反映当前状态与对标位置"]} /><Callout icon={<Lightbulb />} title="推断" lines={["结合数据与行业经验的专业判断", "识别潜在原因与影响路径"]} /><Callout icon={<CheckCircle2 />} title="建议" lines={["针对性改进方向与优先级", "供管理层决策与资源配置参考"]} /></div></>;
}

function Summary({ label, value, note }: { label: string; value: string; note: string }) { return <div className="rounded-lg border border-border p-4"><p className="text-11 text-muted-foreground">{label}</p><p className="mt-2 text-20 font-semibold">{value}</p><p className="mt-1 text-10 text-muted-foreground">{note}</p></div>; }
function Callout({ icon, title, lines }: { icon: React.ReactNode; title: string; lines: string[] }) { return <div className="rounded-lg border border-border p-4"><div className="flex items-center gap-2 text-primary">{icon}<p className="font-semibold">{title}</p></div><ul className="mt-2 space-y-1 text-11 text-muted-foreground">{lines.map((line) => <li key={line}>• {line}</li>)}</ul></div>; }
