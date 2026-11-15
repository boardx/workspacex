"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { AIDT_IDEA_CATEGORIES, aidtClassifiableIdeas, confirmAidtIdeaClassification, readAidtIdeaClassification, repairAidtIdeaClassification, setAidtIdeaCategory, setAidtIdeaClassificationReason } from "@/features/aidt/lib/aidt-idea-classification";

/** Controlled student-authored classification; shared persistence remains the parent's job. */
export function AidtIdeaClassification({ draft, onChange, readOnly = false }: {
  draft: AidtUiStageDraft; onChange: (next: AidtUiStageDraft) => void; readOnly?: boolean;
}): JSX.Element {
  const ideas = aidtClassifiableIdeas(draft), state = readAidtIdeaClassification(draft);
  const change = (next: AidtUiStageDraft): void => { if (!readOnly) onChange(next); };
  return <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label="学生点子分类" data-testid="aidt-idea-classification">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="text-14 font-semibold">先分类，再比较</h3><p className="mt-1 text-12 text-muted-foreground">同一点子可有多个标签，也可暂不分类；由学生判断并说明理由。</p></div>
      <p role="status" className="text-12 text-muted-foreground" data-testid="aidt-classification-status">{state.confirmed ? "学生已确认分类" : "待学生确认分类"}</p>
    </header>
    {state.issues.length > 0 && <div role="alert" className="space-y-2 rounded-md border border-border p-3 text-12" data-testid="aidt-classification-error">
      {state.issues.map((issue) => <p key={issue}>{issue}</p>)}
      <Button type="button" size="sm" variant="outline" disabled={readOnly} onClick={() => change(repairAidtIdeaClassification(draft))}>重新整理分类记录</Button>
    </div>}
    {!ideas.length ? <p className="text-13 text-muted-foreground" data-testid="aidt-classification-empty">先记录本组提出的点子，再一起分类。</p> : <>
      <div className="space-y-3">{ideas.map((idea, index) => {
        const title = idea.title.trim() || `未命名点子${index + 1}`;
        return <article className="space-y-3 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0" key={idea.id} data-testid="aidt-classification-idea" data-idea-id={idea.id}>
          <h4 className="break-words text-13 font-medium">{title}</h4>
          <div className="flex flex-wrap gap-x-4 gap-y-2">{AIDT_IDEA_CATEGORIES.map((category) => <Checkbox key={category.id} label={category.label} aria-label={`${title} · ${category.label}`} checked={state.tags[idea.id]?.includes(category.id) ?? false} disabled={readOnly} onChange={(event) => change(setAidtIdeaCategory(draft, idea.id, category.id, event.currentTarget.checked))} />)}</div>
          <label className="block text-12 text-muted-foreground">为什么这样分类？<Textarea aria-label={`${title} · 分类理由`} rows={2} className="mt-1 min-h-16" value={state.reasons[idea.id] ?? ""} disabled={readOnly} maxLength={6000} placeholder="说明本组判断；暂不分类时也可记下不同意见。" onChange={(event) => change(setAidtIdeaClassificationReason(draft, idea.id, event.currentTarget.value))} /></label>
        </article>;
      })}</div>
      <details className="border-t border-border-subtle pt-3 text-12" data-testid="aidt-classification-board"><summary className="cursor-pointer font-medium">按三类比较点子</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-3">{AIDT_IDEA_CATEGORIES.map((category) => {
          const members = ideas.filter((idea) => state.tags[idea.id]?.includes(category.id));
          return <section key={category.id} aria-label={`${category.label}分类`} className="rounded-md border border-border p-3"><h4 className="font-medium">{category.label}</h4>{members.length ? <ul className="mt-2 space-y-1">{members.map((idea) => <li key={idea.id} className="break-words">{idea.title.trim() || "未命名点子"}</li>)}</ul> : <p className="mt-2 text-muted-foreground">暂无；无需填满每一类。</p>}</section>;
        })}</div>
      </details>
      <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" variant="outline" disabled={readOnly || !state.canConfirm || state.confirmed} onClick={() => change(confirmAidtIdeaClassification(draft))}>确认本组分类</Button><p className="text-12 text-muted-foreground">{state.canConfirm ? "确认分类后，仍由小组独立选择进入原型的点子。" : "已分类的点子先补充理由；草稿仍可通过本步成果保存。"}</p></div>
    </>}
  </section>;
}
