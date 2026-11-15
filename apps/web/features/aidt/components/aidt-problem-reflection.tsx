"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { PROBLEM_SOURCE_OPTIONS, isProblemReflectionConfirmed, problemReflectionMissingFields, readProblemSources, type ProblemSource } from "@/features/aidt/lib/aidt-problem-reflection";

/** Student-owned working reflection; confirmation does not claim a server save or verified evidence. */
export function AidtProblemReflection({ draft, onChange, readOnly = false }: {
  draft: AidtUiStageDraft;
  onChange: (nextDraft: AidtUiStageDraft) => void;
  readOnly?: boolean;
}): JSX.Element {
  const headingId = React.useId(), sourceHelpId = React.useId(), statusId = React.useId();
  const fields = draft.fields;
  const sources = readProblemSources(fields.problemSources);
  const missing = problemReflectionMissingFields(draft);
  const ready = missing.length === 0;
  const confirmed = isProblemReflectionConfirmed(draft);
  const edit = (changes: Record<string, string>): void => {
    if (readOnly) return;
    onChange({ ...draft, fields: { ...fields, ...changes, problemReflectionConfirmed: "" } });
  };
  const toggleSource = (source: ProblemSource, checked: boolean): void => {
    const selected = PROBLEM_SOURCE_OPTIONS.filter((option) => option.value === source ? checked : sources.selected.includes(option.value)).map((option) => option.value);
    edit({ problemSources: JSON.stringify(selected) });
  };
  return <section aria-labelledby={headingId} className="space-y-4 border-t border-border-subtle pt-4" data-testid="aidt-problem-reflection">
    <div className="space-y-1">
      <h3 id={headingId} className="text-14 font-semibold">先说清：为什么值得研究？</h3>
      <p className="text-12 text-muted-foreground">观察、抱怨和猜测都可作为起点；确认选题依据，不代表问题已被证实。</p>
    </div>
    {!fields.initial?.trim() && <p role="status" className="text-12 text-muted-foreground" data-testid="aidt-problem-reflection-initial-missing">先在原始命题中写下你关心的问题。</p>}
    <label className="block text-13 font-medium">
      为什么这是一个值得研究的问题？
      <Textarea className="mt-2 font-normal" rows={2} maxLength={6000} disabled={readOnly} value={fields.whyWorthStudying ?? ""}
        data-testid="aidt-problem-reflection-why" placeholder="可能影响谁、怎样影响？暂时说不清也可以直接写下来。"
        onChange={(event) => edit({ whyWorthStudying: event.currentTarget.value })} />
    </label>
    <fieldset className="space-y-2" aria-describedby={sourceHelpId}>
      <legend className="text-13 font-medium">问题来自观察、听到抱怨，还是某种猜测？</legend>
      <p id={sourceHelpId} className="text-12 text-muted-foreground">可多选；记录听到的说法与自己的推测，留待访谈核实。</p>
      <div className="flex flex-wrap gap-x-5 gap-y-3" data-testid="aidt-problem-reflection-sources">
        {PROBLEM_SOURCE_OPTIONS.map((option) => <Checkbox key={option.value} label={option.label} disabled={readOnly}
          checked={sources.selected.includes(option.value)} data-testid={`aidt-problem-source-${option.value}`}
          onChange={(event) => toggleSource(option.value, event.currentTarget.checked)} />)}
      </div>
      {sources.invalid && <p role="alert" className="text-12 text-destructive" data-testid="aidt-problem-reflection-source-error">请重新核对问题来源；已有理由与说明仍保留。</p>}
    </fieldset>
    <label className="block text-13 font-medium">
      来源的具体描述
      <Textarea className="mt-2 font-normal" rows={2} maxLength={6000} disabled={readOnly} value={fields.sourceDetails ?? ""}
        data-testid="aidt-problem-reflection-details" placeholder="发生了什么、听到了什么，或为什么会这样猜？目前不清楚就如实填写，不补造事件或原话。"
        onChange={(event) => edit({ sourceDetails: event.currentTarget.value })} />
    </label>
    <label className="block text-13 font-medium">
      还有哪些不确定？（可选）
      <Textarea className="mt-2 font-normal" rows={2} maxLength={6000} disabled={readOnly} value={fields.sourceUncertainty ?? ""}
        data-testid="aidt-problem-reflection-uncertainty" placeholder="哪些原因、影响或人群差异还需要了解？"
        onChange={(event) => edit({ sourceUncertainty: event.currentTarget.value })} />
    </label>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" disabled={readOnly || !ready || confirmed} aria-describedby={statusId}
        data-testid="aidt-problem-reflection-confirm" onClick={() => {
          if (!readOnly && ready && !confirmed) onChange({ ...draft, fields: { ...fields, problemReflectionConfirmed: "true" } });
        }}>确认本组的理由与来源</Button>
      <p id={statusId} role="status" aria-live="polite" className="text-12 text-muted-foreground" data-testid="aidt-problem-reflection-status">
        {confirmed ? "本组编辑者已确认 · 尚待研究核实" : missing.length ? `待补充：${missing.join("、")}。可先保存草稿。` : "核对理由与来源后，由本组编辑者确认。"}
      </p>
    </div>
  </section>;
}
