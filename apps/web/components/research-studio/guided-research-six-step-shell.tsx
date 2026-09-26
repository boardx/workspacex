import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GUIDED_RESEARCH_SIX_STEPS, type GuidedResearchVisualStage } from "@/lib/guided-research-six-step";

export function GuidedResearchSixStepShell({
  current,
  available,
  onNavigate,
  main,
  assistant,
}: {
  current: GuidedResearchVisualStage;
  available: readonly GuidedResearchVisualStage[];
  onNavigate: (stage: GuidedResearchVisualStage) => void;
  main: React.ReactNode;
  assistant?: React.ReactNode;
}) {
  const currentIndex = GUIDED_RESEARCH_SIX_STEPS.findIndex((item) => item.id === current);
  return (
    <div className="min-w-0 bg-background" data-testid="guided-research-six-step-shell" data-layout="deep-research-desktop">
      <div className={cn("grid min-w-0 gap-4", assistant ? "xl:grid-cols-[minmax(0,1fr)_16rem]" : "xl:grid-cols-1")}>
        <div className="min-w-0 space-y-5 px-4 py-5 sm:px-6">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="研究步骤">
            {GUIDED_RESEARCH_SIX_STEPS.map((step, index) => {
              const unlocked = step.id === "list" || available.includes(step.id);
              const active = step.id === current;
              const completed = index < currentIndex && unlocked;
              return <li key={step.id}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("h-auto w-full justify-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted", active && "bg-accent text-accent-foreground")}
                  disabled={!unlocked}
                  aria-current={active ? "step" : undefined}
                  onClick={() => onNavigate(step.id)}
                >
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-11", completed && "border-primary bg-primary text-primary-foreground", active && "border-primary text-primary", !completed && !active && "border-border text-muted-foreground")}>{completed ? "✓" : index + 1}</span>
                  <span className="truncate">步骤 {index + 1} · {step.label}</span>
                </Button>
              </li>;
            })}
          </ol>
          <main className="min-w-0" data-testid="guided-research-six-step-main">{main}</main>
        </div>
        {assistant && <aside className="min-w-0 border-l border-border bg-card p-4 xl:sticky xl:top-0 xl:block xl:h-screen" data-testid="guided-research-six-step-assistant">{assistant}</aside>}
      </div>
    </div>
  );
}
