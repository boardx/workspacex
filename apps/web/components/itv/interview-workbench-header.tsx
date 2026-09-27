"use client";

import { ArrowLeft, MessageSquareText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  readonly onOpenSkill: () => void;
}) {
  return <header data-testid="itv-workbench-header" className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="flex items-center gap-2 text-xs font-medium text-primary"><Sparkles className="size-4" aria-hidden />AI 模拟访谈工作台</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{name}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">将需求、分析、专家意见和访谈证据收敛为可审阅的 Markdown 研究资产。</p>
        <div className="mt-3 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{tag}</span>)}</div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button data-testid="itv-skill-drawer-trigger" type="button" variant="outline" onClick={onOpenSkill}><MessageSquareText className="size-4" aria-hidden />访谈助手</Button>
        <Button data-testid="itv-return-history" type="button" variant="outline" onClick={onReturnToList}><ArrowLeft className="size-4" aria-hidden />返回访谈列表</Button>
      </div>
    </div>
    <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-4 text-xs text-muted-foreground"><span data-testid="itv-workflow-status">状态：{status}</span><span data-testid="itv-workflow-version">版本 {version}</span>{topic && <span data-testid="itv-persisted-topic">已确认主题：{topic}</span>}</div>
    <div data-testid="itv-workbench-navigation"><ol data-testid="itv-workbench-timeline" className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">{steps.map((step, index) => <li key={step.id}><Button data-testid={`itv-workbench-step-${step.id}`} type="button" variant={activeStep === step.id ? "primary" : "outline"} aria-current={activeStep === step.id ? "step" : undefined} onClick={() => onStepChange(step.id)} className="h-auto w-full justify-start whitespace-normal px-3 py-3 text-left"><span className="mr-2 grid size-6 shrink-0 place-items-center rounded-full bg-background/20 text-xs">{index + 1}</span><span><span className="block text-sm">{step.label}</span><span className="mt-1 block text-xs font-normal opacity-80">{step.detail}</span></span></Button></li>)}</ol></div>
  </header>;
}
