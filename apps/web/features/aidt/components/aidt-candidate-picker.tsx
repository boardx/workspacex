"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtCandidateAdopter, AidtCandidateController } from "../lib/use-aidt-candidate-request";

/** One explicit choice, then a local editable draft. Generation never silently replaces existing text. */
export function AidtCandidatePicker<T>({ title, actionLabel, controller, renderCandidate, onAdopt, hasExisting, batch, adoptLabel = "采用到草稿" }: {
  title: string; actionLabel: string; controller: AidtCandidateController<T>; renderCandidate: (candidate: T) => React.ReactNode;
  onAdopt?: AidtCandidateAdopter<T>; batch?: { limit: number; adopt: (indexes: readonly number[]) => Promise<boolean> }; hasExisting: boolean; adoptLabel?: string;
}) {
  const id = React.useId();
  const [selection, setSelection] = React.useState<{ candidates: readonly T[]; indexes: number[] }>();
  const indexes = selection?.candidates === controller.candidates ? selection.indexes : [];
  const [replace, setReplace] = React.useState(false);
  React.useEffect(() => setReplace(false), [controller.selectedIndex, controller.candidates]);
  return <section aria-label={title} className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-13 font-medium">{title}</h4><Button type="button" size="sm" variant="outline" disabled={!controller.canStart} onClick={() => void controller.start()}>{controller.pending ? "整理中…" : actionLabel}</Button></div>
    {controller.status && <p role="status" className="text-12 text-muted-foreground">{controller.status}</p>}
    {controller.candidates.length > 0 && <><p className="text-12 text-muted-foreground">AI 建议 · 待学生核对，不是原话或已验证事实</p><fieldset className="space-y-2" disabled={controller.busy}><legend className="sr-only">{batch ? "勾选点子候选" : "选择一个候选"}</legend>{controller.candidates.map((candidate, index) => <label key={index} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-background p-3 text-13"><input type={batch ? "checkbox" : "radio"} name={id} className="mt-1"
        checked={batch ? indexes.includes(index) : controller.selectedIndex === index}
        disabled={!!batch && indexes.length >= batch.limit && !indexes.includes(index)}
        onChange={event => {
          if (!batch) { controller.choose(index); return; }
          setSelection({ candidates: controller.candidates, indexes: event.currentTarget.checked ? [...indexes, index] : indexes.filter(value => value !== index) });
        }} /><div className="min-w-0 flex-1">{renderCandidate(candidate)}</div></label>)}</fieldset>
      {hasExisting && <label className="flex items-start gap-2 text-12"><input type="checkbox" disabled={controller.busy} checked={replace} onChange={event => setReplace(event.currentTarget.checked)} /><span>我已对照已有内容，同意将选中的候选填入可编辑草稿</span></label>}
      <Button type="button" size="sm" disabled={(batch ? indexes.length === 0 : controller.selectedIndex === null) || controller.busy || hasExisting && !replace} onClick={() => { if (batch) void batch.adopt(indexes); else if (onAdopt) void controller.adopt(onAdopt); }}>{controller.busy ? "核对来源…" : batch && indexes.length ? `${adoptLabel}（${indexes.length}）` : adoptLabel}</Button></>}
    {controller.active && <Button type="button" size="sm" variant="ghost" disabled={controller.busy} onClick={controller.cancel}>保留原内容，取消</Button>}
  </section>;
}
