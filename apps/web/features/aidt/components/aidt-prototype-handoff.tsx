"use client";
import { AidtSavedTextPrint } from "./aidt-saved-text-print";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AIDT_BRAINSTORM_METHODS } from "@repo/contracts/aidt-brainstorm";
import { AidtConfirmAction } from "./aidt-confirm-action";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { listAidtStageHistory, type AidtSharedStage } from "../lib/live-aidt-stages";
import { aidtHref } from "../lib/project-aidt";
import { Textarea } from "@/components/ui/textarea";
import { confirmAidtVerificationQuestion, isVerificationQuestionConfirmed } from "../lib/aidt-verification-loop";
import { aidtPrototypeVersionLabel } from "../lib/aidt-prototype-label";
import { AidtVerificationQuestion } from "./aidt-verification-question";
import { AidtPrototypeImage, AidtPrototypeImagePreview } from "./aidt-prototype-image";
import { AidtPrototypeVersionPicker } from "./aidt-prototype-version-picker";
import { AidtPrototypeTextDesign } from "./aidt-prototype-text-design";
import { AidtPrototypeTextBinding } from "./aidt-prototype-text-binding";
import { isAidtPrototypeTextConfirmed, readAidtPrototypeTextConfirmation, readAidtPrototypeTextOutputBinding, bindAidtPrototypeTextOutput, aidtPrototypeOutputMatchesText } from "../lib/aidt-prototype-text-state";
import { readAidtPrototypeReference, updateAidtPrototypeReference } from "../lib/aidt-prototype-reference";
import { aidtPrototypeEntityHref } from "./aidt-prototype-directory";
import { AIDT_OUTPUTS, type AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import {
  readAidtPrototypeIdeaRounds, aidtPrototypePreparationError, confirmAidtPrototypeHandoff,
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
  returnContext?: { revision: string; entityId: string };
  draft: AidtUiStageDraft;
  update: (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean;
};

export function useAidtPrototypeIdeas({ workflow, projectId, draft, ideaRevision }: Pick<Props, "workflow" | "projectId" | "draft" | "ideaRevision">) {
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
  const ideas = selection ? resolveAidtPrototypeInputIdeas(selection, source) : [];
  const adoptionSource = selection ? latest : source;
  const adoptionRounds = readAidtPrototypeIdeaRounds(adoptionSource);
  return { selection, sessionToken, revision, latest, historical, ideas, adoptionSource, adoptionRounds, retry: () => { setHistory(undefined); setRetry(value => value + 1); } };
}

function AidtPrototypeIdeaChooser({ source, readOnly, onAdopt }: { source: AidtSharedStage; readOnly: boolean;
  onAdopt: (source: AidtSharedStage, ids: string[], brainstormId: string) => void }) {
  const rounds = readAidtPrototypeIdeaRounds(source);
  const [roundId, setRoundId] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const round = rounds.find(value => value.stableId === roundId);
  const ids = selected.filter(id => round?.ideas.some(idea => idea.id === id));
  return <details className="space-y-2"><summary className="cursor-pointer font-medium">选择来源列表与点子</summary>
    <label className="block">已确认 Ideation 列表<select aria-label="已确认 Ideation 列表" className="mt-1 block w-full rounded-md border border-border bg-background p-2"
      value={round?.stableId ?? ""} disabled={readOnly} onChange={event => { setRoundId(event.target.value); setSelected([]); }}>
      <option value="">选择一个已确认列表</option>{rounds.map(value => <option key={value.stableId} value={value.stableId}>{value.title} · {AIDT_BRAINSTORM_METHODS[value.method]} · 第4步 V{source.revision}</option>)}
    </select></label>
    {round ? <><p className="text-muted-foreground">固定 HMW：第3步 V{round.source.revision} · {round.source.text}</p>
      <fieldset className="space-y-1"><legend>从该列表选择点子</legend>{round.ideas.map(idea => <label key={idea.id} className="flex items-start gap-2"><input type="checkbox"
        checked={ids.includes(idea.id)} disabled={readOnly} onChange={event => setSelected(event.target.checked ? [...ids, idea.id] : ids.filter(id => id !== idea.id))} />{idea.title}</label>)}</fieldset>
      <Button size="sm" variant="outline" disabled={readOnly || !ids.length} onClick={() => onAdopt(source, ids, round.stableId)}>采用所选列表点子</Button></>
      : <p className="text-muted-foreground">先选择一个已确认列表，再从其中选一项或多项；不拼接不同列表。</p>}
    {!rounds.length && <p role="status">暂无可用于新原型的独立确认列表，请先在第4步确认本轮成果。</p>}
  </details>;
}

export function AidtPrototypeInputs({ workflow, projectId, draft, update, readOnly, ideaRevision }: Props) {
  const { selection, sessionToken, revision, latest, historical, ideas, adoptionSource, retry } = useAidtPrototypeIdeas({ workflow, projectId, draft, ideaRevision });
  return <section className="space-y-2 rounded-lg border border-border p-3 text-12" data-testid="aidt-prototype-ideas">
    <h4 className="text-14 font-semibold">本轮入选点子</h4>
    {revision ? <p>{selection ? "固定引用" : "待核对"}第 4 步 V{revision}{latest && latest.revision !== revision ? ` · 已有 V${latest.revision}` : ""}</p> : <p>核对第 4 步已确认的点子，将它们组合为本轮原型。</p>}
    {selection?.brainstormId && <p><Link className="text-primary underline" href={`/aidt/${encodeURIComponent(projectId)}?${new URLSearchParams({ step: "4", entity: selection.brainstormId, entityRevision: String(selection.revision) })}`}>查看已确认来源列表</Link></p>}
    {ideas.length > 0 ? <ul className="space-y-2">{ideas.map(idea => <li key={idea.id}><details><summary className="cursor-pointer font-medium">{idea.title}</summary><p className="mt-1 whitespace-pre-wrap">{idea.description}</p></details></li>)}</ul> : revision ? <>
      <p role="status">{historical || revision === latest?.revision || !sessionToken ? "无法核对固定的点子版本。" : "正在读取固定的点子版本…"}</p>
      {historical && <Button type="button" variant="outline" size="sm" onClick={retry}>重新读取点子</Button>}
    </> : <Link className="text-primary underline" href={aidtHref(projectId, 4, { tool: "outcome" })}>返回第 4 步确认点子</Link>}
    {!readOnly && adoptionSource && <AidtPrototypeIdeaChooser key={adoptionSource.revision} source={adoptionSource} readOnly={readOnly}
      onAdopt={(stage, ids, roundId) => update(previous => pinAidtPrototypeInputs(previous, stage, ids, roundId))} />}
  </section>;
}

function AidtPrototypeConfirmation({ workflow, projectId, designId, draft, readOnly, selected, onConfirm, returnContext }: Props & { selected: boolean; onConfirm: () => void }) {
  const selection = readAidtPrototypeInputSelection(draft);
  const saved = workflow.savedPrototype;
  const generationError = (!isAidtPrototypeTextConfirmed(draft) ? "请先保存并确认本轮文字设计。" : null) ?? aidtPrototypePreparationError(draft)
    ?? (!selection ? "请先采用第 4 步已确认的点子。" : null)
    ?? (!selection?.brainstormId ? "请先明确选择一个已确认 Ideation 列表及本轮点子。" : null)
    ?? (!saved || !workflow.matchesServer ? "请先将制作说明保存到小组。" : null);
  const confirmed = isAidtPrototypeHandoffConfirmed(draft);
  const savedDraft = saved?.projectId === projectId ? readAidtPrototypeEntityDraft(saved.content.draft, designId) : null;
  const ready = selected && confirmed && workflow.matchesServer && saved && savedDraft && isAidtPrototypeHandoffConfirmed(savedDraft)
    && readAidtConfirmedPrototypeHandoff(saved.content.draft)?.id === designId;
  return <section className="space-y-2 text-12" data-testid="aidt-prototype-confirmation">
    {generationError || readOnly ? <Button variant="outline" disabled>打开原生 Design Workbench</Button> : <Button asChild variant="outline"><Link href={aidtPrototypeEntityHref(projectId, designId, "design", undefined, returnContext)}>打开原生 Design Workbench</Link></Button>}
    {generationError && <p role="status">{generationError}</p>}
    {!readOnly && <Button type="button" disabled={(confirmed && selected) || !isAidtPrototypeTextConfirmed(draft) || !selection?.brainstormId || !confirmAidtPrototypeHandoff(draft)} onClick={onConfirm}>确认所选原型</Button>}
    {readAidtPrototypeReference(draft) && !aidtPrototypeOutputMatchesText(draft, designId, readAidtPrototypeReference(draft)!.versionId)
      && <p role="status">当前原型版本尚未关联本轮已确认的文字设计，暂不能作为新的交接版本。</p>}
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
  if (presentationOnly) return <><PrototypeArtifact {...entity} /><AidtPrototypeTextDesign projectId={projectId} designId={designId} stageDraft={stageDraft}
    savedStage={workflow.savedPrototype} matchesServer={workflow.matchesServer} readOnly update={update} requestSave={() => undefined} /></>;
  const fields = AIDT_OUTPUTS[5]!.fields.filter(field => !["idea", "hypothesis", "version"].includes(field.id));
  return <section className="space-y-4" data-testid="aidt-prototype-entity-output">
    <AidtPrototypeInputs {...entity} />
    <AidtPrototypeTextDesign projectId={projectId} designId={designId} stageDraft={stageDraft} savedStage={workflow.savedPrototype}
      matchesServer={workflow.matchesServer} readOnly update={update} requestSave={() => undefined} />
    <AidtVerificationQuestion draft={draft} readOnly={readOnly} onChange={next => entity.update(() => next)} />
    <PrototypeQuestionPrint draft={draft} designId={designId} projectId={projectId} />
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
    <AidtPrototypeVersionPicker projectId={projectId} designEntityId={designId} readOnly={readOnly || !isAidtPrototypeTextConfirmed(draft)} value={readAidtPrototypeReference(draft)} selectionScope={JSON.stringify([draft.fields.verificationQuestionConfirmation, draft.fields.prototypeIdeaSource, draft.fields.prototypeTextConfirmation])} onChange={reference => {
      if (!reference || reference.designId === designId) entity.update(previous => updateAidtPrototypeReference(previous, reference));
    }} />
    <AidtPrototypeConfirmation {...entity} workflow={workflow} selected={readAidtConfirmedPrototypeHandoff(stageDraft)?.id === designId} onConfirm={() => {
      if (!readOnly) update(previous => confirmAidtPrototypeEntityHandoff(previous, designId));
    }} />
    <AidtPrototypeTextBinding projectId={projectId} designId={designId} draft={draft} matchesServer={workflow.matchesServer} readOnly onBind={() => undefined} />
  </section>;
}


function PrototypeQuestionPrint({ draft, designId, projectId }: Pick<Props, "draft" | "designId" | "projectId">) {
  return <AidtSavedTextPrint projectId={projectId} artifactKey={designId} stageId={5} label="打印验证问题卡" draft={draft}
    selectSavedDraft={value => readAidtPrototypeEntityDraft(value, designId)} selectText={value => {
      if (!isVerificationQuestionConfirmed(value)) return null;
      const reference = readAidtPrototypeReference(value);
      return ["# 本轮验证问题", value.fields.verificationQuestion || "", `测试前看法：${value.fields.beforeTestBelief || "未记录"}`, `依据：${value.fields.verificationBasis || "未记录"}`,
        `本轮可验证与不可验证的范围：${value.fields.verificationLimits || "未记录"}`, `原型：${designId} / ${reference?.versionId || "尚未制作"}`, "状态：待测试。确认问题或完成原型不等于已验证。"].join("\n\n");
    }} />;
}

function PrototypeArtifact({ draft, designId, projectId, ideaRevision, workflow, returnContext }: Props) {
  const reference = readAidtPrototypeReference(draft);
  const confirmed = isAidtPrototypeHandoffConfirmed(draft);
  const proposal = readAidtSavedPrototypeDiscussion(draft);
  const canOpen = isAidtPrototypeTextConfirmed(draft) && !aidtPrototypePreparationError(draft) && !!readAidtPrototypeInputSelection(draft)?.brainstormId && workflow.matchesServer;
  const textOutput = readAidtPrototypeTextOutputBinding(draft);
  return <section data-testid="aidt-prototype-entity-output" aria-label="当前原型产物" className="space-y-4">
    <PrototypeQuestionPrint draft={draft} designId={designId} projectId={projectId} />
    <div className="flex items-center justify-between gap-2"><h3 className="text-16 font-semibold">原型产物</h3><span className="text-12 text-muted-foreground">{confirmed && workflow.matchesServer ? "已确认" : "未完成"}</span></div>
    {["verificationQuestion", "beforeTestBelief"].map(key => {
      const field = key as keyof typeof AIDT_PROTOTYPE_DISCUSSION_FIELDS;
      const value = proposal?.[field] ?? draft.fields[field];
      return value ? <div key={key}><h4 className="text-12 font-semibold">{AIDT_PROTOTYPE_DISCUSSION_FIELDS[field]}</h4><p className="whitespace-pre-wrap break-words text-13">{value}</p></div> : null;
    })}
    <details className="space-y-2 text-13"><summary className="cursor-pointer font-medium">设计说明与来源</summary>
      <AidtPrototypeInputs workflow={workflow} projectId={projectId} designId={designId} ideaRevision={ideaRevision} draft={draft} readOnly update={() => undefined} />
      {Object.entries(AIDT_PROTOTYPE_DISCUSSION_FIELDS).filter(([key]) => key !== "verificationQuestion" && key !== "beforeTestBelief").map(([key, label]) => {
        const value = proposal?.[key as keyof typeof proposal] ?? draft.fields[key];
        return value ? <div key={key}><h4 className="text-12 font-semibold">{label}</h4><p className="whitespace-pre-wrap break-words">{value}</p></div> : null;
      })}
    </details>
    {reference && <>
      <p className="text-13" data-testid="aidt-prototype-recorded-reference">{aidtPrototypeVersionLabel(reference)}</p>
      <AidtPrototypeImagePreview projectId={projectId} reference={reference} binding={textOutput?.versionId === reference.versionId ? textOutput : null} />
      {textOutput?.versionId === reference.versionId && <p className="text-12">此原型已记录文字设计依据 · 第 5 步 V{textOutput.textStageRevision}（学生／应用关联记录）。</p>}
    </>}
    <AidtPrototypeTextBinding projectId={projectId} designId={designId} draft={draft} matchesServer={workflow.matchesServer} readOnly onBind={() => undefined} />
    {canOpen && <Button asChild variant="outline"><Link href={aidtPrototypeEntityHref(projectId, designId, "design", ideaRevision, returnContext)}>打开 Design 工作台</Link></Button>}
  </section>;
}

type PrototypeTurn = { id: string; role: string; content?: unknown };

/** Native inline Chat actions; the Inspector only projects the current artifact. */
export function AidtPrototypeConversation({ messages, loading, running, requestSave, savePending, ...props }: AidtPrototypeEntityProps & {
  messages: readonly PrototypeTurn[];
  loading: boolean;
  running: boolean;
  requestSave: () => void;
  savePending?: boolean;
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

  const { selection, ideas, adoptionSource: ideaSource } = useAidtPrototypeIdeas({ workflow, projectId, draft, ideaRevision: props.ideaRevision });
  const pending = readAidtSavedPrototypeDiscussion(draft);
  const confirmed = isAidtPrototypeHandoffConfirmed(draft);
  const preparationError = aidtPrototypePreparationError(draft);
  const ready = Boolean(selection && ideas.length === selection.ideaIds.length && !preparationError);
  const textConfirmation = readAidtPrototypeTextConfirmation(draft);
  const search = useSearchParams();
  const currentParams = new URLSearchParams(search?.toString());
  const viewingHistory = currentParams.has("textRevision");
  currentParams.delete("textRevision");
  const guidanceId = React.useId();
  const textId = guidanceId + "-text";
  const sourcesId = guidanceId + "-sources";
  const questionId = guidanceId + "-question";
  const versionId = guidanceId + "-version";
  const textReady = !!selection?.brainstormId && isAidtPrototypeTextConfirmed(draft) && !!textConfirmation;
  const pendingMatches = pending && Object.entries(pending).every(([key, value]) => draft.fields[key] === value);
  const pendingDraft = pending && { ...draft, fields: { ...draft.fields, ...pending } };
  const canConfirmQuestion = Boolean(pendingDraft && pendingDraft.fields.beforeTestBelief?.trim()
    && pendingDraft.fields.verificationBasis?.trim() && confirmAidtVerificationQuestion(pendingDraft));
  const saveEntity = (change: (previous: AidtUiStageDraft) => AidtUiStageDraft) => {
    update(previous => updateAidtPrototypeEntityDraft(previous, designId, change));
    requestSave();
  };
  const savedText = workflow.savedPrototype
    ? readAidtPrototypeEntityDraft(workflow.savedPrototype.content.draft, designId)
    : null;
  const textSaved = !!savedText?.fields.prototypeTextLineage
    && savedText.fields.prototypeTextLineage === draft.fields.prototypeTextLineage
    && savedText.fields.prototypeTextDesign === draft.fields.prototypeTextDesign
    && savedText.fields.prototypeIdeaSource === draft.fields.prototypeIdeaSource;
  const blocker = viewingHistory
    ? { message: "你正在查看文字设计历史版本。请回到当前版本继续操作。", label: "编辑当前文字设计", target: textId }
    : !selection?.brainstormId
      ? ideaSource && readAidtPrototypeIdeaRounds(ideaSource).length
        ? { message: "本原型还未采用已确认的来源列表和点子。请选择点子并点击「采用所选列表点子」。", label: "去选择来源点子", target: sourcesId }
        : { message: "当前没有可用的已确认点子列表。请在第 4 步确认本轮头脑风暴成果。", label: "返回第 4 步「创意发散」", target: null }
      : !draft.fields.prototypeTextDesign?.trim()
        ? { message: "本轮文字设计还没有填写。请填写设计后保存并确认。", label: "去填写文字设计", target: textId }
        : !textSaved
          ? { message: "当前文字设计尚未按所选来源保存。请点击「保存文字设计」，再确认保存的版本。", label: "去保存文字设计", target: textId }
          : !textReady
            ? { message: "文字设计已保存，但当前版本还未确认。请点击「确认已保存文字设计」。", label: "去确认文字设计", target: textId }
            : !workflow.matchesServer
              ? { message: "本轮修改尚未收到小组保存回执。保存完成后再继续关联原型。", label: "去核对保存状态", target: textId }
              : !ready
                ? { message: preparationError ?? "当前所选点子的来源无法完整读取。请重新核对来源列表。", label: preparationError ? "去完善验证问题与制作说明" : "去核对来源点子", target: preparationError ? questionId : sourcesId }
                : !readAidtPrototypeReference(draft)?.generatedFrameCount
                  ? { message: "还没有选定有实际内容的原型版本。请先制作原型，再在「原型版本」中选择。", label: "去制作或选择原型版本", target: versionId }
                  : !confirmAidtPrototypeHandoff(draft)
                    ? { message: "所选版本尚未关联当前文字设计。先点「查看所选原型的确切版本」，核对后点「将此原型用于该确认设计稿」。", label: "去关联文字设计", target: versionId }
                    : null;
  if (archived || loading) return null;
  return <section aria-label="原型对话操作" className="space-y-3 rounded-container border border-border bg-card p-4 text-13">
    <div id={textId}><AidtPrototypeTextDesign projectId={projectId} designId={designId} stageDraft={stageDraft} savedStage={workflow.savedPrototype}
      matchesServer={workflow.matchesServer} readOnly={readOnly} update={update} requestSave={requestSave} messages={messages} loading={loading} running={running} savePending={savePending} /></div>
    {!readOnly && !running && <>
    {ideaSource && <div id={sourcesId}><AidtPrototypeIdeaChooser key={ideaSource.revision} source={ideaSource} readOnly={readOnly}
      onAdopt={(stage, ids, roundId) => saveEntity(current => pinAidtPrototypeInputs(current, stage, ids, roundId))} /></div>}
    {pending && (!pendingMatches || !isVerificationQuestionConfirmed(draft)) && <Button type="button" variant="primary" onClick={() => saveEntity(current => {
      const next = { ...current, fields: { ...current.fields, ...pending } };
      return canConfirmQuestion ? confirmAidtVerificationQuestion(next) ?? next : next;
    })}>{canConfirmQuestion ? "确认验证问题" : "保存原型草稿"}</Button>}
    {textReady && <details id={questionId} className="space-y-3">
      <summary className="cursor-pointer font-medium">验证问题与制作说明</summary>
      <AidtVerificationQuestion draft={draft} readOnly={readOnly} onChange={next => {
        update(previous => updateAidtPrototypeEntityDraft(previous, designId, () => next));
        if (isVerificationQuestionConfirmed(next)) requestSave();
      }} />
      <fieldset className="space-y-3">
        <legend>原型制作说明</legend>
        {AIDT_OUTPUTS[5]!.fields.filter(field => !["idea", "hypothesis", "version"].includes(field.id)).map(field => <label key={field.id} className="block space-y-1">{field.label}
          <Textarea value={draft.fields[field.id] ?? ""} maxLength={600} placeholder={field.placeholder} onChange={event => {
            const value = event.target.value;
            update(previous => updateAidtPrototypeEntityDraft(previous, designId, current => ({
              ...current, fields: { ...current.fields, [field.id]: value },
            })));
          }} />
        </label>)}
        <Button size="sm" variant="outline" onClick={requestSave}>保存验证问题与制作说明</Button>
      </fieldset>
    </details>}
    <div id={versionId}>
    {ready && textReady && workflow.matchesServer && <Button asChild variant="outline"><Link href={aidtPrototypeEntityHref(projectId, designId, "design", props.ideaRevision, props.returnContext)}>打开 Design 工作台</Link></Button>}
    {ready && textReady && textConfirmation && workflow.matchesServer && <AidtPrototypeImage key={JSON.stringify(textConfirmation)} projectId={projectId} designId={designId} textConfirmation={textConfirmation}
      onSaved={(reference, basis, metadata) => saveEntity(current => {
        const bound = bindAidtPrototypeTextOutput(current, projectId, designId, reference.versionId, basis, metadata);
        return bound === current ? current : updateAidtPrototypeReference(bound, reference);
      })} />}
    {ready && <AidtPrototypeVersionPicker projectId={projectId} designEntityId={designId} readOnly={!textReady} value={readAidtPrototypeReference(draft)} selectionScope={draft.fields.prototypeTextConfirmation}
      onChange={reference => { if (!reference || reference.designId === designId) saveEntity(current => updateAidtPrototypeReference(current, reference)); }} />}
    <AidtPrototypeTextBinding projectId={projectId} designId={designId} draft={draft} matchesServer={workflow.matchesServer} readOnly={readOnly} onBind={saveEntity} /></div>
    {(!confirmed || readAidtConfirmedPrototypeHandoff(stageDraft)?.id !== designId) && <section aria-label="原型确认进度" className="space-y-2 rounded-container border border-border p-3">
      <h3 className="font-medium">原型确认进度</h3>
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>来源点子 · {selection?.brainstormId ? "已采用" : "待采用"}</li>
        <li>文字设计 · {textReady && textSaved ? "已确认" : "待保存并确认"}</li>
        <li>验证问题与制作说明 · {ready ? "已就绪" : "待完善"}</li>
        <li>原型版本 · {readAidtPrototypeReference(draft)?.generatedFrameCount ? "已选择" : "待制作或选择"}</li>
        <li>制作依据 · {textReady && aidtPrototypeOutputMatchesText(draft, designId, readAidtPrototypeReference(draft)?.versionId ?? "") ? "已关联" : "待关联"}</li>
      </ol>
      {blocker ? <div className="rounded-md border border-border p-2">
        <p role="status">{blocker.message}</p>
        <Link className="mt-2 inline-block font-medium underline"
          href={viewingHistory ? `?${currentParams.toString()}#${textId}` : blocker.target ? `#${blocker.target}` : aidtHref(projectId, 4)}
          onClick={() => {
            const target = blocker.target ? document.getElementById(blocker.target) : null;
            const details = target instanceof HTMLDetailsElement ? target : target?.querySelector("details");
            if (details && (blocker.target === questionId || blocker.target === sourcesId)) details.open = true;
          }}>
          {blocker.label}
        </Link>
      </div> : <Button variant="primary" type="button" onClick={() => {
        update(previous => confirmAidtPrototypeEntityHandoff(previous, designId));
        requestSave();
      }}>{confirmed ? "选为测试原型" : "确认本原型"}</Button>}
    </section>}
    {confirmed && workflow.matchesServer && !aidtAllActivePrototypeEntitiesConfirmed(stageDraft) && <p role="status">该原型已确认。还有其他原型待确认。</p>}
    </>}
  </section>;
}
