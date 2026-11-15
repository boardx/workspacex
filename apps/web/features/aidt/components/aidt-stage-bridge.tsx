"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AIDT_STEPS, aidtHref } from "@/features/aidt/lib/project-aidt";
import { AIDT_OUTPUTS, aidtUiStageMarkdown, aidtV2StageLines, hasAidtV2Data, type AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";

export function aidtDraftCount(draft: AidtUiDrafts[number]): number {
  return Object.values(draft.fields).filter((value) => value.trim()).length + draft.ideas.filter((idea) => idea.title.trim() || idea.description.trim() || idea.image).length;
}

/** Visible student-authored context; not an automatic AI context or completion receipt. */
export function AidtStageBridge({ projectId, stageNumber, drafts, toChat, discoveryCardsRevision, readOnly = false }: { projectId: string; stageNumber: number; drafts: AidtUiDrafts; discoveryCardsRevision?: number; toChat?: (text: string) => ComposerOfferResult; readOnly?: boolean }) {
  const [status, setStatus] = React.useState("");
  const earlier = AIDT_STEPS.filter((step) => step.id < stageNumber && aidtDraftCount(drafts[step.id]!) > 0);
  return <section className="space-y-3" aria-label="阶段交接" data-testid="aidt-stage-bridge">
    <div><h3 className="text-16 font-semibold">带着前面的研究继续</h3><p className="mt-2 text-12 text-muted-foreground">展示已读取成果与本页修改；保存状态请核对各步回执。未自动发送给 AI；带入聊天需主动审阅发送。</p></div>
    {earlier.length ? earlier.map((step) => <details key={step.id} className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-13 font-medium">{step.id}. {AIDT_OUTPUTS[step.id]!.title} · 本页草稿</summary>
      <dl className="mt-3 space-y-2 text-13">{AIDT_OUTPUTS[step.id]!.fields.filter((field) => drafts[step.id]!.fields[field.id]?.trim()).map((field) => <div key={field.id}><dt className="font-medium">{field.label}</dt><dd className="mt-1 break-words whitespace-pre-wrap text-muted-foreground">{drafts[step.id]!.fields[field.id]}</dd></div>)}
        {step.id === 4 && drafts[4]!.ideas.filter((idea) => idea.title.trim() || idea.description.trim()).map((idea) => <div key={idea.id}><dt className="font-medium">{idea.title || "待命名点子"}{drafts[4]!.selectedIdeaId === idea.id ? " · 拟选择" : ""}</dt><dd className="break-words whitespace-pre-wrap text-muted-foreground">{idea.description}</dd></div>)}
      </dl>{hasAidtV2Data(step.id, drafts[step.id]!) && <div className="mt-3 whitespace-pre-wrap break-words border-t border-border pt-3 text-12" data-testid="aidt-v2-handoff">{aidtV2StageLines(step.id, drafts[step.id]!, drafts[2]?.discoveryCards, discoveryCardsRevision).join("\n")}</div>}<div className="mt-3 flex flex-wrap items-center gap-3"><Link href={aidtHref(projectId, step.id, { tool: "outcome" })} className="inline-block text-12 text-primary underline">返回修改这份草稿</Link>{toChat && <Button variant="outline" size="sm" disabled={readOnly} onClick={() => {
        const result = toChat(`以下是前面步骤的学生草稿，请作为待核对背景，不当成真实证据或已确认结论。\n\n${aidtUiStageMarkdown(step.id, drafts[step.id]!, drafts[2]?.discoveryCards, discoveryCardsRevision)}`);
        setStatus(result === "accepted" ? "已带入本步聊天，请审阅后发送。" : result === "occupied" ? "聊天已有未发送内容，未覆盖；请先处理原草稿。" : "本步聊天尚未就绪，请稍后重试。");
      }}>带入本步聊天供讨论</Button>}</div>
    </details>) : <p className="rounded-lg border border-dashed border-border p-4 text-13 text-muted-foreground">本页还没有前序成果草稿。已有的共享记录请在对应步骤聊天查看；不代表本组尚未研究。</p>}
    <p role="status" aria-live="polite" className="text-12 text-muted-foreground">{status}</p>
  </section>;
}
