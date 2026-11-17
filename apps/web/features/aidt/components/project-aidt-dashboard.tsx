"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { aidtSharedDraftSignature } from "@/features/aidt/lib/use-aidt-shared-stages";
import { AIDT_OUTPUTS, aidtUiStageSummary } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtDraftCount } from "@/features/aidt/components/aidt-stage-bridge";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
export function AidtDashboard({ href, drafts, shared }: { href: (step: number) => string; drafts?: AidtUiDrafts; shared?: { phase: "loading" | "ready" | "error"; stages: Readonly<Record<number, AidtSharedStage>>; error?: string; reload?: () => void } }) {
  function stageState(stageId: number) {
    if (!shared) return drafts && (aidtDraftCount(drafts[stageId]!) ? `本页草稿 · ${aidtDraftCount(drafts[stageId]!)} 项已填写` : "本页尚未填写");
    if (shared.phase !== "ready") return null;
    const saved = shared.stages[stageId], local = drafts?.[stageId];
    if (saved) return `小组已保存 · V${saved.revision}${local && aidtSharedDraftSignature(local) !== aidtSharedDraftSignature(saved.content.draft) ? " · 本页有修改" : ""}`;
    return local && aidtUiStageSummary(stageId, local) ? "本页有未保存内容" : "尚未保存成果";
  }
  const firstStart = shared?.phase === "ready" && Object.keys(shared.stages).length === 0 && !AIDT_STEPS.some((step) => drafts?.[step.id] && aidtUiStageSummary(step.id, drafts[step.id]!));
  return <section className="flex flex-col gap-3" aria-label="AIDT 设计思维" data-testid="aidt-dashboard">
    <header className="mb-1 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-24 font-semibold">本组六步研究</h1>{firstStart && <Button asChild variant="primary"><Link href={href(1)} data-testid="aidt-first-start">从第1步开始</Link></Button>}</div>
      <p className="text-12 leading-relaxed text-muted-foreground sm:text-13">先思考，再与 AI 协同；用证据推进，由小组做决定。</p>
    </header>
    {shared?.phase === "loading" && <p role="status" className="text-12 text-muted-foreground" data-testid="aidt-dashboard-loading">正在读取小组已保存的成果…</p>}
    {shared?.phase === "error" && <div role="alert" className="flex flex-wrap items-center gap-3 text-12" data-testid="aidt-dashboard-error"><p>{shared.error || "小组成果读取失败，不能确定保存状态。"}</p>{shared.reload && <Button variant="outline" size="sm" onClick={shared.reload}>重新读取成果</Button>}</div>}
    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
      {AIDT_STEPS.map((step) => <Link key={step.id} href={href(step.id)} className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-3 text-card-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-40 sm:p-4" data-testid={`aidt-step-${step.id}`}>
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-14 font-semibold text-primary" aria-hidden>{step.id}</span>
          <div className="min-w-0 flex-1"><h2 className="text-14 font-medium">{step.title}</h2><p className="mt-1 hidden text-12 leading-relaxed text-muted-foreground sm:block">{step.summary}</p><p className="mt-1 text-11 leading-relaxed text-muted-foreground"><span className="sm:hidden">{AIDT_OUTPUTS[step.id]!.title}{stageState(step.id) ? " · " : ""}</span>{stageState(step.id) && <span data-testid={`aidt-stage-save-${step.id}`}>{stageState(step.id)}</span>}</p></div>
          <span className="self-center text-13 text-muted-foreground sm:hidden" aria-hidden>→</span>
        </div>
        <div className="mt-auto hidden items-center justify-between gap-2 border-t border-border pt-3 text-11 text-muted-foreground sm:flex"><span>成果 · {AIDT_OUTPUTS[step.id]!.title}</span><span>进入对话 →</span></div>
      </Link>)}
    </div>
    {shared ? <p className="text-11 text-muted-foreground">保存版本不代表阶段完成或全员确认，可随时返回修订。</p> : drafts && <p className="text-12 text-muted-foreground">以上仅为本页填写概览，不代表小组进度或阶段确认。小组已保存成果需读取后核对。</p>}
    <details className="rounded-lg border border-border p-3 text-12" data-testid="aidt-self-review"><summary className="cursor-pointer font-medium">本组六步成果自检</summary><p className="my-2 text-muted-foreground">这是学习检查清单，不是自动完成判定。请保存本组成果和决定；缺少证据时继续研究。</p><ol className="list-decimal space-y-3 pl-5">{AIDT_STEPS.map((step) => <li key={step.id}><strong>{step.title}</strong><p className="mt-1 text-muted-foreground">{step.outcome}</p></li>)}</ol><p className="mt-3 text-muted-foreground">全员确认、阶段完成统计与教师评分尚未提供。</p></details>
  </section>;
}
