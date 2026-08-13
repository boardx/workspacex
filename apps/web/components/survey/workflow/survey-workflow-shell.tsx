"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, Eye, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createSurveyWorkflowMock, getSurveyMetrics } from "@/lib/survey/workflow-model";
import type { survey } from "@repo/contracts";
import { SurveyDesignStep } from "./survey-design-step";
import { ReportTemplateStep } from "./report-template-step";
import { PublishRecoveryStep } from "./publish-recovery-step";
import { ResponseReviewStep } from "./response-review-step";
import { AnalysisReportStep } from "./analysis-report-step";

export type SurveyPrototypeState = "default" | "loading" | "empty" | "error";

const STEPS: { id: survey.SurveyWorkflowStep; label: string; note: string }[] = [
  { id: "design", label: "设计问卷", note: "构建内容与结构" },
  { id: "template", label: "报告模板", note: "配置报告结构与展示" },
  { id: "publish", label: "发布回收", note: "发布设置与回收管理" },
  { id: "responses", label: "查看答题", note: "监控进度与质量" },
  { id: "report", label: "分析报告", note: "生成洞察与改进建议" },
];

export function SurveyWorkflowShell({ surveyId, initialStep, uiState, readonly, moduleId }: {
  surveyId: string;
  initialStep: survey.SurveyWorkflowStep;
  uiState: SurveyPrototypeState;
  readonly: boolean;
  moduleId?: string;
}) {
  const router = useRouter();
  const [model, setModel] = React.useState<survey.SurveyWorkflowModel>(() => createSurveyWorkflowMock({ surveyId, moduleId }));
  const [saved, setSaved] = React.useState(false);
  const metrics = getSurveyMetrics(model);

  const navigate = (step: survey.SurveyWorkflowStep) => {
    router.replace(`/studio/survey/${surveyId}?step=${step}`);
  };

  if (uiState === "loading") return <WorkflowMessage testId="survey-workflow-loading" title="正在加载问卷" body="正在准备问题、答卷与报告数据…" pulse />;
  if (uiState === "empty") return <WorkflowMessage testId="survey-workflow-empty" title="还没有问卷内容" body="返回列表创建第一份问卷，或从模板开始。" />;
  if (uiState === "error") return <WorkflowMessage testId="survey-workflow-error" title="问卷暂时无法加载" body="数据没有被修改，请稍后重试。" danger />;

  return (
    <main className="min-h-screen bg-background text-background-foreground" data-testid="survey-workflow-shell">
      <header className="border-b border-border bg-card px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-18 font-bold tracking-tight">BoardX <span className="text-primary">Survey</span></span>
            <span className="hidden h-6 w-px bg-border sm:block" />
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h1 className="truncate text-16 font-semibold">{model.survey.title}</h1><Badge tone="ai">草稿已保存</Badge></div>
              <p className="text-10 text-muted-foreground">问卷 ID {model.survey.id} · 最近保存 18:00</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm"><Eye className="h-3.5 w-3.5" />预览答题</Button>
            {!readonly && <Button variant="primary" size="sm" data-testid="survey-workflow-save" onClick={() => setSaved(true)}><Save className="h-3.5 w-3.5" />保存修改</Button>}
            <Button variant="outline" size="sm" data-testid="survey-workflow-back-to-list" onClick={() => router.push("/studio/survey")}><ArrowLeft className="h-3.5 w-3.5" />返回列表</Button>
          </div>
        </div>
        {saved && <p className="mt-2 text-right text-11 text-success" data-testid="survey-workflow-saved"><Check className="mr-1 inline h-3 w-3" />修改已保存</p>}
        {readonly && <p className="mt-2 rounded-md border border-border bg-muted px-3 py-2 text-11 text-muted-foreground" data-testid="survey-workflow-readonly">当前为只读预览，编辑与发布操作已隐藏。</p>}
      </header>

      <nav className="overflow-x-auto border-b border-border bg-card" data-testid="survey-workflow-steps" aria-label="问卷工作流步骤">
        <div className="mx-auto flex min-w-max justify-center px-3">
          {STEPS.map((step, index) => {
            const active = step.id === initialStep;
            return (
              <React.Fragment key={step.id}>
                <button type="button" onClick={() => navigate(step.id)} data-testid={`survey-workflow-step-${step.id}`} className={`group flex min-w-36 items-center gap-2 border-b-2 px-4 py-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary bg-accent text-primary" : "border-transparent hover:bg-muted"}`}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-11 font-semibold ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{index + 1}</span>
                  <span><span className="block text-12 font-semibold">{step.label}</span><span className="block text-10 text-muted-foreground">{step.note}</span></span>
                </button>
                {index < STEPS.length - 1 && <span className="my-auto w-8 border-t border-dashed border-border" />}
              </React.Fragment>
            );
          })}
        </div>
      </nav>

      <section className="min-h-0">
        {initialStep === "design" && <SurveyDesignStep model={model} setModel={setModel} readonly={readonly} />}
        {initialStep === "template" && <ReportTemplateStep model={model} setModel={setModel} readonly={readonly} />}
        {initialStep === "publish" && <PublishRecoveryStep model={model} metrics={metrics} readonly={readonly} />}
        {initialStep === "responses" && <ResponseReviewStep model={model} setModel={setModel} metrics={metrics} readonly={readonly} />}
        {initialStep === "report" && <AnalysisReportStep model={model} metrics={metrics} />}
      </section>
    </main>
  );
}

function WorkflowMessage({ testId, title, body, danger, pulse }: { testId: string; title: string; body: string; danger?: boolean; pulse?: boolean }) {
  return <main className="flex min-h-screen items-center justify-center bg-background p-6" data-testid={testId}><div className={`w-full max-w-lg rounded-lg border p-8 text-center shadow-sm ${danger ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"} ${pulse ? "animate-pulse" : ""}`}><AlertCircle className="mx-auto mb-3 h-8 w-8 text-primary" /><h1 className="text-18 font-semibold">{title}</h1><p className="mt-2 text-12 text-muted-foreground">{body}</p></div></main>;
}

export function SectionTitle({ icon, title, description }: { icon?: React.ReactNode; title: string; description?: string }) {
  return <div className="mb-3"><div className="flex items-center gap-2 text-15 font-semibold">{icon ?? <Sparkles className="h-4 w-4 text-primary" />}{title}</div>{description && <p className="mt-1 text-11 text-muted-foreground">{description}</p>}</div>;
}
