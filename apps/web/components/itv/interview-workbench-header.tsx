"use client";

import { ArrowLeft, Check, MessageSquareText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export const INTERVIEW_WORKBENCH_STEPS = [
  { id: "intake", label: "导入需求", detail: "保存研究 Markdown" },
  { id: "analysis", label: "确认分析", detail: "审阅 AI 分析" },
  { id: "experts", label: "选择专家", detail: "确认专家画像" },
  { id: "outline", label: "访谈问题", detail: "确认各专家提纲" },
  { id: "runs", label: "开始访谈", detail: "运行模拟访谈" },
  { id: "report", label: "生成报告", detail: "审阅研究报告" },
] as const;

export type InterviewWorkbenchHeaderStep = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
};

export function InterviewWorkbenchHeader({
  name,
  tags,
  steps,
  activeStep,
  status,
  version,
  topic,
  onStepChange,
  onReturnToList,
  onOpenSkill,
  completedSteps = [],
}: {
  readonly name: string;
  readonly tags: readonly string[];
  readonly steps: readonly InterviewWorkbenchHeaderStep[];
  readonly activeStep: string;
  readonly status: string;
  readonly version: number;
  readonly topic: string | null;
  readonly onStepChange: (step: string) => void;
  readonly onReturnToList: () => void;
  readonly onOpenSkill?: () => void;
  readonly completedSteps?: readonly string[];
}) {
  return <header data-testid="itv-workbench-header" className="sticky top-0 z-20 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur lg:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Sparkles className="size-4" aria-hidden />AI 模拟访谈工作台</p>
        <h1 className="mt-1 truncate text-xl font-semibold tracking-tight lg:text-2xl">{name}</h1>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span data-testid="itv-workflow-status" className="hidden rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">状态：{status}</span>
        <span data-testid="itv-workflow-version" className="hidden text-xs text-muted-foreground md:inline">版本 {version}</span>
        {topic && <span data-testid="itv-persisted-topic" className="sr-only">已确认主题：{topic}</span>}
        {tags.map((tag) => <span key={tag} className="hidden rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground lg:inline-flex">{tag}</span>)}
        {onOpenSkill && <Button data-testid="itv-skill-drawer-trigger" type="button" variant="outline" onClick={onOpenSkill}><MessageSquareText className="size-4" aria-hidden />访谈助手</Button>}
        <Button data-testid="itv-return-history" type="button" variant="outline" onClick={onReturnToList}><ArrowLeft className="size-4" aria-hidden />返回访谈列表</Button>
      </div>
    </div>
    <nav aria-label="访谈步骤" data-testid="itv-workbench-navigation" className="mt-3 overflow-x-auto border-t border-border pt-2">
      <ol data-testid="itv-workbench-timeline" className="flex min-w-max items-start lg:min-w-0">{steps.map((step, index) => <li key={step.id} className="relative min-w-32 flex-1 lg:min-w-0">
        {index < steps.length - 1 && <span aria-hidden className="absolute left-1/2 right-[-50%] top-5 h-px bg-border" />}
        <button data-testid={`itv-workbench-step-${step.id}`} type="button" aria-current={activeStep === step.id ? "step" : undefined} onClick={() => onStepChange(step.id)} className="relative flex w-full flex-col items-center gap-1.5 rounded-lg px-2 py-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={`grid size-9 place-items-center rounded-full border text-base font-semibold ${activeStep === step.id ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/20" : "border-border bg-card text-muted-foreground"}`}>{completedSteps.includes(step.id) && activeStep !== step.id ? <><Check aria-hidden className="size-4" /><span className="sr-only">已完成</span></> : index + 1}</span>
          <span className={activeStep === step.id ? "text-sm font-semibold text-foreground" : "text-sm text-muted-foreground"}>{step.label}</span>
          <span className="sr-only">{step.detail}</span>
        </button>
      </li>)}</ol>
    </nav>
  </header>;
}
