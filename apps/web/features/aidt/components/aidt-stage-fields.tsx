"use client";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { AIDT_OUTPUTS, type AidtUiStageDraft, type AidtDiscoveryCardDraft } from "@/features/aidt/lib/aidt-ui-drafts";

import { AidtProblemReflection } from "./aidt-problem-reflection";
import { AidtSurpriseReflection } from "./aidt-surprise-reflection";
import { AidtVerificationQuestion } from "./aidt-verification-question";
import { AidtTestReflection } from "./aidt-test-reflection";
import { AidtIterationPrototype } from "./aidt-iteration-prototype";
import { updateAidtIterationVersionText } from "../lib/aidt-prototype-reference";

const PRIMARY: Record<number, readonly string[]> = {
  1: ["initial", "people", "scene", "activity"],
  2: ["goal", "guide", "adoptedGuide"],
  3: ["personaBehavior", "insight", "hmw"],
  4: ["criteria", "reason"],
  5: ["idea", "type", "task"],
  6: ["version", "questions", "said", "did", "inference", "reflection"],
};
const MORE: Record<number, string> = { 1: "讨论后，重写本组主题", 2: "材料与研究反思", 3: "画像细节与证据", 4: "更多比较记录", 5: "使用情境与制作说明", 6: "修改方向与新版引用" };
export function AidtStageFields({ stageNumber, draft, onChange, onDraftChange, availableCards = [], availableCardsRevision, previousPrototype, previousPrototypeRevision, projectId, readOnly = false }: {
  stageNumber: number; draft: AidtUiStageDraft; onChange: (id: string, value: string) => void; readOnly?: boolean;
  onDraftChange?: (draft: AidtUiStageDraft) => void;
  availableCards?: readonly AidtDiscoveryCardDraft[]; availableCardsRevision?: number;
  previousPrototype?: AidtUiStageDraft; previousPrototypeRevision?: number;
  projectId?: string;
}): JSX.Element {
  const fields = AIDT_OUTPUTS[stageNumber]!.fields;
  // First-time students start with one thought. Existing content always remains reachable.
  const firstThought = stageNumber === 1 && !Object.values(draft.fields).some(value => typeof value === "string" && value.trim());
  const primary = fields.filter((field) => PRIMARY[stageNumber]!.includes(field.id) && (!firstThought || field.id === "initial"));
  const more = fields.filter((field) => !PRIMARY[stageNumber]!.includes(field.id));
  const renderField = (field: (typeof fields)[number]) => <label key={field.id} className={`block text-13 font-medium ${stageNumber === 1 && ["people", "scene"].includes(field.id) ? "" : "sm:col-span-2"}`}>
    {field.label}<Textarea id={`aidt-field-${stageNumber}-${field.id}`} aria-label={field.label} data-testid={`aidt-field-${field.id}`} data-field={field.id} rows={2} className="mt-2 min-h-20 font-normal" value={draft.fields[field.id] ?? ""} maxLength={6000} disabled={readOnly} onChange={(event) => {
      if (readOnly) return;
      if (stageNumber === 6 && field.id === "newVersion" && onDraftChange) onDraftChange(updateAidtIterationVersionText(draft, event.currentTarget.value));
      else onChange(field.id, event.currentTarget.value);
    }} placeholder={field.placeholder} />
  </label>;
  return <div className="space-y-5" data-testid="aidt-stage-fields" data-stage={stageNumber}>
    {onDraftChange && stageNumber === 3 && <AidtSurpriseReflection draft={draft} onChange={onDraftChange} availableCards={availableCards} availableCardsRevision={availableCardsRevision} readOnly={readOnly} />}
    {onDraftChange && stageNumber === 5 && <AidtVerificationQuestion draft={draft} onChange={onDraftChange} readOnly={readOnly} />}
    <div className="grid gap-4 sm:grid-cols-2" data-testid="aidt-primary-fields">{primary.map(field => <React.Fragment key={field.id}>{renderField(field)}{stageNumber === 1 && !firstThought && field.id === "initial" && onDraftChange && <div className="sm:col-span-2"><AidtProblemReflection draft={draft} onChange={onDraftChange} readOnly={readOnly} /></div>}</React.Fragment>)}</div>
    {onDraftChange && stageNumber === 6 && <AidtTestReflection draft={draft} onChange={onDraftChange} previousPrototype={previousPrototype} previousPrototypeRevision={previousPrototypeRevision} readOnly={readOnly} />}
    {more.length > 0 && !firstThought && <details className="border-t border-border-subtle pt-3" data-testid="aidt-more-fields" data-v5-disclosure="more-fields"><summary className="cursor-pointer text-13 font-medium">{MORE[stageNumber]}</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">{more.map(renderField)}</div>{stageNumber === 6 && projectId && onDraftChange && <div className="mt-4"><AidtIterationPrototype projectId={projectId} draft={draft} onChange={onDraftChange} readOnly={readOnly} /></div>}</details>}
  </div>;
}
