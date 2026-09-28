import * as React from "react";
import { ArrowLeft, Check, Search, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GUIDED_RESEARCH_SIX_STEPS, type GuidedResearchVisualStage } from "@/lib/guided-research-six-step";
import { guidedResearchRoute } from "@/lib/guided-research-routes";

const SCREEN_COPY = {
  import: ["新建研究", "通过文件、文本或实时语音输入需求，AI 自动分析并生成详细的研究计划。"],
  topic: ["确认研究主题", "完善你的研究主题与相关信息，这将帮助我们为你制定更精准的研究计划。"],
  plan: ["研究计划", "基于你提供的研究主题，我们已生成以下研究计划。你可以编辑和调整各部分内容，确认后将开始资料研究。"],
  research: ["资料研究", "正在搜索、阅读和分析相关资料，提取关键信息并整理研究发现。"],
  chapters: ["报告章节", "基于已完成的资料研究，整理报告结构与章节内容，你可以调整章节顺序和重点后生成报告。"],
  report: ["研究报告", "以下是根据你的研究需求生成的完整报告，包含研究发现、分析结论和相关建议。"],
} satisfies Record<GuidedResearchVisualStage, readonly [string, string]>;

export function GuidedResearchSixStepShell({
  current,
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
  const currentIndex = GUIDED_RESEARCH_SIX_STEPS.findIndex((item) => item.id === current);
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
      <header className="top-0 z-20 bg-background/95 backdrop-blur md:sticky" data-testid="research-workspace-header">
        <div className="border-b bg-card px-6 py-4 lg:px-10"><div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4"><div className="flex items-center gap-4"><Search className="size-11 rounded-lg bg-primary p-2 text-primary-foreground" /><span className="text-2xl font-bold">Deep Research</span><span className="hidden rounded bg-muted px-4 py-1 text-base text-muted-foreground sm:block">智能研究平台</span></div>{onBack && <Button variant="outline" data-testid="research-flow-back" onClick={() => requestLeave(onBack)}><ArrowLeft className="mr-2 size-4" />返回研究列表</Button>}</div></div>
        <div className="mx-auto max-w-[1440px] px-6 pt-8 lg:px-10"><h1 className="text-2xl font-bold tracking-tight md:text-2xl">{SCREEN_COPY[current][0]}</h1><p className="mt-3 text-base leading-relaxed text-muted-foreground md:text-base">{SCREEN_COPY[current][1]}</p>
          <nav aria-label="研究步骤" data-testid="research-flow-progress" data-reference-variant="monochrome-stepper" className="mt-5 pb-5">
          <ol className="flex flex-wrap items-center gap-y-3 lg:flex-nowrap">
            {GUIDED_RESEARCH_SIX_STEPS.map((step, index) => {
              const unlocked = available.includes(step.id);
              const active = step.id === current;
              const completed = index < currentIndex && unlocked;
              const stepContent = <><span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full border text-2xl", (completed || active) && "border-primary bg-primary text-primary-foreground", active && "ring-2 ring-primary ring-offset-2", !completed && !active && "border-border bg-muted/30 text-muted-foreground")}>{completed ? <Check className="size-6" /> : index + 1}</span><span className="truncate">{step.label}</span></>;
              return <li key={step.id} className="flex min-w-0 flex-1 basis-1/2 items-center sm:basis-1/3 lg:basis-0">
                {!unlocked ? <span data-testid={`research-step-${step.id}`} aria-current={active ? "step" : undefined} aria-disabled="true" className="inline-flex min-h-6 items-center gap-3 p-1 text-base text-muted-foreground md:text-base">{stepContent}</span> :
                <Button
                  asChild={Boolean(sessionId && unlocked)}
                  variant="ghost"
                  size="sm"
                  className={cn("h-auto justify-start gap-3 bg-transparent p-1 text-left text-base hover:bg-transparent md:text-base", active && "font-bold")}
                  aria-current={active ? "step" : undefined}
                  onClick={(event) => { event.preventDefault(); if (!active) requestLeave(() => onNavigate(step.id)); }}
                >
                  {sessionId && unlocked ? <a role="button" href={`/research/${encodeURIComponent(sessionId)}/${step.id}`}>{stepContent}</a> : stepContent}
                </Button>}
                {index < GUIDED_RESEARCH_SIX_STEPS.length - 1 && <span className="mx-3 hidden min-w-3 flex-1 border-t border-border lg:block" aria-hidden />}
              </li>;
            })}
          </ol>
          </nav>
        </div>
      </header>
      <main className="mx-auto min-w-0 max-w-[1440px] px-6 pb-12 pt-2 lg:px-10" data-reference-region="work-canvas" data-testid="guided-research-six-step-main">{main}</main>
      <Dialog open={Boolean(leaveAction)} onOpenChange={(open) => { if (!open) setLeaveAction(null); }}><DialogContent><DialogTitle>研究内容尚未保存</DialogTitle><DialogDescription>离开会放弃当前页面未保存的修改。已保存的研究和报告不会被删除。</DialogDescription><div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setLeaveAction(null)}>继续编辑</Button><Button variant="primary" onClick={() => { const action = leaveAction; setLeaveAction(null); action?.(); }}>放弃修改并离开</Button></div></DialogContent></Dialog>
      {assistant && <div className="fixed bottom-5 left-10 z-30"><Button variant="primary" className="h-10 rounded-full px-6 text-base shadow-lg" aria-expanded={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)}><Bot className="mr-2 size-6" />AI 助手</Button>{assistantOpen && <aside className="absolute bottom-14 left-0 max-h-[70dvh] w-[min(24rem,calc(100vw-2.5rem))] overflow-y-auto rounded-xl border bg-card p-5 shadow-xl" data-testid="guided-research-six-step-assistant">{assistant}</aside>}</div>}
    </div>
  );
}
