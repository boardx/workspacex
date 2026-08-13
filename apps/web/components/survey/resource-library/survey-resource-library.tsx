"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, Bell, CheckCircle2, ChevronDown, ChevronRight, CircleHelp,
  ClipboardList, FilePlus2, FileText, Grid2X2, LoaderCircle, Plus, Search,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  SURVEY_LIBRARY_CARDS, SURVEY_STATUS_LABEL, SURVEY_TEMPLATE_CARDS,
  TEMPLATE_CATEGORY_LABEL, type SurveyCardStatus, type SurveyResourceState,
  type SurveyResourceTab, type TemplateCategory,
} from "@/lib/survey/resource-library";

type SurveyFilter = "all" | SurveyCardStatus;
type TemplateFilter = "all" | TemplateCategory;

export function SurveyResourceLibrary({ initialTab, uiState }: {
  initialTab: SurveyResourceTab;
  uiState: SurveyResourceState;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState(initialTab);
  const [query, setQuery] = React.useState("");
  const [surveyFilter, setSurveyFilter] = React.useState<SurveyFilter>("all");
  const [templateFilter, setTemplateFilter] = React.useState<TemplateFilter>("all");

  const changeTab = (next: SurveyResourceTab) => {
    setTab(next);
    setQuery("");
    router.push(next === "templates" ? "/studio/survey?tab=templates" : "/studio/survey");
  };

  const surveys = (uiState === "empty" ? [] : SURVEY_LIBRARY_CARDS).filter((item) =>
    item.title.includes(query.trim()) && (surveyFilter === "all" || item.status === surveyFilter));
  const templates = (uiState === "empty" ? [] : SURVEY_TEMPLATE_CARDS).filter((item) =>
    item.title.includes(query.trim()) && (templateFilter === "all" || item.category === templateFilter));

  return (
    <main className="min-h-screen bg-background text-background-foreground" data-testid="survey-resource-library">
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-4 lg:px-8">
        <div className="flex items-center gap-4">
          <p className="text-18 font-bold tracking-tight">BoardX <span className="text-primary">Survey</span></p>
          <span className="h-7 w-px bg-border" />
          <h1 className="text-18 font-semibold">问卷与模板</h1>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Button variant="ghost" size="icon" aria-label="帮助"><CircleHelp className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="通知"><Bell className="h-4 w-4" /></Button>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-11 font-semibold text-primary-foreground">陈</span>
          <span className="hidden text-12 font-medium text-foreground sm:inline">陈顾问</span>
          <ChevronDown className="hidden h-3.5 w-3.5 sm:block" />
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-65px)] lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="border-b border-border bg-card p-4 lg:border-b-0 lg:border-r lg:p-6">
          <h2 className="mb-4 text-14 font-semibold">资源库</h2>
          <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" aria-label="Survey 资源类型">
            <ResourceNavItem active={tab === "surveys"} count={SURVEY_LIBRARY_CARDS.length} icon={<FileText className="h-5 w-5" />} label="问卷列表" onClick={() => changeTab("surveys")} testId="survey-resource-nav-surveys" />
            <ResourceNavItem active={tab === "templates"} count={SURVEY_TEMPLATE_CARDS.length} icon={<ClipboardList className="h-5 w-5" />} label="模板列表" onClick={() => changeTab("templates")} testId="survey-resource-nav-templates" />
          </nav>
          <div className="mt-6 hidden border-t border-border pt-5 lg:block">
            <h3 className="mb-3 text-12 font-semibold">{tab === "surveys" ? "快速筛选" : "模板分类"}</h3>
            {tab === "surveys" ? <SurveyFilters value={surveyFilter} onChange={setSurveyFilter} /> : <TemplateFilters value={templateFilter} onChange={setTemplateFilter} />}
          </div>
        </aside>

        <section className="min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
              <div>
                <h2 className="text-24 font-semibold">{tab === "surveys" ? "问卷列表" : "模板列表"}</h2>
                <p className="mt-1 text-12 text-muted-foreground">{tab === "surveys" ? "管理问卷、查看回收进度并继续设计" : "管理可复用模板，快速创建标准化问卷"}</p>
              </div>
              <div className="flex gap-2">
                {tab === "surveys" && <Button variant="outline" size="lg"><FilePlus2 className="h-4 w-4" />从模板新建</Button>}
                <Button variant="primary" size="lg"><Plus className="h-4 w-4" />{tab === "surveys" ? "新建问卷" : "新建模板"}</Button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-10 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "surveys" ? "搜索问卷名称" : "搜索模板名称"} aria-label={tab === "surveys" ? "搜索问卷名称" : "搜索模板名称"} data-testid="survey-resource-search" />
              </div>
              <Button variant="outline" size="lg">{tab === "surveys" ? "全部状态" : "全部分类"}<ChevronDown className="h-4 w-4" /></Button>
              <Button variant="outline" size="lg">最近更新<ChevronDown className="h-4 w-4" /></Button>
            </div>

            <p className="mt-5 text-11 text-muted-foreground">点击{tab === "surveys" ? "问卷" : "模板"}卡片进入{tab === "surveys" ? "问卷设计" : "模板编辑"}</p>
            <ResourceBody uiState={uiState} tab={tab}>
              {tab === "surveys" ? (
                <CardGrid empty={surveys.length === 0} emptyLabel="没有匹配的问卷，调整搜索或筛选条件。">
                  {surveys.map((item) => <SurveyCard key={item.id} item={item} onOpen={() => router.push(`/studio/survey/${item.id}?step=design`)} />)}
                </CardGrid>
              ) : (
                <CardGrid empty={templates.length === 0} emptyLabel="没有匹配的模板，调整搜索或分类条件。">
                  {templates.map((item) => <TemplateCard key={item.id} item={item} onOpen={() => router.push(`/studio/survey/templates/${item.id}`)} />)}
                  <button type="button" className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-6 text-center transition-all duration-200 hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="survey-resource-new-template">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full border border-primary text-primary"><Plus className="h-6 w-6" /></span>
                    <span className="mt-4 text-14 font-semibold">新建空白模板</span>
                    <span className="mt-2 text-11 text-muted-foreground">从零开始配置问题与报告章节</span>
                  </button>
                </CardGrid>
              )}
            </ResourceBody>
          </div>
        </section>
      </div>
    </main>
  );
}

function ResourceNavItem({ active, count, icon, label, onClick, testId }: { active: boolean; count: number; icon: React.ReactNode; label: string; onClick: () => void; testId: string }) {
  return <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} data-testid={testId} className={cn("flex items-center gap-3 rounded-lg border px-4 py-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-primary bg-accent text-primary" : "border-border bg-card hover:bg-muted")}><span>{icon}</span><span className="flex-1 text-13 font-medium">{label}</span><span className="text-12">{count}</span></button>;
}

function SurveyFilters({ value, onChange }: { value: SurveyFilter; onChange: (value: SurveyFilter) => void }) {
  const filters: { id: SurveyFilter; label: string; count: number; icon: React.ReactNode }[] = [
    { id: "all", label: "全部问卷", count: SURVEY_LIBRARY_CARDS.length, icon: <Grid2X2 className="h-4 w-4" /> },
    { id: "draft", label: "草稿", count: 2, icon: <FileText className="h-4 w-4" /> },
    { id: "collecting", label: "回收中", count: 2, icon: <LoaderCircle className="h-4 w-4" /> },
    { id: "closed", label: "已完成", count: 2, icon: <CheckCircle2 className="h-4 w-4" /> },
  ];
  return <div className="space-y-1">{filters.map((item) => <FilterButton key={item.id} active={value === item.id} {...item} onClick={() => onChange(item.id)} />)}</div>;
}

function TemplateFilters({ value, onChange }: { value: TemplateFilter; onChange: (value: TemplateFilter) => void }) {
  const filters: { id: TemplateFilter; label: string; count: number; icon: React.ReactNode }[] = [
    { id: "all", label: "全部模板", count: 4, icon: <Grid2X2 className="h-4 w-4" /> },
    { id: "organization", label: "组织诊断", count: 2, icon: <ClipboardList className="h-4 w-4" /> },
    { id: "collaboration", label: "团队协作", count: 1, icon: <UsersRound className="h-4 w-4" /> },
    { id: "feedback", label: "客户反馈", count: 1, icon: <CheckCircle2 className="h-4 w-4" /> },
  ];
  return <div className="space-y-1">{filters.map((item) => <FilterButton key={item.id} active={value === item.id} {...item} onClick={() => onChange(item.id)} />)}</div>;
}

function FilterButton({ active, count, icon, label, onClick }: { active: boolean; count: number; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-11 transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "text-primary" : "text-muted-foreground")}><span>{icon}</span><span className="flex-1 text-left">{label}</span><span>{count}</span></button>;
}

function ResourceBody({ uiState, tab, children }: { uiState: SurveyResourceState; tab: SurveyResourceTab; children: React.ReactNode }) {
  if (uiState === "loading") return <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="survey-resource-loading">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-lg bg-muted" />)}</div>;
  if (uiState === "error") return <Card className="mt-4 flex min-h-56 flex-col items-center justify-center border-destructive/40 p-8 text-center" data-testid="survey-resource-error"><AlertCircle className="h-8 w-8 text-destructive" /><h3 className="mt-3 text-14 font-semibold">资源暂时无法加载</h3><p className="mt-2 text-11 text-muted-foreground">数据没有被修改，请稍后重试。</p></Card>;
  if (uiState === "empty") return <Card className="mt-4 flex min-h-56 flex-col items-center justify-center border-dashed p-8 text-center" data-testid="survey-resource-empty"><FileText className="h-8 w-8 text-primary" /><h3 className="mt-3 text-14 font-semibold">还没有{tab === "surveys" ? "问卷" : "模板"}</h3><p className="mt-2 text-11 text-muted-foreground">从右上角创建第一个{tab === "surveys" ? "问卷" : "模板"}。</p></Card>;
  return <>{children}</>;
}

function CardGrid({ empty, emptyLabel, children }: { empty: boolean; emptyLabel: string; children: React.ReactNode }) {
  if (empty) return <Card className="mt-4 flex min-h-48 items-center justify-center border-dashed p-8 text-12 text-muted-foreground" data-testid="survey-resource-filter-empty">{emptyLabel}</Card>;
  return <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function SurveyCard({ item, onOpen }: { item: (typeof SURVEY_LIBRARY_CARDS)[number]; onOpen: () => void }) {
  const tone = item.status === "collecting" ? "primary" : item.status === "closed" ? "primary" : "neutral";
  return <button type="button" onClick={onOpen} data-testid={`survey-resource-card-survey-${item.id}`} className="group min-h-56 rounded-lg border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-start justify-between"><span className="rounded-md bg-accent p-2 text-primary"><FileText className="h-5 w-5" /></span><Badge tone={tone}>{SURVEY_STATUS_LABEL[item.status]}</Badge></div>
    <h3 className="mt-4 text-14 font-semibold">{item.title}</h3>
    <p className="mt-2 text-11 text-muted-foreground">{item.questionCount} 题 · {item.reportSectionCount} 个报告章节</p>
    <p className="mt-2 text-11 text-muted-foreground">最近更新　{item.updatedAt}</p>
    {item.received !== undefined && <p className="mt-3 text-12 text-muted-foreground">已回收 <strong className="font-semibold text-primary">{item.received}</strong>{item.target ? ` / ${item.target}` : " 份"}</p>}
    {item.target && item.received !== undefined && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, item.received / item.target * 100)}%` }} /></div>}
    <ChevronRight className="ml-auto mt-3 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
  </button>;
}

function TemplateCard({ item, onOpen }: { item: (typeof SURVEY_TEMPLATE_CARDS)[number]; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} data-testid={`survey-resource-card-template-${item.id}`} className="group min-h-56 rounded-lg border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-start justify-between"><span className="rounded-md bg-accent p-2 text-primary"><ClipboardList className="h-5 w-5" /></span><Badge tone="primary">{TEMPLATE_CATEGORY_LABEL[item.category]}</Badge></div>
    <h3 className="mt-4 text-14 font-semibold">{item.title}</h3>
    <p className="mt-2 text-11 text-muted-foreground">{item.questionCount} 题 · {item.reportSectionCount} 个报告章节</p>
    <p className="mt-2 text-11 text-muted-foreground">最近更新　{item.updatedAt}</p>
    <p className="mt-3 text-12 text-muted-foreground">已创建 <strong className="font-semibold text-primary">{item.surveyCount}</strong> 份问卷</p>
    <ChevronRight className="ml-auto mt-3 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
  </button>;
}
