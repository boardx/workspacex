"use client";

import * as React from "react";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { researchWorkspaceStyle as workspace, ResearchWorkspaceStepIndicator } from "@/components/research-studio/research-workspace-style";
import { cn } from "@/lib/utils";
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
  return <header ref={headerRef} data-testid="itv-workbench-header" className={workspace.header}>
    <div className={workspace.brandBar}>
    <div className={workspace.width}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button data-testid="itv-return-history" type="button" variant="primary" className="h-8 text-sm" onClick={onReturnToList}><ArrowLeft className="size-4" aria-hidden />返回访谈列表</Button>
          <MessageSquareText aria-hidden className="size-9 shrink-0 rounded-lg bg-primary p-2 text-primary-foreground" />
          <span className="text-xl font-bold">用户访谈</span>
        </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span data-testid="itv-workflow-status" className="sr-only">状态：{status}</span>
        <span data-testid="itv-workflow-version" className="sr-only">版本 {version}</span>
        {topic && <span data-testid="itv-persisted-topic" className="sr-only">已确认主题：{topic}</span>}
        {tags.map((tag) => <span key={tag} className="hidden rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground lg:inline-flex">{tag}</span>)}
        {onOpenSkill && <Button data-testid="itv-skill-drawer-trigger" type="button" variant="outline" onClick={onOpenSkill}><MessageSquareText className="size-4" aria-hidden />访谈助手</Button>}
      </div>
    </div>
    </div>
    </div>
    <div className={workspace.heading}>
    <h1 className="truncate text-2xl font-bold tracking-tight">{name}</h1>
    <nav aria-label="访谈步骤" data-testid="itv-workbench-navigation" data-reference-variant="monochrome-stepper" className="mt-3 pb-3">
      <ol data-testid="itv-workbench-timeline" className={workspace.timeline}>{steps.map((step, index) => { const state = activeStep === step.id ? "current" : completedSteps.includes(step.id) ? "completed" : "upcoming"; const executing = runningStep === step.id; return <li key={step.id} className={workspace.step}>
        <Button variant="ghost" size="sm" data-testid={`itv-workbench-step-${step.id}`} data-state={executing ? "running" : state} aria-busy={executing} type="button" aria-current={state === "current" ? "step" : undefined} onClick={() => onStepChange(step.id)} className={cn(workspace.command, "text-background-foreground", (state === "current" || executing) && "font-bold")}>
          <ResearchWorkspaceStepIndicator number={index + 1} active={state === "current"} completed={state === "completed"} running={executing} />
          <span className="truncate">{step.label}</span>
          {executing && <span role="status" className="sr-only">进行中</span>}
          <span className="sr-only">{step.detail}</span>
        </Button>
        {index < steps.length - 1 && <span aria-hidden className={workspace.connector} />}
      </li>; })}</ol>
    </nav>
    </div>
  </header>;
}
