"use client";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { AIDT_OUTPUTS, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

const PRIMARY: Record<number, readonly string[]> = {
  1: ["initial", "people", "scene", "activity"],
  2: ["goal", "guide", "adoptedGuide"],
  3: ["personaBehavior", "insight", "hmw"],
  4: ["criteria", "reason"],
  5: ["idea", "hypothesis", "type", "task"],
  6: ["version", "questions", "said", "did", "inference", "reflection"],
};
const MORE: Record<number, string> = { 1: "讨论后，重写本组主题", 2: "材料与研究反思", 3: "画像细节与证据", 4: "更多比较记录", 5: "使用情境与制作说明", 6: "修改方向与新版引用" };
export function AidtStageFields({ stageNumber, draft, onChange, readOnly = false }: {
  stageNumber: number; draft: AidtUiStageDraft; onChange: (id: string, value: string) => void; readOnly?: boolean;
}): JSX.Element {
  const fields = AIDT_OUTPUTS[stageNumber]!.fields;
  const primary = fields.filter((field) => PRIMARY[stageNumber]!.includes(field.id));
  const more = fields.filter((field) => !PRIMARY[stageNumber]!.includes(field.id));
  const renderField = (field: (typeof fields)[number]) => <label key={field.id} className={`block text-13 font-medium ${stageNumber === 1 && ["people", "scene"].includes(field.id) ? "" : "sm:col-span-2"}`}>
    {field.label}<Textarea id={`aidt-field-${stageNumber}-${field.id}`} aria-label={field.label} data-testid={`aidt-field-${field.id}`} data-field={field.id} rows={2} className="mt-2 min-h-20 font-normal" value={draft.fields[field.id] ?? ""} maxLength={6000} disabled={readOnly} onChange={(event) => onChange(field.id, event.currentTarget.value)} placeholder={field.placeholder} />
  </label>;
  return <div className="space-y-5" data-testid="aidt-stage-fields" data-stage={stageNumber}>
    <div className="grid gap-4 sm:grid-cols-2" data-testid="aidt-primary-fields">{primary.map(renderField)}</div>
    {more.length > 0 && <details className="border-t border-border-subtle pt-3" data-testid="aidt-more-fields" data-v5-disclosure="more-fields"><summary className="cursor-pointer text-13 font-medium">{MORE[stageNumber]}</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">{more.map(renderField)}</div></details>}
  </div>;
}
