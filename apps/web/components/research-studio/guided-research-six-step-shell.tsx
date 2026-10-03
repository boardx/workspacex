import * as React from "react";
import { ArrowLeft, Search, Bot } from "lucide-react";
import { researchWorkspaceStyle as workspace, ResearchWorkspaceStepIndicator } from "./research-workspace-style";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GUIDED_RESEARCH_SIX_STEPS, type GuidedResearchVisualStage } from "@/lib/guided-research-six-step";
import { guidedResearchRoute } from "@/lib/guided-research-routes";

export function GuidedResearchSixStepShell({
  current,
  running,
  completed: researchCompleted = false,
  completedStages,
  researchName,
  available,
  onBack,
  onNavigate,
  onHistoryNavigate,
  main,
  assistant,
  assistantOpen: controlledAssistantOpen,
  onAssistantOpenChange,
  sessionId,
  hasUnsavedChanges = false,
}: {
  current: GuidedResearchVisualStage;
  running?: GuidedResearchVisualStage;
  completed?: boolean;
  completedStages?: readonly GuidedResearchVisualStage[];
  researchName?: string;
  available: readonly GuidedResearchVisualStage[];
  onBack?: () => void;
  onNavigate: (stage: GuidedResearchVisualStage) => void;
  onHistoryNavigate?: (stage: GuidedResearchVisualStage) => void;
  main: React.ReactNode;
  assistant?: React.ReactNode;
  assistantOpen?: boolean;
  onAssistantOpenChange?: (open: boolean) => void;
  sessionId?: string;
  hasUnsavedChanges?: boolean;
}) {
  const furthestIndex = Math.max(...available.map((stage) => GUIDED_RESEARCH_SIX_STEPS.findIndex((item) => item.id === stage)), 0);
  const [internalAssistantOpen, setInternalAssistantOpen] = React.useState(false);
  const assistantOpen = controlledAssistantOpen ?? internalAssistantOpen;
  const setAssistantOpen = onAssistantOpenChange ?? setInternalAssistantOpen;
  const [leaveAction, setLeaveAction] = React.useState<(() => void) | null>(null);
  const requestLeave = React.useCallback((action: () => void) => {
    if (hasUnsavedChanges) setLeaveAction(() => action);
    else action();
  }, [hasUnsavedChanges]);
  React.useEffect(() => {
    if (!sessionId || !onHistoryNavigate) return;
    const restoreRoute = () => {
      if (window.location.pathname === "/research") {
        if (hasUnsavedChanges) {
          window.history.replaceState({}, "", guidedResearchRoute(sessionId, current));
          requestLeave(() => onBack?.());
        } else onBack?.();
        return;
      }
      const stage = window.location.pathname.split("/").at(-1) as GuidedResearchVisualStage;
      if (!available.includes(stage) || stage === current) return;
      if (hasUnsavedChanges) {
        // popstate does not fire beforeunload; keep the current draft and URL until the user decides.
        window.history.replaceState({}, "", guidedResearchRoute(sessionId, current));
        requestLeave(() => onNavigate(stage));
      } else onHistoryNavigate(stage);
    };
    window.addEventListener("popstate", restoreRoute);
    return () => window.removeEventListener("popstate", restoreRoute);
  }, [available, current, hasUnsavedChanges, onBack, onHistoryNavigate, onNavigate, requestLeave, sessionId]);
  React.useEffect(() => {
    if (!hasUnsavedChanges) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [hasUnsavedChanges]);
  return (
    <div className="min-h-dvh min-w-0 bg-muted/20" data-testid="guided-research-six-step-shell" data-layout="deep-research-desktop" data-reference-layout="prototype-desktop">
      <header className={workspace.header} data-testid="research-workspace-header">
        <div className={workspace.brandBar}><div className={cn(workspace.width, "flex items-center gap-3")}><Search className="size-9 rounded-lg bg-primary p-2 text-primary-foreground" /><span className="text-xl font-bold">Deep Research</span>{current !== "import" && <span className="hidden rounded bg-muted px-3 py-1 text-sm text-muted-foreground sm:block">智能研究平台</span>}</div></div>
        <div className={workspace.heading}>
          {onBack && <Button variant="primary" className="mb-4 h-10 text-sm" data-testid="research-flow-back" onClick={() => requestLeave(onBack)}><ArrowLeft className="mr-2 size-4" />返回研究列表</Button>}
          <h1 className="text-2xl font-bold tracking-tight">{researchName?.trim() || "新建研究"}</h1>
          <nav aria-label="研究步骤" data-testid="research-flow-progress" data-reference-variant="monochrome-stepper" className="mt-3 pb-3">
          <ol className={workspace.timeline}>
            {GUIDED_RESEARCH_SIX_STEPS.map((step, index) => {
              const unlocked = available.includes(step.id);
              const active = step.id === current;
              const executing = step.id === running;
              const completed = !executing && unlocked && (researchCompleted || (completedStages ? completedStages.includes(step.id) : index < furthestIndex));
              const stepContent = <><ResearchWorkspaceStepIndicator number={index + 1} active={active} completed={completed} running={executing} /><span className="truncate">{step.label}</span></>;
              return <li key={step.id} className={workspace.step}>
                {!unlocked ? <span data-testid={`research-step-${step.id}`} aria-current={active ? "step" : undefined} aria-disabled="true" className="inline-flex min-h-6 items-center gap-2 p-1 text-sm text-muted-foreground">{stepContent}</span> :
                <Button
                  asChild={Boolean(sessionId && unlocked)}
                  variant="ghost"
                  size="sm"
                  className={cn(workspace.command, "text-background-foreground", (active || executing) && "font-bold")}
                  aria-busy={executing || undefined}
                  aria-current={active ? "step" : undefined}
                  onClick={(event) => { event.preventDefault(); if (!active) requestLeave(() => onNavigate(step.id)); }}
                >
                  {sessionId && unlocked ? <a role="button" href={`/research/${encodeURIComponent(sessionId)}/${step.id}`}>{stepContent}</a> : stepContent}
                </Button>}
                {index < GUIDED_RESEARCH_SIX_STEPS.length - 1 && <span className={workspace.connector} aria-hidden />}
              </li>;
            })}
          </ol>
          </nav>
        </div>
      </header>
      <main className={cn(workspace.main, assistant ? "pb-24 md:pb-8" : "pb-8")} data-reference-region="work-canvas" data-testid="guided-research-six-step-main">{main}</main>
      <Dialog open={Boolean(leaveAction)} onOpenChange={(open) => { if (!open) setLeaveAction(null); }}><DialogContent><DialogTitle>研究内容尚未保存</DialogTitle><DialogDescription>离开会放弃当前页面未保存的修改。已保存的研究和报告不会被删除。</DialogDescription><div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setLeaveAction(null)}>继续编辑</Button><Button variant="primary" onClick={() => { const action = leaveAction; setLeaveAction(null); action?.(); }}>放弃修改并离开</Button></div></DialogContent></Dialog>
      {assistant && <div className="fixed bottom-4 right-4 z-30 md:bottom-5 md:left-10 md:right-auto"><Button variant="primary" className="h-10 rounded-full px-5 text-base shadow-lg" aria-expanded={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)}><Bot className="mr-2 size-6" />AI 助手</Button>{assistantOpen && <aside className="absolute bottom-14 right-0 max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-card p-5 shadow-xl md:left-0 md:right-auto" data-testid="guided-research-six-step-assistant">{assistant}</aside>}</div>}
    </div>
  );
}
