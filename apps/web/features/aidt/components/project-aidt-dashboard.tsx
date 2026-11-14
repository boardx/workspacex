"use client";
import Link from "next/link";
import { AIDT_OUTPUTS } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtDraftCount } from "@/features/aidt/components/aidt-stage-bridge";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
export function AidtDashboard({ href, drafts }: { href: (step: number) => string; drafts?: AidtUiDrafts }) {
  return <section className="flex flex-col gap-3" aria-label="AIDT 设计思维" data-testid="aidt-dashboard">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><p className="text-12 font-medium text-muted-foreground">AIDT · 小组学习空间</p><h2 className="mt-2 text-24 font-semibold">一起把问题研究清楚</h2><p className="mt-2 text-13 text-muted-foreground">从一个具体问题出发，用真实证据推进，留下本组的选择与思考。</p></div></div><p className="mb-2 text-12 text-muted-foreground">自己先思考 <span aria-hidden>→</span> 与 AI 协同 <span aria-hidden>→</span> 小组做决定</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {AIDT_STEPS.map((step) => <Link key={step.id} href={href(step.id)} className="flex min-h-44 flex-col gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring" data-testid={`aidt-step-${step.id}`}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-14 font-semibold text-primary" aria-hidden>{step.id}</span><div><h3 className="text-14 font-medium">{step.title}</h3><p className="mt-1 text-12 leading-relaxed text-muted-foreground">{step.summary}</p></div>{drafts && <p className="text-12 text-muted-foreground">{aidtDraftCount(drafts[step.id]!) ? `本页草稿 · ${aidtDraftCount(drafts[step.id]!)} 项已填写` : "本页尚未填写"}</p>}<div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-11 text-muted-foreground"><span>成果 · {AIDT_OUTPUTS[step.id]!.title}</span><span>进入对话 →</span></div>
      </Link>)}
    </div>
    {drafts && <p className="text-12 text-muted-foreground">以上仅为本页填写概览，刷新后重置，不代表小组进度或阶段确认。已保存的讨论请进入各步聊天查看。</p>}
    <details className="rounded-lg border border-border p-4 text-12" data-testid="aidt-self-review"><summary className="cursor-pointer font-medium">本组六步成果自检</summary><p className="my-2 text-muted-foreground">这是学习检查清单，不是自动完成判定。请把本组成果和决定保存在各步共享对话或原生产出物中；缺少证据时继续研究。</p><ol className="list-decimal space-y-3 pl-5">{AIDT_STEPS.map((step) => <li key={step.id}><strong>{step.title}</strong><p className="mt-1 text-muted-foreground">{step.outcome}</p></li>)}</ol><p className="mt-3 text-muted-foreground">全员确认、阶段完成统计与教师评分尚未提供；不会凭对话数量或上传资料就显示“完成”。</p></details>
  </section>;
}
