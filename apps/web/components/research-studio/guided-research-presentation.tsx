"use client";

import { useI18n } from "@/lib/i18n/provider";
import { researchZhCN } from "@/lib/i18n/namespaces/research";
import type { MessageKey } from "@/lib/i18n/messages";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import type { research } from "@repo/contracts";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ResearchNode = z.infer<typeof research.GuidedResearchRuntimeCommand>["node"];

export const researchSteps: readonly ResearchNode[] = ["brief", "directions", "outline", "research", "report"];
export const researchStepLabels: Record<ResearchNode, string> = {
  brief: researchZhCN["research.node.brief"],
  directions: researchZhCN["research.node.directions"],
  outline: researchZhCN["research.node.outline"],
  research: researchZhCN["research.node.research"],
  report: researchZhCN["research.node.report"],
};

export function ResearchProgress({ node, availableNodes, busy, completed, onNavigate, onBack }: {
  node: ResearchNode;
  availableNodes: readonly ResearchNode[];
  busy: boolean;
  completed: boolean;
  onNavigate: (node: ResearchNode) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  if (node === "report") return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3" data-testid="research-progress-shell" data-layout="report-toolbar">
    <Button variant="ghost" size="sm" onClick={onBack} data-testid="research-flow-back"><ArrowLeft className="h-4 w-4" aria-hidden />{t("research.progress.back")}</Button>
    <details className="relative"><summary className="cursor-pointer rounded-md px-3 py-2 text-12 text-muted-foreground">{t("research.progress.view")}</summary><nav aria-label={t("research.shell.steps")} data-testid="research-flow-progress" className="absolute right-0 z-40 mt-2 flex w-56 flex-col rounded-lg border border-border bg-card p-2 shadow-lg">{researchSteps.map((step, index) => <Button key={step} variant="ghost" disabled={busy || !availableNodes.includes(step)} aria-current={step === node ? "step" : undefined} onClick={() => onNavigate(step)}>{index + 1}. {t(`research.node.${step}`)}</Button>)}</nav></details>
  </div>;
  const furthest = Math.max(...availableNodes.map((item) => researchSteps.indexOf(item)), 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-testid="research-progress-shell" data-layout="right-aligned-progress">
      <div className="hidden lg:block" aria-hidden="true" />
      <nav aria-label={t("research.shell.steps")} className="min-w-0 rounded-lg border border-border bg-card px-3 py-3 text-card-foreground sm:px-4" data-testid="research-flow-progress" data-density="compact">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button variant="ghost" size="sm" className="w-fit shrink-0" onClick={onBack} data-testid="research-flow-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("research.progress.back")}
          </Button>
          <ol className="flex min-w-0 flex-1 items-start">
            {researchSteps.map((step, index) => {
              const current = step === node;
              const done = completed || index < furthest;
              const accessible = availableNodes.includes(step);
              return (
                <li key={step} className="relative min-w-0 flex-1">
                  {index < researchSteps.length - 1 && <span aria-hidden="true" className={cn("pointer-events-none absolute left-1/2 top-4 z-10 h-px w-full", index < furthest ? "bg-primary" : "bg-border")} />}
                  <Button
                    variant="ghost"
                    className={cn("relative h-auto w-full flex-col gap-2 whitespace-normal rounded-lg px-0.5 py-0 transition-colors hover:bg-accent hover:text-accent-foreground disabled:bg-card disabled:text-muted-foreground", current && "font-semibold text-background-foreground")}
                    disabled={busy || !accessible}
                    aria-current={current ? "step" : undefined}
                    aria-label={t(done && !current ? "research.progress.completed" : "research.progress.step", { number: index + 1, label: t(`research.node.${step}`) })}
                    onClick={() => onNavigate(step)}
                  >
                    <Badge tone={current ? "primary" : done ? "primary" : "outline"} className={cn("relative z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-0 text-12", !current && !done && "bg-card", current ? "border-primary ring-2 ring-ring ring-offset-2 ring-offset-card" : "border-border")}>
                      {done && !current ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
                    </Badge>
                    <span className="text-center text-11 leading-relaxed sm:text-12">{t(`research.node.${step}`)}</span>
                  </Button>
                </li>
              );
            })}
          </ol>
        </div>
      </nav>
    </div>
  );
}

const loadingCopy: Record<ResearchNode, { title: MessageKey; description: MessageKey }> = {
  brief: { title: "research.loading.brief.title", description: "research.loading.brief.description" },
  directions: { title: "research.loading.directions.title", description: "research.loading.directions.description" },
  outline: { title: "research.loading.outline.title", description: "research.loading.outline.description" },
  research: { title: "research.loading.research.title", description: "research.loading.research.description" },
  report: { title: "research.loading.report.title", description: "research.loading.report.description" },
};

export function ResearchLoading({ node }: { node: ResearchNode }) {
  const { t } = useI18n();
  const copy = loadingCopy[node];
  return (
    <section data-testid="research-step-loading" aria-busy="true" className="min-w-0">
      <div role="status" aria-live="polite" aria-atomic="true" className="flex items-start gap-3 rounded-lg border border-border bg-card p-5 text-card-foreground sm:p-6">
        <Badge tone="primary" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-0">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        </Badge>
        <div className="min-w-0 space-y-2">
          <h2 className="text-18 font-semibold tracking-tight text-background-foreground">{t(copy.title)}</h2>
          <p className="text-13 leading-relaxed text-muted-foreground">{t(copy.description)}</p>
          <p className="text-12 text-muted-foreground">{t("research.loading.auto")}</p>
        </div>
      </div>
    </section>
  );
}
