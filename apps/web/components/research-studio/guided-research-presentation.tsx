"use client";

import { ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";
import type { research } from "@repo/contracts";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ResearchNode = z.infer<typeof research.GuidedResearchRuntimeCommand>["node"];

export const researchSteps: readonly ResearchNode[] = ["brief", "directions", "outline", "research", "report"];
export const researchStepLabels: Record<ResearchNode, string> = {
  brief: "确认主题",
  directions: "研究方向",
  outline: "报告大纲",
  research: "资料研究",
  report: "研究报告",
};

export function ResearchProgress({ node, availableNodes, busy, completed, onNavigate, onBack }: {
  node: ResearchNode;
  availableNodes: readonly ResearchNode[];
  busy: boolean;
  completed: boolean;
  onNavigate: (node: ResearchNode) => void;
  onBack: () => void;
}) {
  const furthest = Math.max(...availableNodes.map((item) => researchSteps.indexOf(item)), 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-testid="research-progress-shell" data-layout="right-aligned-progress">
      <div className="hidden lg:block" aria-hidden="true" />
      <nav aria-label="研究步骤" className="min-w-0 rounded-lg border border-border bg-card px-3 py-3 text-card-foreground sm:px-4" data-testid="research-flow-progress" data-density="compact">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button variant="ghost" size="sm" className="w-fit shrink-0" onClick={onBack} data-testid="research-flow-back">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />返回
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
                    aria-label={`${index + 1}. ${researchStepLabels[step]}${done && !current ? "，已完成" : ""}`}
                    onClick={() => onNavigate(step)}
                  >
                    <Badge tone={current ? "primary" : done ? "primary" : "outline"} className={cn("relative z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-0 text-12", !current && !done && "bg-card", current ? "border-primary ring-2 ring-ring ring-offset-2 ring-offset-card" : "border-border")}>
                      {busy && current ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : done && !current ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
                    </Badge>
                    <span className="text-center text-11 leading-relaxed sm:text-12">{researchStepLabels[step]}</span>
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

const loadingCopy: Record<ResearchNode, { title: string; description: string }> = {
  brief: { title: "正在梳理研究主题", description: "模型正在整理研究目标与范围，完成后可继续调整。" },
  directions: { title: "正在生成研究方向", description: "模型正在根据已确认的主题，拆解值得研究的问题。" },
  outline: { title: "正在生成报告大纲", description: "模型正在将研究方向组织为清晰的章节结构。" },
  research: { title: "正在研究资料", description: "正在根据报告大纲规划检索任务，并收集相关来源。进度会自动保存。" },
  report: { title: "正在生成研究报告", description: "模型正在结合已保留的来源撰写报告，并整理引用。" },
};

export function ResearchLoading({ node }: { node: ResearchNode }) {
  const copy = loadingCopy[node];
  return (
    <section data-testid="research-step-loading" aria-busy="true" className="min-w-0 space-y-6">
      <div role="status" aria-live="polite" aria-atomic="true" className="flex items-start gap-3 rounded-lg border border-border bg-card p-5 text-card-foreground sm:p-6">
        <Badge tone="primary" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-0">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </Badge>
        <div className="min-w-0 space-y-2">
          <h2 className="text-18 font-semibold tracking-tight text-background-foreground">{copy.title}</h2>
          <p className="text-13 leading-relaxed text-muted-foreground">{copy.description}</p>
          <p className="flex items-center gap-2 text-12 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />请稍候，结果会自动显示</p>
        </div>
      </div>
      <div aria-hidden="true" data-testid="loading" className="space-y-4 motion-safe:animate-pulse">
        {[0, 1, 2].map((index) => (
          <div key={index} className="space-y-4 rounded-lg border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-3"><div className="h-8 w-8 rounded-full bg-muted" /><div className="h-4 w-1/3 rounded bg-muted" /></div>
            <div className="space-y-2.5"><div className="h-3 w-full rounded bg-muted" /><div className="h-3 w-5/6 rounded bg-muted" /><div className="h-3 w-2/3 rounded bg-muted" /></div>
          </div>
        ))}
      </div>
    </section>
  );
}
