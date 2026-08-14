"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ChevronDown, ChevronRight,
  ClipboardList, FilePlus2, FileText, Plus, Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  SURVEY_LIBRARY_CARDS, SURVEY_QUESTION_MODULE_CARDS, SURVEY_STATUS_LABEL, SURVEY_TEMPLATE_CARDS,
  TEMPLATE_CATEGORY_LABEL, type SurveyResourceState, type SurveyResourceTab,
} from "@/lib/survey/resource-library";

const TAB_COPY: Record<SurveyResourceTab, { title: string; description: string; search: string }> = {
  surveys: { title: "问卷列表", description: "管理问卷、查看回收进度并继续设计", search: "搜索问卷名称" },
  modules: { title: "问卷模块", description: "管理可复用的问题设计模块，快速组合问卷", search: "搜索问卷模块名称" },
  reports: { title: "报告模块", description: "管理报告结构、章节和输出方式", search: "搜索报告模块名称" },
};

export type SurveyResourceIntent = "create-survey" | null;

export function SurveyResourceLibrary({ initialTab, initialIntent, uiState }: {
  initialTab: SurveyResourceTab;
  initialIntent: SurveyResourceIntent;
  uiState: SurveyResourceState;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const tab = initialTab;

  React.useEffect(() => {
    setQuery("");
  }, [tab]);

  const surveys = (uiState === "empty" ? [] : SURVEY_LIBRARY_CARDS).filter((item) =>
    item.title.includes(query.trim()));
  const modules = (uiState === "empty" ? [] : SURVEY_QUESTION_MODULE_CARDS).filter((item) =>
    item.title.includes(query.trim()));
  const reports = (uiState === "empty" ? [] : SURVEY_TEMPLATE_CARDS).filter((item) =>
    item.title.includes(query.trim()));
  const copy = TAB_COPY[tab];
  const selectingSurveySource = tab === "modules" && initialIntent === "create-survey";
  const title = selectingSurveySource ? "选择问卷模块" : copy.title;
  const description = selectingSurveySource
    ? "选择一个问题模块作为新问卷的起点，之后可继续编辑和调整。"
    : copy.description;
  const openModule = (moduleId: string) => router.push(
    selectingSurveySource
      ? `/studio/survey/new?step=design&sourceModule=${moduleId}`
      : `/studio/survey/module-${moduleId}?step=design&mode=module`,
  );

  return (
    <main className="min-h-full bg-background text-background-foreground" data-testid="survey-resource-library">
        <section className="min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
              <div>
                <h2 className="text-24 font-semibold">{title}</h2>
                <p className="mt-1 text-12 text-muted-foreground">{description}</p>
              </div>
              <div className="flex gap-2">
                {tab === "surveys" && <Button variant="outline" size="lg" onClick={() => router.push("/studio/survey?tab=modules&intent=create-survey")}><FilePlus2 className="h-4 w-4" />从问卷模块新建</Button>}
                {tab === "surveys" && <Button variant="primary" size="lg" onClick={() => router.push("/studio/survey/new?step=design")} data-testid="survey-resource-new-survey"><Plus className="h-4 w-4" />新建问卷</Button>}
                {selectingSurveySource && <Button variant="outline" size="lg" onClick={() => router.push("/studio/survey")}>返回问卷列表</Button>}
                {tab === "modules" && !selectingSurveySource && <Button variant="primary" size="lg" onClick={() => router.push("/studio/survey/new?step=design&mode=module")} data-testid="survey-resource-new-module"><Plus className="h-4 w-4" />新建问卷模块</Button>}
                {tab === "reports" && <Button variant="primary" size="lg" onClick={() => router.push("/studio/survey/templates/new")}><Plus className="h-4 w-4" />新建报告模块</Button>}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-10 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} aria-label={copy.search} data-testid="survey-resource-search" />
              </div>
              <Button variant="outline" size="lg">最近更新<ChevronDown className="h-4 w-4" /></Button>
            </div>

            <p className="mt-5 text-11 text-muted-foreground">点击卡片进入{tab === "surveys" ? "问卷设计" : tab === "modules" ? "基于该模块的新问卷设计" : "报告模块编辑"}</p>
            <ResourceBody uiState={uiState} tab={tab}>
              {tab === "surveys" ? (
                <CardGrid empty={surveys.length === 0} emptyLabel="没有匹配的问卷，调整搜索或筛选条件。">
                  {surveys.map((item) => <SurveyCard key={item.id} item={item} onOpen={() => router.push(`/studio/survey/${item.id}?step=design`)} />)}
                </CardGrid>
              ) : tab === "modules" ? (
                <CardGrid empty={modules.length === 0} emptyLabel="没有匹配的问卷模块。">
                  {modules.map((item) => <QuestionModuleCard key={item.id} item={item} onOpen={() => openModule(item.id)} />)}
                </CardGrid>
              ) : (
                <CardGrid empty={reports.length === 0} emptyLabel="没有匹配的报告模块。">
                  {reports.map((item) => <ReportTemplateCard key={item.id} item={item} onOpen={() => router.push(`/studio/survey/templates/${item.id}`)} />)}
                </CardGrid>
              )}
            </ResourceBody>
          </div>
        </section>
    </main>
  );
}

function ResourceBody({ uiState, tab, children }: { uiState: SurveyResourceState; tab: SurveyResourceTab; children: React.ReactNode }) {
  if (uiState === "loading") return <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="survey-resource-loading">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-lg bg-muted" />)}</div>;
  if (uiState === "error") return <Card className="mt-4 flex min-h-56 flex-col items-center justify-center border-destructive/40 p-8 text-center" data-testid="survey-resource-error"><AlertCircle className="h-8 w-8 text-destructive" /><h3 className="mt-3 text-14 font-semibold">资源暂时无法加载</h3><p className="mt-2 text-11 text-muted-foreground">数据没有被修改，请稍后重试。</p></Card>;
  if (uiState === "empty") return <Card className="mt-4 flex min-h-56 flex-col items-center justify-center border-dashed p-8 text-center" data-testid="survey-resource-empty"><FileText className="h-8 w-8 text-primary" /><h3 className="mt-3 text-14 font-semibold">还没有{TAB_COPY[tab].title}</h3><p className="mt-2 text-11 text-muted-foreground">当前模块暂无可用内容。</p></Card>;
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

function QuestionModuleCard({ item, onOpen }: { item: (typeof SURVEY_QUESTION_MODULE_CARDS)[number]; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} data-testid={`survey-resource-card-module-${item.id}`} className="group min-h-48 rounded-lg border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-start justify-between"><span className="rounded-md bg-accent p-2 text-primary"><ClipboardList className="h-5 w-5" /></span><Badge tone="primary">问题模块</Badge></div>
    <h3 className="mt-4 text-14 font-semibold">{item.title}</h3>
    <p className="mt-2 text-11 text-muted-foreground">{item.description}</p>
    <p className="mt-3 text-12 text-muted-foreground">{item.questionCount} 题 · 更新于 {item.updatedAt}</p>
    <p className="mt-3 text-12 text-primary">用于新问卷</p>
    <ChevronRight className="ml-auto mt-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
  </button>;
}

function ReportTemplateCard({ item, onOpen }: { item: (typeof SURVEY_TEMPLATE_CARDS)[number]; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} data-testid={`survey-resource-card-report-template-${item.id}`} className="group min-h-56 rounded-lg border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-start justify-between"><span className="rounded-md bg-accent p-2 text-primary"><ClipboardList className="h-5 w-5" /></span><Badge tone="primary">{TEMPLATE_CATEGORY_LABEL[item.category]}</Badge></div>
    <h3 className="mt-4 text-14 font-semibold">{item.title}</h3>
    <p className="mt-2 text-11 text-muted-foreground">{item.questionCount} 题 · {item.reportSectionCount} 个报告章节</p>
    <p className="mt-2 text-11 text-muted-foreground">最近更新　{item.updatedAt}</p>
    <p className="mt-3 text-12 text-muted-foreground">已应用于 <strong className="font-semibold text-primary">{item.surveyCount}</strong> 份问卷</p>
    <p className="mt-3 text-12 text-primary">编辑报告模块</p>
    <ChevronRight className="ml-auto mt-3 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
  </button>;
}
