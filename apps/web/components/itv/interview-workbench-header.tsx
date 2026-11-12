"use client";
import { useBrowserTitle } from "@/components/system/browser-title";
import { interviewZhCN } from "@/lib/i18n/namespaces/interview";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { researchWorkspaceStyle as workspace, ResearchWorkspaceStepIndicator } from "@/components/research-studio/research-workspace-style";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";

export const INTERVIEW_WORKBENCH_STEPS = [
  { id: "intake", label: interviewZhCN["itv.step.intake"], detail: interviewZhCN["itv.step.intake.detail"] },
  { id: "analysis", label: interviewZhCN["itv.step.analysis"], detail: interviewZhCN["itv.step.analysis.detail"] },
  { id: "experts", label: interviewZhCN["itv.step.experts"], detail: interviewZhCN["itv.step.experts.detail"] },
  { id: "outline", label: interviewZhCN["itv.step.outline"], detail: interviewZhCN["itv.step.outline.detail"] },
  { id: "runs", label: interviewZhCN["itv.step.runs"], detail: interviewZhCN["itv.step.runs.detail"] },
  { id: "report", label: interviewZhCN["itv.step.report"], detail: interviewZhCN["itv.step.report.detail"] },
] as const;

const stepKeys = {"intake": {"label": "itv.step.intake", "detail": "itv.step.intake.detail"}, "analysis": {"label": "itv.step.analysis", "detail": "itv.step.analysis.detail"}, "experts": {"label": "itv.step.experts", "detail": "itv.step.experts.detail"}, "outline": {"label": "itv.step.outline", "detail": "itv.step.outline.detail"}, "runs": {"label": "itv.step.runs", "detail": "itv.step.runs.detail"}, "report": {"label": "itv.step.report", "detail": "itv.step.report.detail"}} as const;

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
  completionPending = false,
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
  readonly completionPending?: boolean;
  readonly runningStep?: string | null;
}) {
  const { t } = useI18n();
  useBrowserTitle(name);
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
        <ActionButton data-testid="itv-return-history" type="button" variant="outline" onClick={onReturnToList}><ArrowLeft className="size-4" aria-hidden />{t("itv.back")}</ActionButton>
          <MessageSquareText aria-hidden className="size-9 shrink-0 rounded-lg bg-primary p-2 text-primary-foreground" />
          <span className="text-xl font-bold">{t("itv.title")}</span>
        </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span data-testid="itv-workflow-status" className="sr-only">{t("itv.status", { status })}</span>
        <span data-testid="itv-workflow-version" className="sr-only">{t("itv.version", { version })}</span>
        {topic && <span data-testid="itv-persisted-topic" className="sr-only">{t("itv.topic", { topic })}</span>}
        {tags.map((tag) => <span key={tag} className="hidden rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground lg:inline-flex">{tag}</span>)}
        {onOpenSkill && <ActionButton data-testid="itv-skill-drawer-trigger" type="button" variant="outline" onClick={onOpenSkill}><MessageSquareText className="size-4" aria-hidden />{t("itv.assistant")}</ActionButton>}
      </div>
    </div>
    </div>
    </div>
    <div className={workspace.heading}>
    <h1 className="break-words text-2xl font-bold tracking-tight [overflow-wrap:anywhere]">{name}</h1>
    <nav aria-label={t("itv.steps")} data-testid="itv-workbench-navigation" data-reference-variant="monochrome-stepper" className="mt-3 pb-3">
      <ol data-testid="itv-workbench-timeline" className={workspace.timeline}>{steps.map((step, index) => { const state = activeStep === step.id ? "current" : completedSteps.includes(step.id) ? "completed" : "upcoming"; const executing = runningStep === step.id; return <li key={step.id} className={workspace.step}>
        <Button variant="ghost" size="sm" data-testid={`itv-workbench-step-${step.id}`} data-state={completionPending && state !== "current" ? "unknown" : executing ? "running" : state} aria-busy={executing} type="button" aria-current={state === "current" ? "step" : undefined} onClick={() => onStepChange(step.id)} className={cn(workspace.command, "text-background-foreground", (state === "current" || executing) && "font-bold")}>
          {completionPending && state !== "current" ? <span aria-label={t("itv.steps.loading")} className="size-8 shrink-0 rounded-full bg-muted motion-safe:animate-pulse" /> : <ResearchWorkspaceStepIndicator animateRunning={step.id !== "outline"} number={index + 1} active={state === "current"} completed={state === "completed"} running={executing} />}
          <span className="min-w-0 whitespace-normal break-words text-left">{INTERVIEW_WORKBENCH_STEPS.some(item => item.id === step.id && item.label === step.label) ? t(stepKeys[step.id as keyof typeof stepKeys].label) : step.label}</span>
          {executing && <span role="status" className="sr-only">{t("itv.running")}</span>}
          <span className="sr-only">{INTERVIEW_WORKBENCH_STEPS.some(item => item.id === step.id && item.detail === step.detail) ? t(stepKeys[step.id as keyof typeof stepKeys].detail) : step.detail}</span>
        </Button>
        {index < steps.length - 1 && <span aria-hidden className={workspace.connector} />}
      </li>; })}</ol>
    </nav>
    </div>
  </header>;
}
