"use client";

import { AidtCardSources, useAidtCreateTags } from "./aidt-card-create-fields";
import * as React from "react";
import { AidtEntityCard, AidtNewEntityCardButton } from "./aidt-entity-card";
import Link from "next/link";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtConfirmAction } from "./aidt-confirm-action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AIDT_DEFINITION_EVIDENCE_LIMIT, AIDT_DEFINITION_ITEM_LIMIT, AIDT_PRIMARY_SURPRISE_ID, addAidtDefinitionEntity, addAidtDefinitionSurprise, aidtDefinitionCardNameKey, aidtDefinitionCards,
  chooseAidtDefinitionHmw, confirmedAidtDefinitionSurprises, invalidateAidtDefinitionSurpriseLinks, isAidtDefinitionHmwReady,
  isAidtDefinitionPersonaReady, isAidtDefinitionSurpriseReady, readAidtDefinition,
  readAidtDefinitionEntities, readAidtDefinitionEvidenceRevision, readAidtDefinitionSelection,
  rebaseAidtDefinitionEvidence, saveAidtDefinitionHmw, saveAidtDefinitionPersona, saveAidtDefinitionSurprise,
  type AidtDefinitionHmw, type AidtDefinitionPersona, type AidtDefinitionSurprise,
} from "../lib/aidt-definition";
import { aidtAuthorizedDefinitionCards, loadAidtAuthorizedDefinitionEvidence, aidtDefinitionSyntheticCardIds, aidtSavedDefinitionSyntheticCardIds, AIDT_DEFINITION_SYNTHETIC_NOTICE } from "../lib/aidt-definition-current-evidence";
import { readAidtStage } from "../lib/live-aidt-stages";
import { listAidtStageHistory, type AidtSharedStage } from "../lib/live-aidt-stages";
import { isAidtSurpriseConfirmed, parseAidtSurpriseReflection } from "../lib/aidt-surprise-reflection";
import {
  aidtDefinitionChatMessageKey, aidtDefinitionEntityConfirmed, aidtDefinitionEntityKind, applyAidtDefinitionCandidate,
  confirmAidtDefinitionChatEntity, sameSavedAidtDefinitionChatEntity, enableAidtPrimarySurpriseEntity, hasAidtPrimarySurpriseEntity,
  latestAidtDefinitionCandidate, type AidtDefinitionTurn,
} from "../lib/aidt-definition-chat";
import { isAidtInterviewArchived, readAidtInterviews } from "../lib/aidt-interviews";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtSurpriseReflection } from "./aidt-surprise-reflection";
import { AidtResearchMaterialPreview } from "./aidt-research-material";
import { parseAidtResearchMaterial, researchMaterialKey } from "../lib/aidt-research-material-reference";
import { readAidtPersonaCanvas, type AidtPersonaCandidateHost } from "../lib/aidt-persona-candidates";
import { AidtPersonaCandidates } from "./aidt-persona-candidates";
import { AidtHmwCandidates } from "./aidt-hmw-candidates";
import { AidtPersonaCanvasPreview } from "./aidt-persona-canvas-preview";
import { useAidtDefinitionCandidateHost } from "../lib/use-aidt-definition-candidate-host";
import { AidtSavedTextPrint } from "./aidt-saved-text-print";
import { previewAidtText } from "../lib/aidt-print-preview";

export type AidtDefinitionProps = {
  projectId?: string;
  draft: AidtUiStageDraft;
  update: (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean;
  availableCards: readonly AidtDiscoveryCardDraft[];
  availableCardsRevision?: number;
  discoveryCardFields?: Readonly<Record<string, string>>;
  definitionRevision?: number;
};

function useDefinitionEvidence({ projectId, draft, availableCards, availableCardsRevision, discoveryCardFields }: AidtDefinitionProps) {
  const session = useOptionalSession()?.session;
  const pinnedRevision = readAidtDefinitionEvidenceRevision(draft.fields);
  const stale = pinnedRevision !== null && availableCardsRevision !== pinnedRevision;
  const token = session?.sessionToken;
  const key = JSON.stringify([projectId, session?.currentOrgId, session?.userId, token, pinnedRevision, stale]);
  const [attempt, retry] = React.useReducer(value => value + 1, 0);
  const [history, setHistory] = React.useState<{ key: string; attempt: number; stage: AidtSharedStage | null } | null>(null);
  React.useEffect(() => {
    if (!stale || pinnedRevision === null || !projectId || !token) return;
    const cancellation = new AbortController();
    void listAidtStageHistory(projectId, 2, token, { beforeRevision: pinnedRevision + 1, limit: 1 }, cancellation.signal).then(result => {
      if (cancellation.signal.aborted) return;
      const stage = result.items[0];
      setHistory({ key, attempt, stage: stage?.revision === pinnedRevision ? stage : null });
    }).catch(() => {
      if (!cancellation.signal.aborted) setHistory({ key, attempt, stage: null });
    });
    return () => cancellation.abort();
  }, [attempt, key, pinnedRevision, projectId, stale, token]);
  const [authorization, setAuthorization] = React.useState<{ key: string; stage: AidtSharedStage | null } | null>(null);
  React.useEffect(() => {
    if (!projectId || !token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const { stage } = await readAidtStage(projectId, 2, token, controller.signal);
        if (!controller.signal.aborted) setAuthorization({ key, stage });
      } catch { if (!controller.signal.aborted) setAuthorization({ key, stage: null }); }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 5000);
    };
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [projectId, token, key, attempt, availableCardsRevision, discoveryCardFields]);
  const currentHistory = stale && history?.key === key && history.attempt === attempt ? history : null;
  const historicalStage = currentHistory?.stage ?? null;
  const source = stale ? historicalStage?.content.draft : { fields: discoveryCardFields ?? {}, discoveryCards: availableCards };
  const revision = stale ? historicalStage?.revision : availableCardsRevision;
  const sources = source?.discoveryCards ?? [];
  const currentStage = authorization?.key === key ? authorization.stage : null;
  const authorized = !projectId || !token ? null : currentStage;
  const cards = projectId ? token ? aidtAuthorizedDefinitionCards(sources, source?.fields ?? {}, authorized?.content.draft.fields ?? {}) : []
    : aidtDefinitionCards(sources, source?.fields ?? {});
  const sourceFields: Record<string, string> = projectId && !token ? {} : { ...source?.fields };
  if (projectId && token) {
    const owners = new Map(readAidtInterviews(authorized?.content.draft.fields ?? {}).map(record => [record.id, record]));
    for (const card of cards) {
      if (owners.get(card.id)?.consent?.photos) continue;
      delete sourceFields[researchMaterialKey("photo", card.id)];
      const key = researchMaterialKey("source", card.id);
      if (parseAidtResearchMaterial(sourceFields[key])?.mime.startsWith("image/")) delete sourceFields[key];
    }
  }
  return {
    cards, revision, stale, pinnedRevision,
    syntheticCardIds: aidtDefinitionSyntheticCardIds(cards.map(card => card.id), sourceFields, authorized?.content.draft.fields ?? {}),
    unconfirmedCards: sources.length - cards.length,
    sourceFields,
    ready: isAidtSurpriseConfirmed(draft, cards, revision),
    unavailable: stale && !historicalStage || Boolean(projectId && (!token || !currentStage)),
    failed: currentHistory?.stage === null, retry,
  };
}

type DirectoryProps = AidtDefinitionProps & {
  entityHref: (id: string) => string;
  onCreate?: (id: string, change: (old: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
  nativeChat?: boolean;
  requestSave?: () => void;
  savedDraft?: AidtUiStageDraft;
  candidateHost?: AidtPersonaCandidateHost;
  candidateHref?: (kind: "persona" | "hmw") => string;
};

export function AidtDefinitionDirectory(props: DirectoryProps) {
  return props.nativeChat ? <AidtDefinitionCardDirectory {...props} /> : <LegacyDefinitionDirectory {...props} />;
}

function LegacyDefinitionDirectory(props: DirectoryProps) {
  const { projectId, draft, update, readOnly, availableCardsRevision, entityHref } = props;
  const { cards, revision, ready, stale, pinnedRevision, unavailable, failed, retry, unconfirmedCards, sourceFields } = useDefinitionEvidence(props);
  const { personas, hmws, surprises, invalid } = readAidtDefinition(draft.fields);
  const entities = readAidtDefinitionEntities(draft.fields);
  const selected = readAidtDefinitionSelection(draft.fields);
  const canRecord = ready && !readOnly && !unavailable && !invalid;
  const hasPrimaryFinding = draft.fields.surpriseStatus === "found";
  const add = (kind: "persona" | "hmw") => {
    const id = crypto.randomUUID();
    update(old => addAidtDefinitionEntity(old, kind, id));
  };
  return <section className="space-y-4" aria-label="综合与定义产物" data-testid="aidt-definition-directory">
    <AidtSurpriseReflection draft={draft} onChange={next => {
      const changed = Object.entries(next.fields).filter(([key, value]) => draft.fields[key] !== value);
      update(old => {
        const next = { ...old, fields: { ...old.fields, ...Object.fromEntries(changed) } };
        if (old.fields.surpriseConfirmed !== "true" || next.fields.surpriseConfirmed === "true") return next;
        return confirmedAidtDefinitionSurprises(old.fields).reduce((result, record) => invalidateAidtDefinitionSurpriseLinks(result, record.id), next);
      });
    }} availableCards={cards} availableCardsRevision={revision} readOnly={readOnly || unavailable} />
    {invalid && <p role="alert" className="text-13">部分产物格式无法读取。请在历史版本中核对，当前产物暂不可修改。</p>}
    {stale && <div className="space-y-2" role="status"><p className="text-13">本轮引用第 2 步 V{pinnedRevision}。{availableCardsRevision ? `第 2 步当前为 V${availableCardsRevision}。` : "当前材料暂不可读取。"}已保存的旧引用仍随历史版本保留。改用新版时，本轮须重新核对证据和 HMW。</p>{failed && <Button type="button" size="sm" variant="outline" onClick={retry}>重试读取原版本</Button>}{availableCardsRevision && <Button type="button" size="sm" variant="outline" disabled={readOnly || invalid} onClick={() => update(rebaseAidtDefinitionEvidence)}>以最新访谈重新核对引用</Button>}</div>}
    {(hasPrimaryFinding || surprises.length > 0) && <section className="space-y-2" aria-label="其他意外发现">
      <h3 className="text-14 font-semibold">其他意外发现</h3>
      {surprises.map(record => <DefinitionSurpriseRecord key={record.id} record={record} disabled={!canRecord || !hasPrimaryFinding}
        evidence={{ projectId, sourceFields, cards, revision, unconfirmedCards }}
        onEdit={patch => update(old => {
          const current = readAidtDefinition(old.fields).surprises.find(item => item.id === record.id);
          return current && !current.archived ? saveAidtDefinitionSurprise(old, { ...current, confirmed: false, ...patch }, revision ?? null) : old;
        })} />)}
      {hasPrimaryFinding && <Button type="button" size="sm" variant="outline" disabled={!canRecord || surprises.length >= AIDT_DEFINITION_ITEM_LIMIT} onClick={() => {
        const id = crypto.randomUUID();
        update(old => addAidtDefinitionSurprise(old, id));
      }}>记录另一条意外发现</Button>}
    </section>}
    <div className="space-y-2"><h3 className="text-16 font-semibold">用户画像与 HMW</h3>
      {entities.length ? <ul className="space-y-2">{entities.map(entity => <li key={entity.id} className="rounded-lg border border-border p-3 text-13"><span className="mr-2 text-muted-foreground">{entity.kind === "persona" ? "画像" : "HMW"}</span>{entity.archived ? <span>{entity.title} · 已归档</span> : <Link className="font-medium text-primary underline" href={entityHref(entity.id)}>{entity.title}</Link>}{selected?.id === entity.id && <span className="ml-2 text-muted-foreground">本轮选用</span>}</li>)}</ul> : <p className="text-13 text-muted-foreground">还没有画像或 HMW。记录并确认意外发现后可新建画像。</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={readOnly || !ready || unavailable || invalid || personas.length >= AIDT_DEFINITION_ITEM_LIMIT} onClick={() => add("persona")}>新建画像</Button><Button type="button" size="sm" variant="outline" disabled={readOnly || !ready || unavailable || invalid || !personas.some(persona => persona.confirmed && !persona.archived) || hmws.length >= AIDT_DEFINITION_ITEM_LIMIT} onClick={() => add("hmw")}>新建 HMW</Button></div>
      <p className="text-12 text-muted-foreground">新建的草稿使用「保存到小组」共享；每项有独立对话。归档会保留已保存的历史版本。</p>
    </div>
  </section>;
}

const kindLabels = { surprise: "意外发现", persona: "用户画像", hmw: "HMW" } as const;

function AidtDefinitionCardDirectory({ entityHref, requestSave, savedDraft, onCreate, candidateHost, candidateHref, ...props }: DirectoryProps) {
  const { draft, update, readOnly } = props;
  const evidence = useDefinitionEvidence(props);
  const { personas, hmws, surprises, invalid } = readAidtDefinition(draft.fields);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [choosingKind, setChoosingKind] = React.useState(false);
  const kindOptionsId = React.useId();
  const active = [
    ...(hasAidtPrimarySurpriseEntity(draft) || draft.fields.surpriseConfirmed === "true" ? [{ id: AIDT_PRIMARY_SURPRISE_ID, title: "意外发现", kind: "surprise" as const, archived: false }] : []),
    ...surprises.map(item => ({ id: item.id, title: item.observation.trim() || "未命名发现", kind: "surprise" as const, archived: item.archived })),
    ...readAidtDefinitionEntities(draft.fields),
  ];
  type CreateKind = "primary" | "surprise" | "persona" | "hmw";
  const labels = { primary: "意外发现", surprise: "补充发现", persona: "画像", hmw: "HMW" };
  const [kindToCreate, setKind] = React.useState<CreateKind | null>(null);
  const [newName, setNewName] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [selectedPersonas, setSelectedPersonas] = React.useState<string[]>([]);
  const [sourceRevision, setSourceRevision] = React.useState<number | undefined>();
  const tags = useAidtCreateTags(draft);
  const interviewOwners = new Set(readAidtInterviews(evidence.sourceFields).filter(item => !isAidtInterviewArchived(evidence.sourceFields, item.id)).map(item => item.id));
  const interviewCards = evidence.cards.filter(card => interviewOwners.has(card.id));
  const sourceChanged = kindToCreate !== null && sourceRevision !== evidence.revision;
  const evidenceOptions = evidence.cards.map(card => ({ id: card.id, title: card.participantCode + " · " + (card.headline || "人物发现") }));
  const personaOptions = personas.filter(item => item.confirmed && !item.archived).map(item => ({ id: item.id, title: draft.fields[aidtDefinitionCardNameKey(item.id)] || item.name }));
  const pending = React.useRef<{ kind: string; id: string } | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [createFailed, setCreateFailed] = React.useState(false);
  const canEdit = !readOnly && !invalid && !creating;
  const canAdd = canEdit && !evidence.unavailable && evidence.ready;
  const title = (id: string, fallback: string) => draft.fields[aidtDefinitionCardNameKey(id)] || fallback;
  const save = (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => { update(change); requestSave?.(); };
  const openAllowed = (id: string) => savedDraft ? Boolean(aidtDefinitionEntityKind(savedDraft, id)) : !requestSave;
  function start(kind: CreateKind) {
    tags.reset();
    setSelected([]);
    setSelectedPersonas([]);
    setNewName("");
    setSourceRevision(evidence.revision);
    setCreateFailed(false);
    pending.current = null;
    setKind(kind);
  }
  async function add(kind: CreateKind) {
    if (!canEdit || sourceChanged || !newName.trim()) return;
    if ((kind === "persona" || kind === "hmw") && (!evidence.revision || !selected.length)) return;
    if (kind === "hmw" && !selectedPersonas.length) return;
    if (pending.current?.kind !== kind) pending.current = { kind, id: kind === "primary" ? AIDT_PRIMARY_SURPRISE_ID : crypto.randomUUID() };
    const { id } = pending.current;
    const change = (old: AidtUiStageDraft) => {
      if (kind === "persona" || kind === "hmw") {
        if (!evidence.revision) return old;
        const next = addAidtDefinitionEntity(old, kind, id, {
          name: newName,
          personaIds: kind === "hmw" ? selectedPersonas : [],
          source: { revision: evidence.revision, cardIds: selected, available: new Set(interviewCards.map(card => card.id)) },
        });
        return next !== old ? tags.apply(next, id) : old;
      }
      let next = kind === "primary" ? enableAidtPrimarySurpriseEntity(old) : addAidtDefinitionSurprise(old, id);
      if (next === old) return old;
      if (kind === "surprise") {
        const surprise = readAidtDefinition(next.fields).surprises.find(item => item.id === id);
        if (!surprise) return old;
        next = saveAidtDefinitionSurprise(next, { ...surprise, cardIds: selected }, evidence.revision ?? null);
      } else if (selected.length && evidence.revision) {
        next = { ...next, fields: { ...next.fields, surpriseCardIds: JSON.stringify(selected), surpriseSourceRevision: String(evidence.revision) } };
      }
      return tags.apply({ ...next, fields: { ...next.fields, [aidtDefinitionCardNameKey(id)]: newName.trim() } }, id);
    };
    setCreating(true);
    try {
      let success = true;
      if (onCreate) success = await onCreate(id, change);
      else save(change);
      setCreateFailed(!success);
      if (success) { pending.current = null; setKind(null); }
    } catch { setCreateFailed(true); } finally { setCreating(false); }
  }
  const archive = (id: string) => {
    save(old => {
      const definition = readAidtDefinition(old.fields);
      const persona = definition.personas.find(item => item.id === id && !item.archived);
      const hmw = definition.hmws.find(item => item.id === id && !item.archived);
      const surprise = definition.surprises.find(item => item.id === id && !item.archived);
      if (persona) return saveAidtDefinitionPersona(old, { ...persona, archived: true }, null);
      if (hmw) return saveAidtDefinitionHmw(old, { ...hmw, archived: true }, null);
      if (surprise) return saveAidtDefinitionSurprise(old, { ...surprise, archived: true }, null);
      return old;
    });
    setRemoving(null);
  };

  return <section className="space-y-4" aria-label="综合与定义产物" data-testid="aidt-definition-directory">
    <div className="flex flex-wrap gap-2">
      {!readOnly && <AidtNewEntityCardButton disabled={!canEdit} aria-expanded={choosingKind} aria-controls={kindOptionsId} onClick={() => setChoosingKind(value => !value)} />}
      {candidateHost && props.projectId && !readOnly && <>
        <AidtPersonaCandidates projectId={props.projectId} draft={draft} savedDraft={savedDraft} cards={interviewCards} revision={evidence.revision} definitionRevision={props.definitionRevision} disabled={!canAdd || personas.length >= AIDT_DEFINITION_ITEM_LIMIT} host={candidateHost} onCreate={onCreate} />
        <AidtHmwCandidates projectId={props.projectId} draft={draft} savedDraft={savedDraft} cards={interviewCards} revision={evidence.revision} definitionRevision={props.definitionRevision} disabled={!canAdd || hmws.length >= AIDT_DEFINITION_ITEM_LIMIT} host={candidateHost} onCreate={onCreate} />
      </>}
      {!candidateHost && candidateHref && !readOnly && <>
        {canAdd && personas.length < AIDT_DEFINITION_ITEM_LIMIT ? <Button asChild variant="outline"><Link href={candidateHref("persona")}>AI 综合用户画像</Link></Button> : <Button type="button" variant="outline" disabled>AI 综合用户画像</Button>}
        {canAdd && personas.some(item => item.confirmed && !item.archived) && hmws.length < AIDT_DEFINITION_ITEM_LIMIT ? <Button asChild variant="outline"><Link href={candidateHref("hmw")}>AI 构思 HMW</Link></Button> : <Button type="button" variant="outline" disabled>AI 构思 HMW</Button>}
      </>}
      {active.some(item => item.archived) && <Button type="button" variant="ghost" onClick={() => setShowArchived(value => !value)}>{showArchived ? "返回产物" : "查看已移除"}</Button>}
    </div>
    {(choosingKind || kindToCreate) && <Dialog open onOpenChange={open => { if (!open && !creating) { setChoosingKind(false); setKind(null); } }}><DialogContent className="overflow-y-auto">
      <DialogTitle>{kindToCreate ? "新建" + labels[kindToCreate] : "新建卡片"}</DialogTitle>
      <DialogDescription>{kindToCreate ? "保存后将打开这张卡的对话。" : "选择要创建的卡片类型。"}</DialogDescription>
    <div id={kindOptionsId} role="group" aria-label="选择卡片类型" hidden={Boolean(kindToCreate)}>
      <div className="flex flex-wrap gap-2">
        {!hasAidtPrimarySurpriseEntity(draft) && <Button type="button" disabled={!canEdit} onClick={() => { setChoosingKind(false); start("primary"); }}>{draft.fields.surpriseConfirmed === "true" ? "开启意外发现对话" : "新建意外发现"}</Button>}
        {draft.fields.surpriseStatus === "found" && <Button type="button" variant="outline" disabled={!canAdd || surprises.length >= AIDT_DEFINITION_ITEM_LIMIT} onClick={() => { setChoosingKind(false); start("surprise"); }}>新建补充发现</Button>}
        <Button type="button" variant="outline" disabled={!canAdd || personas.length >= AIDT_DEFINITION_ITEM_LIMIT} onClick={() => { setChoosingKind(false); start("persona"); }}>新建画像</Button>
        <Button type="button" variant="outline" disabled={!canAdd || !personas.some(item => item.confirmed && !item.archived) || hmws.length >= AIDT_DEFINITION_ITEM_LIMIT} onClick={() => { setChoosingKind(false); start("hmw"); }}>新建 HMW</Button>
      </div>
    </div>
      {kindToCreate && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void add(kindToCreate); }}>
        <label className="block text-13">卡片名称<Input value={newName} maxLength={80} required onChange={event => setNewName(event.target.value)} /></label>
        {tags.field}
        {kindToCreate === "hmw" && <AidtCardSources label="来源画像" options={personaOptions} selected={selectedPersonas}
          select={values => { if (values.length <= AIDT_DEFINITION_EVIDENCE_LIMIT) setSelectedPersonas(values); }} />}
        {kindToCreate === "persona" || kindToCreate === "hmw"
          ? <fieldset className="space-y-2"><legend className="text-13 font-medium">来源访谈</legend>
              <DefinitionEvidence projectId={props.projectId} {...evidence} cards={interviewCards} selected={selected}
                disabled={!canAdd || sourceChanged} onChange={setSelected} groupByInterview />
            </fieldset>
          : <AidtCardSources label="来源访谈" options={evidenceOptions} selected={selected}
              select={values => { if (values.length <= AIDT_DEFINITION_EVIDENCE_LIMIT) setSelected(values); }} />}
        {sourceChanged && <p role="status" className="text-13">访谈版本已更新，请重新打开并选择。</p>}
        {createFailed && <p role="alert">创建未完成。请重试创建此卡。</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={creating} onClick={() => setKind(null)}>取消</Button>
          <Button type="submit" disabled={creating || sourceChanged || !newName.trim() || (kindToCreate !== "primary" && !selected.length) || (kindToCreate === "hmw" && !selectedPersonas.length)}>创建{labels[kindToCreate]}</Button></div>
      </form>}</DialogContent></Dialog>}
    {!evidence.ready && !evidence.unavailable && <p className="text-13 text-muted-foreground">先在意外发现的 Chat 中记录并确认发现或「暂无」。</p>}
    {invalid && <p role="alert" className="text-13">部分产物读取失败。</p>}
    {evidence.stale && <div role="status" className="flex flex-wrap items-center gap-2 text-13">
      <p>引用第 2 步 V{evidence.pinnedRevision}。</p>
      {evidence.failed && <Button type="button" size="sm" variant="outline" onClick={evidence.retry}>重试读取</Button>}
      {props.availableCardsRevision && <Button type="button" size="sm" variant="outline" disabled={!canEdit} onClick={() => save(rebaseAidtDefinitionEvidence)}>改用新版证据</Button>}
    </div>}
    <ul aria-label="综合与定义卡片" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {active.filter(item => item.archived === showArchived).map(item => {
        const name = title(item.id, item.title);
        const confirmed = aidtDefinitionEntityConfirmed(savedDraft ?? (!requestSave ? draft : undefined), item.id, evidence.cards, evidence.revision);
        return <AidtEntityCard key={item.id} entityId={item.id} className="gap-3 p-4" useSharedTags={!item.archived}>
          <p className="text-12 text-muted-foreground">{kindLabels[item.kind]} · {item.archived ? "已移除" : confirmed ? "已确认" : "待确认"}</p>
          <h3 className="break-words text-16 font-semibold">{name}</h3>
          {!item.archived && <div className="flex flex-wrap items-center gap-2">
            {openAllowed(item.id) ? <Button asChild size="sm" variant="secondary"><Link href={entityHref(item.id)}>打开{kindLabels[item.kind]}对话</Link></Button> : <p className="text-12 text-muted-foreground">保存后可打开</p>}
            {canEdit && <Button type="button" size="sm" variant="ghost" onClick={() => setEditing({ id: item.id, name })}>改名</Button>}
            {canEdit && item.id !== AIDT_PRIMARY_SURPRISE_ID && <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(item.id)}>删除</Button>}
          </div>}
        </AidtEntityCard>;
      })}
    </ul>
    {editing && <Dialog open onOpenChange={open => { if (!open) setEditing(null); }}>
      <DialogContent><DialogTitle>修改卡片名称</DialogTitle><DialogDescription>该名称用于卡片列表。</DialogDescription>
        <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          const value = editing.name.trim();
          if (!value) return;
          save(old => aidtDefinitionEntityKind(old, editing.id) && (Object.hasOwn(old.fields, aidtDefinitionCardNameKey(editing.id)) || Object.keys(old.fields).length < 95)
            ? { ...old, fields: { ...old.fields, [aidtDefinitionCardNameKey(editing.id)]: value } } : old);
          setEditing(null);
        }}>
          <Input aria-label="卡片名称" value={editing.name} maxLength={80} onChange={event => setEditing({ ...editing, name: event.target.value })} />
          <Button type="submit" disabled={!editing.name.trim()}>保存名称</Button>
        </form>
      </DialogContent>
    </Dialog>}
    {removing && <Dialog open onOpenChange={open => { if (!open) setRemoving(null); }}>
      <DialogContent><DialogTitle>删除卡片？</DialogTitle><DialogDescription>卡片将移至「已移除」，已有版本和引用仍可查看。</DialogDescription>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setRemoving(null)}>取消</Button><Button type="button" variant="destructive" onClick={() => archive(removing)}>确认删除</Button></div>
      </DialogContent>
    </Dialog>}
  </section>;
}

function DefinitionChatView({ props, entityId }: { props: AidtDefinitionProps; entityId: string }) {
  const session = useOptionalSession()?.session;
  const evidence = useDefinitionEvidence(props);
  const { draft, projectId } = props;
  const { personas, hmws, surprises } = readAidtDefinition(draft.fields);
  const persona = personas.find(item => item.id === entityId);
  const storedCanvas = persona ? readAidtPersonaCanvas(draft, entityId) : null;
  const personaCanvas = storedCanvas && storedCanvas.source.projectId === projectId && storedCanvas.source.orgId === session?.currentOrgId ? storedCanvas : null;
  const hmw = hmws.find(item => item.id === entityId);
  const printKey = JSON.stringify([projectId, entityId, session?.currentOrgId, session?.userId, session?.sessionToken, hmw, evidence.syntheticCardIds]);
  const printScope = React.useRef(printKey); printScope.current = printKey;
  const printLife = React.useRef(true);
  const [printFailure, setPrintFailure] = React.useState("");
  React.useEffect(() => { printLife.current = true; return () => { printLife.current = false; }; }, []);
  const primary = entityId === AIDT_PRIMARY_SURPRISE_ID ? parseAidtSurpriseReflection(draft, evidence.cards, evidence.revision) : null;
  const surprise = surprises.find(item => item.id === entityId);
  const entityKind = aidtDefinitionEntityKind(draft, entityId);
  const selected = persona?.cardIds ?? hmw?.cardIds ?? primary?.cardIds ?? surprise?.cardIds ?? [];
  const entries: [string, string | undefined][] = persona ? [
    ["画像名称", persona.name], ["情境", persona.situation], ["行为", persona.behavior], ["需求", persona.need], ["仍待核实", persona.limits],
  ] : hmw ? [["研究方向", hmw.text], ["说明", hmw.rationale], ["关联画像", hmw.personaIds.map(id => personas.find(item => item.id === id)?.name).filter(Boolean).join("、")]]
    : primary?.status === "none" ? [["意外发现", "暂无"]]
      : [["原先想法", primary?.priorBelief ?? surprise?.priorBelief], ["观察到的差异", primary?.surprisingFinding ?? surprise?.observation], ["学生解释", primary?.interpretation ?? surprise?.interpretation], ["仍待核实", surprise?.unknowns]];
  const currentSynthetic = evidence.syntheticCardIds.filter(id => selected.includes(id));
  const savedSynthetic = aidtSavedDefinitionSyntheticCardIds(draft.fields, entityId, selected);
  const sourceNotice = savedSynthetic.length || currentSynthetic.length ? AIDT_DEFINITION_SYNTHETIC_NOTICE : undefined;
  const filled = entries.filter(([, value]) => value?.trim());
  if (!entityKind) return <p role="status">找不到这项产物。</p>;
  return <section className="space-y-3" data-testid="aidt-definition-editor" aria-label="当前产物">
    <h3 className="text-16 font-semibold">{kindLabels[entityKind]}</h3>
    {personaCanvas && <div className="space-y-2"><AidtPersonaCanvasPreview template={personaCanvas.template} code={personaCanvas.code} sourceNotice={sourceNotice} /><Link className="text-12 text-primary underline" href={`/chat/${encodeURIComponent(personaCanvas.source.threadId)}`}>查看生成对话</Link><p className="text-12 text-muted-foreground">后台模板 V{personaCanvas.template.version} · 来源第 2 步 V{personaCanvas.source.revision} · AI 草稿已由学生选入，确认状态见当前产物。</p></div>}
    {sourceNotice && !personaCanvas && <p className="text-12 text-muted-foreground">{sourceNotice}</p>}
    {!filled.length ? <p className="text-13 text-muted-foreground">还没有产物草稿。</p> : <dl className="space-y-2 text-13">
      {filled.map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
    </dl>}
    {hmw && <><Button type="button" size="sm" variant="outline" disabled={!hmw.text.trim()} onClick={() => {
      const captured = printKey;
      void previewAidtText(`${sourceNotice ? sourceNotice + "\n\n" : ""}${hmw.text}\n\n理由：${hmw.rationale || "待补充"}\n\n当前页面问题稿；小组确认与共享保存以服务器回执为准。来源访谈 V${evidence.revision ?? "待核对"}。`, "HMW 问题", { isCurrent: () => printLife.current && printScope.current === captured, defaultPaper: "A4" }).catch(() => { if (printLife.current && printScope.current === captured) setPrintFailure("打印预览未打开，请重试。"); });
    }}>打印问题</Button>{printFailure && <p role="alert" className="text-13">{printFailure}</p>}</>}
    {entityKind === "surprise" && <AidtSavedTextPrint projectId={projectId} artifactKey={entityId} stageId={3} label="打印意外发现" draft={draft} selectText={value => {
      if (readAidtDefinitionEvidenceRevision(value.fields) !== evidence.revision || !aidtDefinitionEntityConfirmed(value, entityId, evidence.cards, evidence.revision)) return null;
      const record = readAidtDefinition(value.fields).surprises.find(item => item.id === entityId && !item.archived);
      const reflection = entityId === AIDT_PRIMARY_SURPRISE_ID ? parseAidtSurpriseReflection(value, evidence.cards, evidence.revision) : null;
      if (reflection?.status === "none") return "# 意外发现记录\n\n本轮学生记录：暂无。不能据此声称不存在例外。";
      if (!record && !reflection) return null;
      return ["# 意外发现记录", `原先想法：${reflection?.priorBelief ?? record?.priorBelief ?? "未记录"}`, `观察到的差异：${reflection?.surprisingFinding ?? record?.observation ?? "未记录"}`,
        `学生解释：${reflection?.interpretation ?? record?.interpretation ?? "未记录"}`, `仍待核实：${record?.unknowns || "未记录"}`, `来源第2步 V${evidence.revision ?? "待核对"}：${(reflection?.cardIds ?? record?.cardIds ?? []).join("、")}`].join("\n\n");
    }} />}
    {selected.length > 0 && <details className="space-y-2 text-13">
      <summary className="cursor-pointer font-medium">引用材料{evidence.revision ? ` · 第 2 步 V${evidence.revision}` : ""}</summary>
      {evidence.cards.filter(card => selected.includes(card.id)).map(card => <div key={card.id}>
        <p>{card.participantCode} · {card.headline || "人物发现"}</p>
        {projectId && evidence.revision && <Link className="text-primary underline" href={`/aidt/${encodeURIComponent(projectId)}?${new URLSearchParams({ step: "2", entity: card.id, entityRevision: String(evidence.revision) })}`}>查看访谈 V{evidence.revision}</Link>}
        <DefinitionEvidenceSource projectId={projectId} card={card} source={evidence.sourceFields[researchMaterialKey("source", card.id)]} />
      </div>)}
      {evidence.unavailable && <p role="status">暂无法读取原版本。</p>}
    </details>}
  </section>;
}

export function AidtDefinitionOutput(props: AidtDefinitionProps & { entityId: string }) {
  return <DefinitionChatView props={props} entityId={props.entityId} />;
}

/** Candidate work uses the existing stage Chat, without creating an empty formal persona/HMW to obtain a thread. */
export function AidtDefinitionCandidateChat({ kind, messages, loading, running, savedDraft, onCreate, ...props }: AidtDefinitionProps & {
  kind: "persona" | "hmw"; messages: readonly AidtDefinitionTurn[]; loading: boolean; running: boolean;
  savedDraft?: AidtUiStageDraft; onCreate: NonNullable<DirectoryProps["onCreate"]>;
}) {
  const evidence = useDefinitionEvidence(props);
  const records = readAidtDefinition(props.draft.fields);
  const disabled = props.readOnly || evidence.unavailable || !evidence.ready || records.invalid;
  const host = useAidtDefinitionCandidateHost({ projectId: props.projectId, revision: evidence.revision, definitionRevision: props.definitionRevision, canWrite: !disabled, messages, loading, running });
  if (!props.projectId) return null;
  const owners = new Set(readAidtInterviews(evidence.sourceFields).filter(item => !isAidtInterviewArchived(evidence.sourceFields, item.id)).map(item => item.id));
  const cards = evidence.cards.filter(card => owners.has(card.id));
  const common = { projectId: props.projectId, draft: props.draft, savedDraft, cards,
    revision: evidence.revision, definitionRevision: props.definitionRevision, disabled: disabled || (kind === "persona" ? records.personas.length : records.hmws.length) >= AIDT_DEFINITION_ITEM_LIMIT, host, onCreate, initialOpen: true };
  return <section aria-label={kind === "persona" ? "画像候选" : "HMW候选"} className="space-y-3 rounded-xl border border-border p-4">
    <p className="text-13 text-muted-foreground">候选只保留在本轮对话；你明确加入后才成为小组产物。</p>
    {kind === "persona" ? <AidtPersonaCandidates {...common} /> : <AidtHmwCandidates {...common} />}
    {disabled && <p role="status" className="text-13">请先完成意外发现核对，并确认来源访谈仍可读取。</p>}
  </section>;
}

export function AidtDefinitionChatArtifact({ entityId, messages, loading, running, savedDraft, requestSave, ...props }: AidtDefinitionProps & {
  entityId: string;
  messages: readonly AidtDefinitionTurn[];
  loading: boolean;
  running: boolean;
  savedDraft?: AidtUiStageDraft;
  requestSave: () => void;
}) {
  const { draft, update, readOnly } = props;
  const session = useOptionalSession()?.session;
  const { cards, revision, unavailable } = useDefinitionEvidence(props);
  const [checkingSource, setCheckingSource] = React.useState(false), [sourceFailure, setSourceFailure] = React.useState("");
  const sourceScope = JSON.stringify([props.projectId, session?.currentOrgId, session?.userId, session?.sessionToken, entityId, revision]);
  const sourceCurrent = React.useRef(sourceScope); sourceCurrent.current = sourceScope;
  React.useEffect(() => { sourceCurrent.current = sourceScope; setCheckingSource(false); return () => { sourceCurrent.current = ""; }; }, [sourceScope]);
  const freshChange = React.useCallback(async function freshChange(change: (old: AidtUiStageDraft, currentCards: readonly AidtDiscoveryCardDraft[]) => AidtUiStageDraft, save: boolean) {
    if (checkingSource || !props.projectId || !session?.sessionToken || !revision) return;
    const expected = sourceScope;
    setCheckingSource(true); setSourceFailure("");
    try {
      const evidence = await loadAidtAuthorizedDefinitionEvidence({ projectId: props.projectId, revision, sessionToken: session.sessionToken,
        cardIds: cards.length ? cards.map(card => card.id) : undefined });
      if (sourceCurrent.current !== expected) return;
      update(old => change(old, evidence.cards));
      if (save) requestSave();
    } catch { if (sourceCurrent.current === expected) setSourceFailure("当前来源授权无法核对，未采用或确认。旧历史保留，请刷新来源后继续。"); }
    finally { if (sourceCurrent.current === expected) setCheckingSource(false); }
  }, [cards, checkingSource, props.projectId, revision, session?.sessionToken, sourceScope, update, requestSave]);
  const entityKind = aidtDefinitionEntityKind(draft, entityId);
  const candidate = entityKind && !loading && !running ? latestAidtDefinitionCandidate(messages, entityKind, entityId === AIDT_PRIMARY_SURPRISE_ID) : null;
  const saved = aidtDefinitionEntityConfirmed(savedDraft, entityId, cards, revision)
    && sameSavedAidtDefinitionChatEntity(draft, savedDraft, entityId, cards, revision);
  const localConfirmed = aidtDefinitionEntityConfirmed(draft, entityId, cards, revision);
  const historicalWithoutSource = localConfirmed && !draft.fields[aidtDefinitionChatMessageKey(entityId)];
  const staged = draft.fields[aidtDefinitionChatMessageKey(entityId)] === candidate?.messageId;
  const canApply = candidate && !readOnly && !unavailable && !staged;
  const [manualDraft, setManualDraft] = React.useState(false);
  const applied = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!canApply || !candidate || historicalWithoutSource) return;
    const key = JSON.stringify([entityId, candidate.messageId, revision, cards.map(card => card.id)]);
    if (applied.current === key) return;
    applied.current = key;
    void freshChange((old, currentCards) => applyAidtDefinitionCandidate(old, entityId, candidate, currentCards, revision), false);
  }, [canApply, candidate, cards, entityId, freshChange, historicalWithoutSource, revision, update]);
  const next = confirmAidtDefinitionChatEntity(draft, entityId, cards, revision);
  if (!entityKind || readOnly) return null;
  const confirmationBlocker = next !== draft ? null : unavailable ? "请先恢复或刷新第 2 步的来源访问，再核对草稿。"
    : entityKind === "surprise" ? "请选择「有意外发现」或「暂无意外发现」。有发现时，请填写原先判断、具体发现，并关联已确认的发现卡。"
    : entityKind === "persona" ? "请先确认本组的意外发现记录，再填写画像并关联第 2 步已确认的发现卡。"
    : "请先确认本组的意外发现记录和画像，再填写 HMW 并核对所关联的发现来源。";

  return <section aria-label="对话产物确认" className="space-y-3 rounded-xl border border-border bg-card p-4">
    <p className="text-13 font-medium">{kindLabels[entityKind]} · {saved && localConfirmed ? "已确认" : "草稿"}</p>
    {historicalWithoutSource && canApply && candidate && <Button type="button" size="sm" variant="outline" disabled={checkingSource} onClick={() => void freshChange((old, currentCards) => applyAidtDefinitionCandidate(old, entityId, candidate, currentCards, revision), false)}>采用本轮新稿</Button>}
    {!localConfirmed && <AidtConfirmAction disabled={running || loading || checkingSource} blocker={confirmationBlocker} onBlocked={() => setManualDraft(true)} onConfirm={() => void freshChange((old, currentCards) => confirmAidtDefinitionChatEntity(old, entityId, currentCards, revision), true)}>确认当前产物</AidtConfirmAction>}
    {localConfirmed && !saved && !running && !loading && <Button type="button" disabled={checkingSource} onClick={() => void freshChange((old, currentCards) => confirmAidtDefinitionChatEntity(old, entityId, currentCards, revision), true)}>重试保存确认</Button>}
    {(!localConfirmed || entityKind === "surprise") && !running && !loading && <Button type="button" size="sm" variant="ghost" disabled={checkingSource || unavailable} aria-expanded={manualDraft} onClick={() => setManualDraft(value => !value)}>{manualDraft ? "收起来源核对" : localConfirmed ? "修订记录" : "核对草稿和来源"}</Button>}
    {sourceFailure && <p role="alert" className="text-13">{sourceFailure}</p>}
    {manualDraft && <AidtDefinitionChatEvidence {...props} entityId={entityId} cards={cards} revision={revision} />}
    {entityKind === "hmw" && saved && localConfirmed && readAidtDefinitionSelection(draft.fields)?.id !== entityId && <Button type="button" size="sm" variant="secondary" disabled={checkingSource} onClick={() => void freshChange((old, currentCards) => chooseAidtDefinitionHmw(old, entityId, new Set(currentCards.map(card => card.id))), true)}>选为本轮 HMW</Button>}
  </section>;
}

function AidtDefinitionChatEvidence({ draft, update, entityId, cards, revision, readOnly }: AidtDefinitionProps & {
  entityId: string; cards: readonly AidtDiscoveryCardDraft[]; revision?: number;
}) {
  const entityKind = aidtDefinitionEntityKind(draft, entityId);
  if (!entityKind) return null;
  // Existing draft editors are embedded in the native Chat for clearing or repairing a source.
  if (entityKind !== "surprise") return <AidtDefinitionEditor projectId={undefined} draft={draft} update={update} entityId={entityId} availableCards={cards}
    availableCardsRevision={revision} discoveryCardFields={Object.fromEntries(cards.map(card => [`interviewConfirmed:${card.id}`, "true"]))} readOnly={readOnly} sourcesOnly />;
  const primary = entityId === AIDT_PRIMARY_SURPRISE_ID;
  if (primary) return <AidtSurpriseReflection draft={draft} availableCards={cards} availableCardsRevision={revision} readOnly={readOnly}
    onChange={next => update(old => ({ ...old, fields: { ...old.fields, ...Object.fromEntries(Object.entries(next.fields).filter(([key, value]) => value !== draft.fields[key])) } }))} />;
  const surprise = readAidtDefinition(draft.fields).surprises.find(item => item.id === entityId);
  return surprise ? <DefinitionSurpriseRecord record={surprise} disabled={readOnly} evidence={{ cards, revision, unconfirmedCards: 0, sourceFields: {} }}
    onEdit={patch => update(old => {
      const record = readAidtDefinition(old.fields).surprises.find(item => item.id === entityId);
      return record ? saveAidtDefinitionSurprise(old, { ...record, confirmed: false, ...patch }, revision ?? null) : old;
    })} /> : null;
}

function DefinitionText({ label, value, limit = 400, disabled, onChange }: { label: string; value: string; limit?: number; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="block text-13 font-medium">{label}<Textarea className="mt-1 font-normal" rows={2} maxLength={limit} value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)} /></label>;
}

function toggleId(ids: string[], id: string, checked: boolean) {
  return checked ? [...new Set([...ids, id])] : ids.filter(current => current !== id);
}

function DefinitionEvidenceSource({ projectId, card, source }: { projectId?: string; card: AidtDiscoveryCardDraft; source?: string }) {
  const [open, setOpen] = React.useState(false);
  const reference = parseAidtResearchMaterial(source);
  return <details className="mt-1 text-12 text-muted-foreground" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">查看引用</summary>
    <p className="whitespace-pre-wrap break-words">{card.headlineKind === "quote" ? "受访者原话" : "学生概括"} · {card.context || "暂无情况记录"}</p>
    <p className="break-words">材料定位：{card.sourceRef || "尚无材料定位"}</p>
    {open && projectId && reference && reference.projectId === projectId && <AidtResearchMaterialPreview projectId={projectId} reference={reference} quote={card.quote} />}
  </details>;
}

type EvidenceProps = { projectId?: string; sourceFields: Readonly<Record<string, string>>; cards: readonly AidtDiscoveryCardDraft[]; unconfirmedCards: number; revision?: number };

function DefinitionEvidence({ projectId, sourceFields, cards, unconfirmedCards, revision, selected, disabled, onChange, groupByInterview }: EvidenceProps & { selected: string[]; disabled: boolean; onChange: (ids: string[]) => void; groupByInterview?: boolean }) {
  const interviews = groupByInterview ? new Map(readAidtInterviews(sourceFields).map(item => [item.id, item])) : null;
  const cardControl = (card: AidtDiscoveryCardDraft) => {
    const interview = interviews?.get(card.id);
    const name = interview?.displayName ? `${interview.code} · ${interview.displayName}` : interview?.code || card.participantCode;
    return <div key={card.id} className="rounded-lg border border-border p-2 text-13">
      {groupByInterview && name && <p className="mb-1 font-semibold">{name}</p>}
      <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" aria-label={groupByInterview ? `${name} · ${card.headline || "人物发现卡"}` : undefined} checked={selected.includes(card.id)} disabled={!selected.includes(card.id) && selected.length >= AIDT_DEFINITION_EVIDENCE_LIMIT} onChange={event => onChange(toggleId(selected, card.id, event.currentTarget.checked))} /><span className="min-w-0 break-words">{groupByInterview ? card.headline || "人物发现卡" : `${card.participantCode} · ${card.headline || "人物发现"}`}</span></label>
      <DefinitionEvidenceSource projectId={projectId} card={card} source={sourceFields[researchMaterialKey("source", card.id)]} />
    </div>;
  };
  return <fieldset className="space-y-2" disabled={disabled || !revision}>
    <legend className="text-13 font-medium">关联已确认的人物发现卡{revision ? ` · 第 2 步 V${revision}` : ""}</legend>
    {cards.length ? cards.map(cardControl) : <p className="text-12 text-muted-foreground">当前没有可选的已确认人物发现卡。</p>}
    {unconfirmedCards > 0 && <p className="text-12 text-muted-foreground">另有 {unconfirmedCards} 张卡尚未确认或已归档，可回第 2 步核对。</p>}
  </fieldset>;
}

function DefinitionSurpriseRecord({ record, disabled, evidence, onEdit }: {
  record: AidtDefinitionSurprise; disabled: boolean; evidence: EvidenceProps; onEdit: (patch: Partial<AidtDefinitionSurprise>) => void;
}) {
  if (record.archived) return <p className="text-12 text-muted-foreground">{record.observation || "未填写的发现"} · 已归档</p>;
  const valid = isAidtDefinitionSurpriseReady(record, new Set(evidence.cards.map(card => card.id)));
  return <details className="space-y-3 rounded-lg border border-border p-3">
    <summary className="cursor-pointer text-13 font-medium">{record.observation || "未填写的发现"} · {record.confirmed ? "已经核对" : "待核对"}</summary>
    <DefinitionText label="原先的想法" value={record.priorBelief} disabled={disabled} onChange={priorBelief => onEdit({ priorBelief })} />
    <DefinitionText label="观察到的差异" value={record.observation} disabled={disabled} onChange={observation => onEdit({ observation })} />
    <DefinitionText label="学生解释" value={record.interpretation} disabled={disabled} onChange={interpretation => onEdit({ interpretation })} />
    <DefinitionText label="仍待核实" value={record.unknowns} disabled={disabled} onChange={unknowns => onEdit({ unknowns })} />
    <DefinitionEvidence {...evidence} disabled={disabled} selected={record.cardIds} onChange={cardIds => onEdit({ cardIds })} />
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled || record.confirmed || !valid} onClick={() => onEdit({ confirmed: true })}>核对并确认这条发现</Button><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onEdit({ archived: true })}>归档这条发现</Button></div>
  </details>;
}

function DefinitionSurpriseLinks({ choices, selected, disabled, onChange }: {
  choices: ReturnType<typeof confirmedAidtDefinitionSurprises>; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void;
}) {
  const invalid = selected.filter(id => !choices.some(choice => choice.id === id));
  if (!choices.length && !invalid.length) return null;
  return <fieldset className="space-y-2" disabled={disabled}>
    <legend className="text-13 font-medium">关联已确认的意外发现</legend>
    {choices.map(choice => <label className="flex items-start gap-2 text-13" key={choice.id}><input type="checkbox" className="mt-1" checked={selected.includes(choice.id)} onChange={event => onChange(toggleId(selected, choice.id, event.currentTarget.checked))} /><span className="min-w-0 break-words">{choice.label}</span></label>)}
    {invalid.length > 0 && <div className="space-y-2 text-12" role="status"><p>有 {invalid.length} 项原关联待重新核对或已归档。</p><Button type="button" size="sm" variant="outline" onClick={() => onChange(selected.filter(id => !invalid.includes(id)))}>移除失效关联</Button></div>}
  </fieldset>;
}

export function AidtDefinitionEditor(props: AidtDefinitionProps & { entityId: string; sourcesOnly?: boolean }) {
  const { projectId, draft, update, readOnly, entityId } = props;
  const { cards, revision, ready, stale, pinnedRevision, unavailable, unconfirmedCards, sourceFields, failed, retry } = useDefinitionEvidence(props);
  const { personas, hmws, invalid } = readAidtDefinition(draft.fields);
  const persona = personas.find(item => item.id === entityId);
  const hmw = hmws.find(item => item.id === entityId);
  const availableCardIds = new Set(cards.map(card => card.id));
  const surprises = ready ? confirmedAidtDefinitionSurprises(draft.fields) : [];
  const confirmedSurpriseIds = new Set(surprises.map(record => record.id));
  if (!persona && !hmw) return <p role="status" className="text-13">这项产物未找到，请从综合与定义的目录重新打开。</p>;
  const disabled = readOnly || !ready || unavailable || invalid || Boolean(persona?.archived || hmw?.archived);
  const editPersona = (patch: Partial<AidtDefinitionPersona>) => {
    if (disabled || !persona) return;
    update(old => {
      const item = readAidtDefinition(old.fields).personas.find(current => current.id === entityId);
      return item ? saveAidtDefinitionPersona(old, { ...item, confirmed: false, ...patch }, revision ?? null) : old;
    });
  };
  const editHmw = (patch: Partial<AidtDefinitionHmw>) => {
    if (disabled || !hmw) return;
    update(old => {
      const item = readAidtDefinition(old.fields).hmws.find(current => current.id === entityId);
      return item ? saveAidtDefinitionHmw(old, { ...item, confirmed: false, ...patch }, revision ?? null) : old;
    });
  };
  const selected = readAidtDefinitionSelection(draft.fields)?.id === entityId;
  const hmwReady = hmw && isAidtDefinitionHmwReady(hmw, personas, availableCardIds, confirmedSurpriseIds);
  return <section className="space-y-4" data-testid="aidt-definition-editor">
    <h3 className="text-16 font-semibold">{persona ? "用户画像" : "我们如何……（HMW）"}</h3>
    {!ready && <p role="status" className="text-13">请先在综合与定义目录记录并确认意外发现或「暂无」。</p>}
    {stale && <p role="status" className="text-13">{unavailable ? `暂无法读取本轮引用的第 2 步 V${pinnedRevision}，请从目录核对材料。` : `本轮继续使用第 2 步 V${pinnedRevision}。可从目录核对后改用新版。`}</p>}
    {failed && <Button type="button" size="sm" variant="outline" onClick={retry}>重试读取原版本</Button>}
    {persona && <>
      {!props.sourcesOnly && <><DefinitionText label="画像名称" value={persona.name} limit={220} disabled={disabled} onChange={name => editPersona({ name })} />
      <DefinitionText label="用户情境" value={persona.situation} disabled={disabled} onChange={situation => editPersona({ situation })} />
      <DefinitionText label="可观察的行为" value={persona.behavior} disabled={disabled} onChange={behavior => editPersona({ behavior })} />
      <DefinitionText label="需求" value={persona.need} disabled={disabled} onChange={need => editPersona({ need })} />
      <DefinitionText label="反例、适用范围或仍未知的地方" value={persona.limits} disabled={disabled} onChange={limits => editPersona({ limits })} /></>}
      <DefinitionSurpriseLinks choices={surprises} selected={persona.surpriseIds ?? []} disabled={disabled} onChange={surpriseIds => editPersona({ surpriseIds })} />
      <DefinitionEvidence projectId={projectId} sourceFields={sourceFields} cards={cards} unconfirmedCards={unconfirmedCards} revision={revision} selected={persona.cardIds} disabled={disabled} onChange={cardIds => editPersona({ cardIds })} />
      {!props.sourcesOnly && <Button type="button" size="sm" disabled={disabled || persona.confirmed || !isAidtDefinitionPersonaReady(persona, availableCardIds, confirmedSurpriseIds)} onClick={() => editPersona({ confirmed: true })}>{persona.confirmed ? "画像已确认" : "确认画像"}</Button>}
    </>}
    {hmw && <>
      {!props.sourcesOnly && <><DefinitionText label="我们如何……（HMW）" value={hmw.text} limit={220} disabled={disabled} onChange={text => editHmw({ text })} />
      <DefinitionText label="选择理由或待核实处" value={hmw.rationale} disabled={disabled} onChange={rationale => editHmw({ rationale })} /></>}
      <fieldset disabled={disabled} className="space-y-2"><legend className="text-13 font-medium">关联已确认画像</legend>{personas.filter(item => !item.archived).map(item => <label className="flex items-center gap-2 text-13" key={item.id}><input type="checkbox" checked={hmw.personaIds.includes(item.id)} disabled={!item.confirmed && !hmw.personaIds.includes(item.id)} onChange={event => editHmw({ personaIds: toggleId(hmw.personaIds, item.id, event.currentTarget.checked) })} />{item.name || "未命名画像"}{!item.confirmed && " · 待确认"}</label>)}</fieldset>
      <DefinitionSurpriseLinks choices={surprises} selected={hmw.surpriseIds ?? []} disabled={disabled} onChange={surpriseIds => editHmw({ surpriseIds })} />
      <DefinitionEvidence projectId={projectId} sourceFields={sourceFields} cards={cards} unconfirmedCards={unconfirmedCards} revision={revision} selected={hmw.cardIds} disabled={disabled} onChange={cardIds => editHmw({ cardIds })} />
      {!props.sourcesOnly && <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled || hmw.confirmed || !hmwReady} onClick={() => editHmw({ confirmed: true })}>{hmw.confirmed ? "HMW 已确认" : "确认 HMW"}</Button><Button type="button" size="sm" variant="outline" disabled={disabled || selected || !hmw.confirmed || !hmwReady} onClick={() => update(old => chooseAidtDefinitionHmw(old, entityId, availableCardIds))}>{selected ? "本轮选用" : "选为本轮 HMW"}</Button></div>}
    </>}
    {!props.sourcesOnly && <><details className="border-t border-border pt-2 text-12"><summary className="cursor-pointer">归档这项产物</summary><p className="my-2 text-muted-foreground">归档后停止本轮使用，现有历史版本和下游引用仍可回查。</p><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => persona ? editPersona({ archived: true }) : editHmw({ archived: true })}>确认归档</Button></details>
    <p className="text-12 text-muted-foreground">确认或归档后请保存到小组。创意发散承接本轮保存的 HMW 版本。</p></>}
  </section>;
}
