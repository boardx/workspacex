"use client";
import Link from "next/link";
import { ArrowRight, Compass, UsersRound, ScanLine, Lightbulb, Layers3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { aidtSharedDraftSignature } from "@/features/aidt/lib/use-aidt-shared-stages";
import { aidtUiStageSummary, type AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";

const STAGE_ICONS = [Compass, UsersRound, ScanLine, Lightbulb, Layers3, RefreshCw] as const;

export function AidtDashboard({ href, drafts, shared }: { href: (step: number) => string; drafts?: AidtUiDrafts; shared?: { phase: "loading" | "ready" | "error"; stages: Readonly<Record<number, AidtSharedStage>>; error?: string; reload?: () => void } }) {
  function stageState(stageId: number) {
    if (shared && shared.phase !== "ready") return null;
    const saved = shared?.stages[stageId], local = drafts?.[stageId];
    if (saved) return `已保存 · V${saved.revision}${local && aidtSharedDraftSignature(local) !== aidtSharedDraftSignature(saved.content.draft) ? " · 有修改" : ""}`;
    return local && aidtUiStageSummary(stageId, local) ? "本页有未保存内容" : null;
  }
  const firstStart = shared?.phase === "ready" && Object.keys(shared.stages).length === 0 && !AIDT_STEPS.some((step) => drafts?.[step.id] && aidtUiStageSummary(step.id, drafts[step.id]!));
  const editedStage = AIDT_STEPS.find(({ id }) => {
    const draft = drafts?.[id], saved = shared?.stages[id];
    return draft && (saved
      ? aidtSharedDraftSignature(draft) !== aidtSharedDraftSignature(saved.content.draft)
      : Boolean(aidtUiStageSummary(id, draft)));
  });
  const nextTask = shared?.phase === "ready"
    ? editedStage ?? AIDT_STEPS.find(({ id }) => !shared.stages[id]) ?? AIDT_STEPS[5]
    : null;
  return <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8 sm:gap-8 sm:px-8 sm:py-12 lg:px-12" aria-label="AIDT 设计思维" data-testid="aidt-dashboard">
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div className="space-y-2">
        <p className="text-12 font-medium tracking-wide text-muted-foreground">AIDT · 设计思维</p>
        <h1 className="text-30 font-semibold tracking-tight text-background-foreground sm:text-40">六步，探索新的可能。</h1>
        <p className="text-14 leading-relaxed text-muted-foreground">从理解问题，到测试你的想法。</p>
      </div>
      {nextTask && <Button asChild variant="primary" className="gap-2 rounded-pill px-5">
        <Link href={href(nextTask.id)} data-testid={firstStart ? "aidt-first-start" : "aidt-continue-task"}>
          {firstStart ? "从第1步开始" : `继续第${nextTask.id}步`}<ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      </Button>}
    </header>
    {shared?.phase === "loading" && <p role="status" className="text-13 text-muted-foreground" data-testid="aidt-dashboard-loading">正在读取小组成果…</p>}
    {shared?.phase === "error" && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-card p-4 text-13" data-testid="aidt-dashboard-error"><p>{shared.error || "小组成果读取失败，不能确定保存状态。"}</p>{shared.reload && <Button variant="outline" size="sm" onClick={shared.reload}>重新读取成果</Button>}</div>}
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      {AIDT_STEPS.map((step, index) => {
        const Icon = STAGE_ICONS[index]!;
        const status = stageState(step.id);
        return <Link key={step.id} href={href(step.id)} className="group flex min-w-0 items-center gap-4 rounded-container border border-border/60 bg-card p-4 text-card-foreground shadow-sm transition-all duration-base hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:hover:-translate-y-0.5 sm:min-h-52 sm:flex-col sm:items-stretch sm:gap-5 sm:p-6" data-testid={`aidt-step-${step.id}`}>
          <div className="flex shrink-0 items-center justify-between sm:w-full">
            <Icon aria-hidden strokeWidth={1.5} className="h-6 w-6 text-muted-foreground transition-colors duration-base group-hover:text-primary" />
            <span aria-hidden className="hidden text-12 font-medium tabular-nums text-muted-foreground sm:inline">{String(step.id).padStart(2, "0")}</span>
          </div>
          <div className="min-w-0 flex-1 space-y-1 sm:space-y-2">
            <h2 className="text-16 font-semibold tracking-tight sm:text-20">{step.title}</h2>
            <p className="text-12 leading-relaxed text-muted-foreground sm:text-13">{step.summary}</p>
            {status && <p className="text-11 text-muted-foreground" data-testid={`aidt-stage-save-${step.id}`}>{status}</p>}
          </div>
          <div className="ml-auto flex shrink-0 items-center justify-end sm:mt-auto sm:min-h-5 sm:pt-1">
            <ArrowRight aria-hidden strokeWidth={1.5} className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base motion-safe:group-hover:translate-x-1" />
          </div>
        </Link>;
      })}
    </div>
  </section>;
}
