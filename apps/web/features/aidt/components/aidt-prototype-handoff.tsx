"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { listAidtStageHistory, type AidtSharedStage } from "../lib/live-aidt-stages";
import { aidtHref } from "../lib/project-aidt";
import { Textarea } from "@/components/ui/textarea";
import { confirmAidtVerificationQuestion, isVerificationQuestionConfirmed } from "../lib/aidt-verification-loop";
import { aidtPrototypeVersionLabel } from "../lib/aidt-prototype-label";
import { AidtVerificationQuestion } from "./aidt-verification-question";
import { AidtPrototypeVersionPicker } from "./aidt-prototype-version-picker";
import { readAidtPrototypeReference, updateAidtPrototypeReference } from "../lib/aidt-prototype-reference";
import { aidtPrototypeEntityHref } from "./aidt-prototype-directory";
import { AIDT_OUTPUTS, type AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import {
  aidtChosenPrototypeIdeas, aidtPrototypePreparationError, confirmAidtPrototypeHandoff,
  isAidtPrototypeHandoffConfirmed, pinAidtPrototypeInputs, readAidtPrototypeInputSelection,
  resolveAidtPrototypeInputIdeas, aidtPrototypeEntityDraftTooLarge, readAidtPrototypeEntityDraft, updateAidtPrototypeEntityDraft, readAidtPrototypeIdeaRevision,
  confirmAidtPrototypeEntityHandoff, readAidtConfirmedPrototypeHandoff, aidtAllActivePrototypeEntitiesConfirmed,
  AIDT_PROTOTYPE_DISCUSSION_FIELDS, readAidtPrototypeDiscussionProposal, readAidtSavedPrototypeDiscussion,
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

function useAidtPrototypeIdeas({ workflow, projectId, draft, ideaRevision }: Pick<Props, "workflow" | "projectId" | "draft" | "ideaRevision">) {
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
  return { selection, sessionToken, revision, latest, historical, ideas, adoptionSource, adoptionIdeas, retry: () => { setHistory(undefined); setRetry(value => value + 1); } };
}

export function AidtPrototypeInputs({ workflow, projectId, draft, update, readOnly, ideaRevision }: Props) {
  const { selection, sessionToken, revision, latest, historical, ideas, adoptionSource, adoptionIdeas, retry } = useAidtPrototypeIdeas({ workflow, projectId, draft, ideaRevision });
  return <section className="space-y-2 rounded-lg border border-border p-3 text-12" data-testid="aidt-prototype-ideas">
    <h4 className="text-14 font-semibold">本轮入选点子</h4>
    {revision ? <p>{selection ? "固定引用" : "待核对"}第 4 步 V{revision}{latest && latest.revision !== revision ? ` · 已有 V${latest.revision}` : ""}</p> : <p>核对第 4 步已确认的点子，将它们组合为本轮原型。</p>}
    {ideas.length > 0 ? <ul className="space-y-2">{ideas.map(idea => <li key={idea.id}><details><summary className="cursor-pointer font-medium">{idea.title}</summary><p className="mt-1 whitespace-pre-wrap">{idea.description}</p></details></li>)}</ul> : revision ? <>
      <p role="status">{historical || revision === latest?.revision || !sessionToken ? "无法核对固定的点子版本。" : "正在读取固定的点子版本…"}</p>
      {historical && <Button type="button" variant="outline" size="sm" onClick={retry}>重新读取点子</Button>}
    </> : <Link className="text-primary underline" href={aidtHref(projectId, 4, { tool: "outcome" })}>返回第 4 步确认点子</Link>}
    {!readOnly && adoptionSource && adoptionIdeas.length > 0 && selection?.revision !== adoptionSource.revision && <Button type="button" variant="outline" size="sm" onClick={() => {
      update(previous => pinAidtPrototypeInputs(previous, adoptionSource));
    }}>采用第 4 步 V{adoptionSource.revision} 的 {adoptionIdeas.length} 个点子</Button>}
  </section>;
}

function AidtPrototypeConfirmation({ workflow, projectId, designId, draft, readOnly, selected, onConfirm }: Props & { selected: boolean; onConfirm: () => void }) {
  const selection = readAidtPrototypeInputSelection(draft);
  const saved = workflow.savedPrototype;
  const generationError = aidtPrototypePreparationError(draft)
    ?? (!selection ? "请先采用第 4 步已确认的点子。" : null)
    ?? (!saved || !workflow.matchesServer ? "请先将制作说明保存到小组。" : null);
  const confirmed = isAidtPrototypeHandoffConfirmed(draft);
  const savedDraft = saved?.projectId === projectId ? readAidtPrototypeEntityDraft(saved.content.draft, designId) : null;
  const ready = selected && confirmed && workflow.matchesServer && saved && savedDraft && isAidtPrototypeHandoffConfirmed(savedDraft)
    && readAidtConfirmedPrototypeHandoff(saved.content.draft)?.id === designId;
  return <section className="space-y-2 text-12" data-testid="aidt-prototype-confirmation">
    {generationError || readOnly ? <Button variant="outline" disabled>打开原生 Design Workbench</Button> : <Button asChild variant="outline"><Link href={aidtPrototypeEntityHref(projectId, designId, "design")}>打开原生 Design Workbench</Link></Button>}
    {generationError && <p role="status">{generationError}</p>}
    {!readOnly && <Button type="button" disabled={(confirmed && selected) || !selection || !confirmAidtPrototypeHandoff(draft)} onClick={onConfirm}>确认所选原型</Button>}
    {confirmed && <p role="status">{ready ? `原型已确认 · 第 5 步 V${saved.revision} · 待测试` : selected ? "原型已在本页确认。请保存到小组后再交接。" : "候选已有确认记录。选择后确认，作为本轮测试原型。"}</p>}
    {ready && <Button asChild><Link href={`${aidtHref(projectId, 6)}&${new URLSearchParams({ prototypeRevision: String(saved.revision), prototypeEntity: designId })}`}>带入测试与迭代</Link></Button>}
  </section>;
}

export type AidtPrototypeEntityProps = Omit<Props, "draft"> & { stageDraft: AidtUiStageDraft };

export function AidtPrototypeEntityOutput({ stageDraft, presentationOnly, ...props }: AidtPrototypeEntityProps & { presentationOnly?: boolean }) {
  const { projectId, designId, workflow, readOnly, update } = props;
  const draft = readAidtPrototypeEntityDraft(stageDraft, designId) ?? { fields: {}, ideas: [], selectedIdeaId: "" };
  const entity = {
    ...props,
    draft,
    update: (change: (previous: AidtUiStageDraft) => AidtUiStageDraft) => {
      if (!readOnly) update(previous => updateAidtPrototypeEntityDraft(previous, designId, change));
    },
  };
  if (presentationOnly) return <PrototypeArtifact {...entity} stageDraft={stageDraft} />;
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
    <AidtPrototypeConfirmation {...entity} workflow={workflow} selected={readAidtConfirmedPrototypeHandoff(stageDraft)?.id === designId} onConfirm={() => {
      if (!readOnly) update(previous => confirmAidtPrototypeEntityHandoff(previous, designId));
    }} />
  </section>;
}


function PrototypeArtifact({ draft, designId, projectId, ideaRevision, workflow, stageDraft }: Props & { stageDraft: AidtUiStageDraft }) {
  const reference = readAidtPrototypeReference(draft);
  const confirmed = isAidtPrototypeHandoffConfirmed(draft);
  const proposal = readAidtSavedPrototypeDiscussion(draft);
  const selected = readAidtConfirmedPrototypeHandoff(stageDraft)?.id === designId;
  const ready = Boolean(workflow.matchesServer && workflow.savedPrototype && selected && aidtAllActivePrototypeEntitiesConfirmed(stageDraft));
  const canOpen = !aidtPrototypePreparationError(draft) && !!readAidtPrototypeInputSelection(draft) && workflow.matchesServer;
  return <section data-testid="aidt-prototype-entity-output" aria-label="当前原型产物" className="space-y-4">
    <div className="flex items-center justify-between gap-2"><h3 className="text-16 font-semibold">原型产物</h3><span className="text-12 text-muted-foreground">{confirmed && workflow.matchesServer ? "已确认" : "未完成"}</span></div>
    <AidtPrototypeInputs workflow={workflow} projectId={projectId} designId={designId} ideaRevision={ideaRevision} draft={draft} readOnly update={() => undefined} />
    {Object.entries(AIDT_PROTOTYPE_DISCUSSION_FIELDS).map(([key, label]) => {
      const value = proposal?.[key as keyof typeof proposal] ?? draft.fields[key];
      return value ? <div key={key}><h4 className="text-12 font-semibold">{label}</h4><p className="whitespace-pre-wrap break-words text-13">{value}</p></div> : null;
    })}
    {reference && <p className="text-13" data-testid="aidt-prototype-recorded-reference">{aidtPrototypeVersionLabel(reference)}</p>}
    {canOpen && <Button asChild variant="outline"><Link href={aidtPrototypeEntityHref(projectId, designId, "design", ideaRevision)}>打开 Design 工作台</Link></Button>}
    {ready && <Button asChild variant="primary"><Link href={`${aidtHref(projectId, 6)}&${new URLSearchParams({ prototypeRevision: String(workflow.savedPrototype!.revision), prototypeEntity: designId })}`}>进入测试与迭代</Link></Button>}
  </section>;
}

type PrototypeTurn = { id: string; role: string; content?: unknown };

/** Native inline Chat actions; the Inspector only projects the current artifact. */
export function AidtPrototypeConversation({ messages, loading, running, requestSave, ...props }: AidtPrototypeEntityProps & {
  messages: readonly PrototypeTurn[];
  loading: boolean;
  running: boolean;
  requestSave: () => void;
}) {
  const { stageDraft, designId, workflow, projectId, readOnly, update } = props;
  const draft = readAidtPrototypeEntityDraft(stageDraft, designId) ?? { fields: {}, ideas: [], selectedIdeaId: "" };
  const proposal = readAidtPrototypeDiscussionProposal(messages);
  const serialized = proposal ? JSON.stringify(proposal) : "";
  const storedProposal = draft.fields.prototypeDiscussionProposal ?? "";
  const archived = draft.fields.prototypeArchived === "true";
  const lastProjected = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (readOnly || archived || loading || running || !serialized || lastProjected.current === serialized) return;
    lastProjected.current = serialized;
    if (serialized === storedProposal) return;
    update(previous => updateAidtPrototypeEntityDraft(previous, designId, current => ({
      ...current, fields: { ...current.fields, prototypeDiscussionProposal: serialized },
    })));
  }, [archived, designId, loading, readOnly, running, serialized, storedProposal, update]);

  const { selection, adoptionSource: ideaSource, adoptionIdeas } = useAidtPrototypeIdeas({ workflow, projectId, draft, ideaRevision: props.ideaRevision });
  const pending = readAidtSavedPrototypeDiscussion(draft);
  const confirmed = isAidtPrototypeHandoffConfirmed(draft);
  const ready = !aidtPrototypePreparationError(draft) && !!selection;
  const pendingMatches = pending && Object.entries(pending).every(([key, value]) => draft.fields[key] === value);
  const saveEntity = (change: (previous: AidtUiStageDraft) => AidtUiStageDraft) => {
    update(previous => updateAidtPrototypeEntityDraft(previous, designId, change));
    requestSave();
  };
  if (readOnly || archived || loading || running) return null;
  return <section aria-label="原型对话操作" className="space-y-3 rounded-container border border-border bg-card p-4 text-13">
    {!selection && ideaSource && adoptionIdeas.length > 0 && <Button type="button" variant="outline" onClick={() => saveEntity(current => pinAidtPrototypeInputs(current, ideaSource))}>采用入选点子</Button>}
    {pending && (!pendingMatches || !isVerificationQuestionConfirmed(draft)) && <Button type="button" variant="primary" onClick={() => saveEntity(current => {
      const next = { ...current, fields: { ...current.fields, ...pending } };
      return confirmAidtVerificationQuestion(next) ?? next;
    })}>确认原型草稿</Button>}
    {ready && workflow.matchesServer && <Button asChild variant="outline"><Link href={aidtPrototypeEntityHref(projectId, designId, "design", props.ideaRevision)}>打开 Design 工作台</Link></Button>}
    {ready && <AidtPrototypeVersionPicker projectId={projectId} designEntityId={designId} value={readAidtPrototypeReference(draft)}
      onChange={reference => { if (!reference || reference.designId === designId) saveEntity(current => updateAidtPrototypeReference(current, reference)); }} />}
    {!confirmed && Boolean(confirmAidtPrototypeHandoff(draft)) && <Button type="button" variant="primary" onClick={() => {
      update(previous => confirmAidtPrototypeEntityHandoff(previous, designId));
      requestSave();
    }}>确认本原型</Button>}
    {confirmed && workflow.matchesServer && !aidtAllActivePrototypeEntitiesConfirmed(stageDraft) && <p role="status">该原型已确认。还有其他原型待确认。</p>}
  </section>;
}
