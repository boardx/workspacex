"use client";

import * as React from "react";
import { ArrowLeft, Check, Loader2, MessageSquareText, Sparkles } from "lucide-react";
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
  runningStep,
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
  readonly runningStep?: string | null;
}) {
  const headerRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const header = headerRef.current;
    const container = header?.parentElement;
    if (!header || !container) return;
    const measure = () => container.style.setProperty("--itv-header-height", `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); container.style.removeProperty("--itv-header-height"); };
  }, []);
  return <header ref={headerRef} data-testid="itv-workbench-header" className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:px-8">
    <div className="mx-auto max-w-[1440px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-sm font-semibold tracking-tight text-foreground">AI 模拟访谈工作台</span>
          <span aria-hidden="true" data-testid="itv-workflow-status-badge" className="hidden rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground sm:inline-flex">状态：{status}</span>
          <span aria-hidden="true" data-testid="itv-workflow-version-badge" className="hidden rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground sm:inline-flex">版本 {version}</span>
        </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span data-testid="itv-workflow-status" className="sr-only">状态：{status}</span>
        <span data-testid="itv-workflow-version" className="sr-only">版本 {version}</span>
        {topic && <span data-testid="itv-persisted-topic" className="sr-only">已确认主题：{topic}</span>}
        {tags.map((tag) => <span key={tag} className="hidden rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground lg:inline-flex">{tag}</span>)}
        {onOpenSkill && <Button data-testid="itv-skill-drawer-trigger" type="button" variant="outline" onClick={onOpenSkill}><MessageSquareText className="size-4" aria-hidden />访谈助手</Button>}
        <Button data-testid="itv-return-history" type="button" variant="outline" onClick={onReturnToList}><ArrowLeft className="size-4" aria-hidden />返回访谈列表</Button>
      </div>
    </div>
      <h1 className="mt-3 truncate text-2xl font-bold tracking-tight lg:text-3xl">{name}</h1>
    </div>
    <nav aria-label="访谈步骤" data-testid="itv-workbench-navigation" className="mx-auto mt-3 max-w-[1440px] overflow-x-auto pb-1">
      <ol data-testid="itv-workbench-timeline" className="flex min-w-max items-center lg:min-w-0">{steps.map((step, index) => { const state = activeStep === step.id ? "current" : completedSteps.includes(step.id) ? "completed" : "upcoming"; return <li key={step.id} className="relative flex min-w-32 flex-1 items-center lg:min-w-0">
        <button data-testid={`itv-workbench-step-${step.id}`} data-state={runningStep === step.id ? "running" : state} aria-busy={runningStep === step.id} type="button" aria-current={state === "current" ? "step" : undefined} onClick={() => onStepChange(step.id)} className={`relative flex w-full flex-col items-center gap-1 rounded-lg px-2 py-1 text-center transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${state === "current" || runningStep === step.id ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}>
          <span className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold ${runningStep === step.id || state === "current" ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2" : state === "completed" ? "border-success bg-success text-success-foreground" : "border-border bg-muted text-muted-foreground"}`}>{runningStep === step.id ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : state === "completed" ? <><Check aria-hidden className="size-4" /><span className="sr-only">已完成</span></> : index + 1}</span>
          <span className={state === "current" || runningStep === step.id ? "text-sm font-semibold text-primary" : state === "completed" ? "text-sm font-medium text-success" : "text-sm text-muted-foreground"}>{step.label}</span>
          {runningStep === step.id && <span role="status" className="flex items-center gap-1 text-xs font-medium text-primary"><Loader2 aria-hidden className="size-3 motion-safe:animate-spin" />进行中</span>}
          <span className="sr-only">{step.detail}</span>
        </button>
        {index < steps.length - 1 && <span aria-hidden className={`mx-2 hidden min-w-3 flex-1 border-t lg:block ${state === "completed" ? "border-primary" : "border-border"}`} />}
      </li>; })}</ol>
    </nav>
  </header>;
}
