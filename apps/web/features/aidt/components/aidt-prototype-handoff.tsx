"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { listAidtStageHistory, type AidtSharedStage } from "../lib/live-aidt-stages";
import { aidtHref } from "../lib/project-aidt";
import { Textarea } from "@/components/ui/textarea";
import { AidtVerificationQuestion } from "./aidt-verification-question";
import { AidtPrototypeVersionPicker } from "./aidt-prototype-version-picker";
import { readAidtPrototypeReference, updateAidtPrototypeReference } from "../lib/aidt-prototype-reference";
import { aidtPrototypeEntityHref } from "./aidt-prototype-directory";
import { AIDT_OUTPUTS, type AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import {
  aidtChosenPrototypeIdeas, aidtPrototypePreparationError, confirmAidtPrototypeHandoff,
  isAidtPrototypeHandoffConfirmed, pinAidtPrototypeInputs, readAidtPrototypeInputSelection,
  resolveAidtPrototypeInputIdeas, aidtPrototypeEntityDraftTooLarge, readAidtPrototypeEntityDraft, updateAidtPrototypeEntityDraft, readAidtPrototypeIdeaRevision,
} from "../lib/aidt-prototype-handoff";

export type AidtPrototypeWorkflow = {
  ideas?: AidtSharedStage;
  savedPrototype?: AidtSharedStage;
  matchesServer: boolean;
};

type Props = {
  workflow: AidtPrototypeWorkflow;
  projectId: string;
  designId: string;
  ideaRevision?: string | null;
  draft: AidtUiStageDraft;
  update: (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean;
};

export function AidtPrototypeInputs({ workflow, projectId, draft, update, readOnly, ideaRevision }: Props) {
  const selection = readAidtPrototypeInputSelection(draft);
  const latest = workflow.ideas?.projectId === projectId ? workflow.ideas : undefined;
  const revision = selection?.revision ?? readAidtPrototypeIdeaRevision(ideaRevision);
  const sessionToken = useOptionalSession()?.session?.sessionToken;
  const historyScope = JSON.stringify([projectId, revision, sessionToken]);
  const [history, setHistory] = React.useState<{ scope: string; stage?: AidtSharedStage }>();
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (!revision || revision === latest?.revision || !sessionToken) return;
    const controller = new AbortController();
    void listAidtStageHistory(projectId, 4, sessionToken, { beforeRevision: revision + 1, limit: 1 }, controller.signal).then(result => {
      if (!controller.signal.aborted) setHistory({ scope: historyScope, stage: result.items.find(stage => stage.revision === revision) });
    }).catch(() => { if (!controller.signal.aborted) setHistory({ scope: historyScope }); });
    return () => controller.abort();
  }, [historyScope, latest?.revision, projectId, revision, retry, sessionToken]);

  const historical = history?.scope === historyScope ? history : undefined;
  const source = !revision || revision === latest?.revision ? latest : historical?.stage;
  const ideas = selection ? resolveAidtPrototypeInputIdeas(selection, source) : aidtChosenPrototypeIdeas(source);
  const adoptionSource = selection ? latest : source;
  const adoptionIdeas = aidtChosenPrototypeIdeas(adoptionSource);
  return <section className="space-y-2 rounded-lg border border-border p-3 text-12" data-testid="aidt-prototype-ideas">
    <h4 className="text-14 font-semibold">本轮入选点子</h4>
    {revision ? <p>{selection ? "固定引用" : "待核对"}第 4 步 V{revision}{latest && latest.revision !== revision ? ` · 已有 V${latest.revision}` : ""}</p> : <p>核对第 4 步已确认的点子，将它们组合为本轮原型。</p>}
    {ideas.length > 0 ? <ul className="space-y-2">{ideas.map(idea => <li key={idea.id}><details><summary className="cursor-pointer font-medium">{idea.title}</summary><p className="mt-1 whitespace-pre-wrap">{idea.description}</p></details></li>)}</ul> : revision ? <>
      <p role="status">{historical || revision === latest?.revision || !sessionToken ? "无法核对固定的点子版本。" : "正在读取固定的点子版本…"}</p>
      {historical && <Button type="button" variant="outline" size="sm" onClick={() => { setHistory(undefined); setRetry(value => value + 1); }}>重新读取点子</Button>}
    </> : <Link className="text-primary underline" href={aidtHref(projectId, 4, { tool: "outcome" })}>返回第 4 步确认点子</Link>}
    {!readOnly && adoptionSource && adoptionIdeas.length > 0 && selection?.revision !== adoptionSource.revision && <Button type="button" variant="outline" size="sm" onClick={() => {
      update(previous => pinAidtPrototypeInputs(previous, adoptionSource));
    }}>采用第 4 步 V{adoptionSource.revision} 的 {adoptionIdeas.length} 个点子</Button>}
  </section>;
}

function AidtPrototypeConfirmation({ workflow, projectId, designId, draft, update, readOnly }: Props) {
  const selection = readAidtPrototypeInputSelection(draft);
  const saved = workflow.savedPrototype;
  const generationError = aidtPrototypePreparationError(draft)
    ?? (!selection ? "请先采用第 4 步已确认的点子。" : null)
    ?? (!saved || !workflow.matchesServer ? "请先将制作说明保存到小组。" : null);
  const confirmed = isAidtPrototypeHandoffConfirmed(draft);
  const savedDraft = saved?.projectId === projectId ? readAidtPrototypeEntityDraft(saved.content.draft, designId) : null;
  const ready = confirmed && workflow.matchesServer && saved && savedDraft && isAidtPrototypeHandoffConfirmed(savedDraft);
  return <section className="space-y-2 text-12" data-testid="aidt-prototype-confirmation">
    {generationError || readOnly ? <Button variant="outline" disabled>打开原生 Design Workbench</Button> : <Button asChild variant="outline"><Link href={aidtPrototypeEntityHref(projectId, designId, "design")}>打开原生 Design Workbench</Link></Button>}
    {generationError && <p role="status">{generationError}</p>}
    {!readOnly && <Button type="button" disabled={confirmed || !selection || !confirmAidtPrototypeHandoff(draft)} onClick={() => update(previous => confirmAidtPrototypeHandoff(previous) ?? previous)}>确认所选原型</Button>}
    {confirmed && <p role="status">{ready ? `原型已确认 · 第 5 步 V${saved.revision} · 待测试` : "原型已在本页确认。请保存到小组后再交接。"}</p>}
    {ready && <Button asChild><Link href={`${aidtHref(projectId, 6)}&${new URLSearchParams({ prototypeRevision: String(saved.revision), prototypeEntity: designId })}`}>带入测试与迭代</Link></Button>}
  </section>;
}

export function AidtPrototypeEntityOutput({ stageDraft, ...props }: Omit<Props, "draft"> & { stageDraft: AidtUiStageDraft }) {
  const { projectId, designId, workflow, readOnly, update } = props;
  const draft = readAidtPrototypeEntityDraft(stageDraft, designId) ?? { fields: {}, ideas: [], selectedIdeaId: "" };
  const entity = {
    ...props,
    draft,
    update: (change: (previous: AidtUiStageDraft) => AidtUiStageDraft) => {
      if (!readOnly) update(previous => updateAidtPrototypeEntityDraft(previous, designId, change));
    },
  };
  const fields = AIDT_OUTPUTS[5]!.fields.filter(field => !["idea", "hypothesis", "version"].includes(field.id));
  return <section className="space-y-4" data-testid="aidt-prototype-entity-output">
    <AidtPrototypeInputs {...entity} />
    <AidtVerificationQuestion draft={draft} readOnly={readOnly} onChange={next => entity.update(() => next)} />
    <fieldset className="space-y-3" disabled={readOnly}>
      <legend className="text-14 font-semibold">原型制作说明</legend>
      {fields.map(field => <label key={field.id} className="block space-y-1 text-12">{field.label}
        <Textarea value={draft.fields[field.id] ?? ""} maxLength={600} placeholder={field.placeholder} onChange={event => {
          const value = event.currentTarget.value;
          entity.update(previous => ({ ...previous, fields: { ...previous.fields, [field.id]: value } }));
        }} />
      </label>)}
    </fieldset>
    {aidtPrototypeEntityDraftTooLarge(stageDraft, designId) && <p role="alert" className="text-12">本原型的记录超出单项保存上限，请精简内容后保存。</p>}
    <AidtPrototypeVersionPicker projectId={projectId} designEntityId={designId} readOnly={readOnly} value={readAidtPrototypeReference(draft)} selectionScope={JSON.stringify([draft.fields.verificationQuestionConfirmation, draft.fields.prototypeIdeaSource])} onChange={reference => {
      if (!reference || reference.designId === designId) entity.update(previous => updateAidtPrototypeReference(previous, reference));
    }} />
    <AidtPrototypeConfirmation {...entity} workflow={workflow} />
  </section>;
}
