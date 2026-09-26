"use client";

import { ArrowRight, FileText, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GuidedResearchEntryPanel } from "@/components/research-studio/guided-research-entry-panel";
import { GuidedResearchPlanPanel } from "@/components/research-studio/guided-research-plan-panel";
import { GuidedResearchReportWorkspace } from "@/components/research-studio/guided-research-report-workspace";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";
import { GuidedResearchSourceWorkspace } from "@/components/research-studio/guided-research-source-workspace";
import { GuidedResearchTopicPanel } from "@/components/research-studio/guided-research-topic-panel";
import type { GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

const stages = ["home", "import", "topic", "plan", "research", "report"] as const;
type PreviewStage = (typeof stages)[number];

function validStage(stage?: string): PreviewStage {
  return stages.includes(stage as PreviewStage) ? (stage as PreviewStage) : "home";
}

const sampleMarkdown = <article className="space-y-3 text-sm leading-6"><h2 className="text-base font-semibold">研究需求</h2><p><strong>研究主题：</strong>欧洲储能市场进入策略</p><p><strong>研究目标：</strong>判断未来三年最值得优先进入的国家、细分场景与合作模式，并给出可执行的进入路径图。</p><p><strong>时间与地区：</strong>2023–2027；欧盟 27 国，重点关注德国、英国、意大利和西班牙。</p></article>;

function Assistant() {
  return <div className="space-y-4"><div className="rounded-lg bg-accent/45 p-3"><p className="text-sm font-semibold">我们一起完成这项研究</p><p className="mt-2 text-12 leading-5 text-muted-foreground">从你的问题开始，逐步梳理主题、研究方向和大纲，再检索资料并生成有来源支持的报告。</p></div><div className="space-y-2"><p className="text-12 font-medium text-muted-foreground">当前：确认研究主题</p><Button variant="outline" size="sm" className="h-auto w-full justify-start whitespace-normal text-left">请根据我的主题完善研究目标、时间范围、区域和重点</Button><Button variant="outline" size="sm" className="h-auto w-full justify-start whitespace-normal text-left">确认当前主题，生成研究方向</Button></div></div>;
}

function HomePreview() {
  return <section className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8" data-testid="guided-research-prototype-home"><header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5"><div><p className="flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="size-4" />Deep Research</p><h1 className="mt-2 text-30 font-semibold tracking-tight">研究列表</h1><p className="mt-2 text-sm text-muted-foreground">统一管理研究项目，快速找到所需的内容与证据。</p></div><Button variant="primary"><Sparkles className="size-4" />新建研究</Button></header><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><Button size="sm" variant="primary">全部</Button><Button size="sm" variant="outline">行业</Button><Button size="sm" variant="outline">市场</Button><Button size="sm" variant="outline">用户研究</Button></div><Button size="sm" variant="outline"><Search className="size-4" />搜索研究项目</Button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><ResearchCard title="中国新能源汽车市场研究" label="市场 · 汽车" /><ResearchCard title="生成式 AI 行业研究" label="AI · 技术" /><ResearchCard title="东南亚出海市场机会分析" label="出海 · 市场" /><ResearchCard title="储能行业政策与市场研究" label="能源 · 政策" /></div></section>;
}

function ResearchCard({ title, label }: { title: string; label: string }) {
  return <Card className="border-primary/15 shadow-sm"><CardHeader className="space-y-3 pb-3"><div className="flex items-start justify-between gap-2"><CardTitle className="text-base">{title}</CardTitle><span className="rounded bg-accent px-2 py-1 text-11 text-accent-foreground">进行中</span></div><p className="text-sm leading-5 text-muted-foreground">分析行业趋势、市场规模、竞争格局及未来发展路径。</p></CardHeader><CardContent className="space-y-4"><span className="rounded bg-muted px-2 py-1 text-11 text-muted-foreground">{label}</span><div className="flex items-center justify-between border-t border-border pt-3"><span className="text-12 text-muted-foreground">更新：2026/09/27</span><Button size="sm" variant="outline">继续研究 <ArrowRight className="size-4" /></Button></div></CardContent></Card>;
}

function StagePreview({ stage }: { stage: Exclude<PreviewStage, "home"> }) {
  const current = stage === "import" ? "import" : stage === "topic" ? "topic" : stage === "plan" ? "plan" : stage === "research" ? "research" : "report";
  const main = stage === "import" ? <GuidedResearchEntryPanel brief={sampleMarkdown} disabled={false} onContinue={() => undefined} onRegenerate={() => undefined} onSave={() => undefined} />
    : stage === "topic" ? <GuidedResearchTopicPanel workspace={<div className="space-y-5"><div><p className="text-12 font-medium text-primary">步骤 3 · 确认研究主题</p><h1 className="mt-1 text-24 font-semibold">确认研究主题</h1><p className="mt-2 text-sm text-muted-foreground">基于输入内容，智能梳理并确认研究主题。</p></div><div className="space-y-4"><label className="block text-sm font-medium">研究主题<input className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3" defaultValue="欧洲储能市场进入策略" /></label><label className="block text-sm font-medium">研究目标<textarea className="mt-2 min-h-24 w-full rounded-md border border-input bg-background p-3" defaultValue="判断未来三年最值得优先进入的国家、细分场景和合作模式。" /></label></div><div className="flex justify-end"><Button variant="primary">下一步：制定研究计划 <ArrowRight className="size-4" /></Button></div></div>} assistant={<Assistant />} />
    : stage === "plan" ? <GuidedResearchPlanPanel disabled={false} onConfirm={() => undefined} plan={<ol className="space-y-3 text-sm"><li><strong>1. 市场规模与增长动能</strong><p className="mt-1 text-muted-foreground">明确市场规模、增长速度与增长质量。</p></li><li><strong>2. 政策与落地约束</strong><p className="mt-1 text-muted-foreground">核对准入、补贴与电网接入机制。</p></li></ol>} questions={<ul className="list-disc space-y-2 pl-5 text-sm"><li>哪些市场最具增长与确定性？</li><li>自建、合资还是渠道合作？</li></ul>} sourceScope={<ul className="list-disc space-y-2 pl-5 text-sm"><li>政策、监管与行业报告</li><li>本地新闻与权威机构数据</li></ul>} />
    : stage === "research" ? <GuidedResearchSourceWorkspace progress={<div className="space-y-3 text-sm"><p><strong>4 / 6</strong> 研究步骤</p><div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full w-2/3 bg-primary" /></div><p className="text-muted-foreground">8 / 12 任务完成</p></div>} activity={<ul className="space-y-3 text-sm"><li>14:32 发现德国市场报告</li><li>14:28 正在验证政策实施细节</li><li>14:25 建立竞争格局假设</li></ul>} evidence={<div className="space-y-3 text-sm"><p><FileText className="mr-2 inline size-4" />已收集 <strong>28</strong> 篇来源</p><p className="text-muted-foreground">覆盖政策、市场与企业案例。</p></div>} insights={<ul className="space-y-3 text-sm"><li>关键发现：德国需求增长</li><li>政策变化：补贴结构调整</li></ul>} risk={<p className="text-sm text-muted-foreground">存在 1 条证据覆盖不足，需要补充验证。</p>} actions={<><Button size="sm" variant="primary">继续检索</Button><Button size="sm" variant="outline">重新收集任务</Button></>} />
    : <GuidedResearchReportWorkspace actions={<><Button size="sm" variant="outline">下载 Word</Button><Button size="sm" variant="outline">导出 PDF</Button><Button size="sm" variant="primary">生成报告</Button></>} contents={<ol className="space-y-3 text-sm text-muted-foreground"><li>执行摘要</li><li>市场规模与增长动能</li><li>政策与落地约束</li><li>竞争格局与进入路径</li><li>参考来源</li></ol>} document={<article className="mx-auto max-w-3xl space-y-7"><h1 className="border-b border-border pb-5 text-24 font-semibold">欧洲储能市场进入策略综合评估</h1><section><h2 className="border-l-2 border-primary pl-3 text-lg font-semibold">执行摘要</h2><p className="mt-4 text-sm leading-7 text-muted-foreground">本报告旨在评估未来三年欧洲储能市场的进入策略，重点考察德国、英国、意大利和西班牙的市场增长、政策环境与竞争模式。结论以来源证据为基础，并明确保留待验证的假设。</p></section><section><h2 className="text-lg font-semibold">研究范围与方法</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">研究聚焦 2023 至 2027 年间的欧洲储能市场，结合宏观趋势、政策约束和竞争格局开展交叉验证。</p></section></article>} metrics={<div className="grid gap-3 text-sm"><p><strong>28</strong><br /><span className="text-muted-foreground">篇来源资料</span></p><p><strong>6</strong><br /><span className="text-muted-foreground">条核心结论</span></p></div>} limitation={<p className="text-muted-foreground">3 个关键结论仍需本地化验证。</p>} />;
  return <div data-testid={`guided-research-prototype-${stage}`}><GuidedResearchSixStepShell current={current} available={["list", "import", "topic", "plan", "research", "report"]} onBack={() => undefined} onNavigate={() => undefined} main={main} assistant={stage === "import" ? <Assistant /> : undefined} /></div>;
}

export function GuidedResearchPrototypePreview({ stage }: { stage?: string }) {
  const resolved = validStage(stage);
  return <div data-testid="guided-research-prototype-preview" className="min-h-screen bg-background">{resolved === "home" ? <HomePreview /> : <StagePreview stage={resolved} />}</div>;
}
