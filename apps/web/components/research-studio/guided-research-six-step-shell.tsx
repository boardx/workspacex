import * as React from "react";
import { ArrowLeft, Check, Search, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GUIDED_RESEARCH_SIX_STEPS, type GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

export function GuidedResearchSixStepShell({
  current,
  available,
  onBack,
  onNavigate,
  main,
  assistant,
}: {
  current: GuidedResearchVisualStage;
  available: readonly GuidedResearchVisualStage[];
  onBack?: () => void;
  onNavigate: (stage: GuidedResearchVisualStage) => void;
  main: React.ReactNode;
  assistant?: React.ReactNode;
}) {
  const currentIndex = GUIDED_RESEARCH_SIX_STEPS.findIndex((item) => item.id === current);
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  return (
    <div className="min-h-dvh min-w-0 bg-muted/20" data-testid="guided-research-six-step-shell" data-layout="deep-research-desktop" data-reference-layout="prototype-desktop">
      <header className="sticky top-0 z-20 border-b bg-card/95 px-6 py-4 backdrop-blur" data-testid="research-workspace-header">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4"><div className="flex items-center gap-3"><Search className="size-10 rounded-lg bg-primary p-2 text-primary-foreground" /><span className="text-xl font-bold">Deep Research</span><span className="hidden rounded bg-muted px-3 py-1 text-sm text-muted-foreground sm:block">智能研究平台</span></div>{onBack && <Button variant="outline" data-testid="research-flow-back" onClick={onBack}><ArrowLeft className="mr-2 size-4" />返回研究列表</Button>}</div>
          <nav aria-label="研究步骤" data-testid="research-flow-progress" data-reference-variant="monochrome-stepper" className="mx-auto mt-5 max-w-[1440px]">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {GUIDED_RESEARCH_SIX_STEPS.map((step, index) => {
              const unlocked = available.includes(step.id);
              const active = step.id === current;
              const completed = index < currentIndex && unlocked;
              return <li key={step.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("h-auto w-full justify-start gap-3 rounded-lg px-2 py-2 text-left transition-colors", active && "font-semibold")}
                  disabled={!unlocked}
                  aria-current={active ? "step" : undefined}
                  onClick={() => onNavigate(step.id)}
                >
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base", (completed || active) && "border-primary bg-primary text-primary-foreground", active && "ring-2 ring-primary ring-offset-2", !completed && !active && "border-border bg-muted/30 text-muted-foreground")}>{completed ? <Check className="size-5" /> : index + 1}</span>
                  <span className="truncate">{step.label}</span>
                </Button>
              </li>;
            })}
          </ol>
          </nav>
      </header>
      <main className="mx-auto min-w-0 max-w-[1440px] px-6 py-8 lg:px-10" data-reference-region="work-canvas" data-testid="guided-research-six-step-main">{main}</main>
      {assistant && <div className="fixed bottom-5 left-5 z-30"><Button className="rounded-full shadow-lg" aria-expanded={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)}><Bot className="mr-2 size-5" />AI 助手</Button>{assistantOpen && <aside className="absolute bottom-14 left-0 max-h-[70dvh] w-[min(24rem,calc(100vw-2.5rem))] overflow-y-auto rounded-xl border bg-card p-5 shadow-xl" data-testid="guided-research-six-step-assistant">{assistant}</aside>}</div>}
    </div>
  );
}
