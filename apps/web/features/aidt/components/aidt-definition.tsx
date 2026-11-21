"use client";

import * as React from "react";
import Link from "next/link";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AIDT_DEFINITION_EVIDENCE_LIMIT, AIDT_DEFINITION_ITEM_LIMIT, addAidtDefinitionEntity, aidtDefinitionCards,
  chooseAidtDefinitionHmw, isAidtDefinitionHmwReady, isAidtDefinitionPersonaReady, readAidtDefinition,
  readAidtDefinitionEntities, readAidtDefinitionEvidenceRevision, readAidtDefinitionSelection,
  rebaseAidtDefinitionEvidence, saveAidtDefinitionHmw, saveAidtDefinitionPersona,
  type AidtDefinitionHmw, type AidtDefinitionPersona,
} from "../lib/aidt-definition";
import { listAidtStageHistory, type AidtSharedStage } from "../lib/live-aidt-stages";
import { isAidtSurpriseConfirmed } from "../lib/aidt-surprise-reflection";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtSurpriseReflection } from "./aidt-surprise-reflection";
import { AidtResearchMaterialPreview } from "./aidt-research-material";
import { parseAidtResearchMaterial, researchMaterialKey } from "../lib/aidt-research-material-reference";

type DefinitionProps = {
  projectId?: string;
  draft: AidtUiStageDraft;
  update: (mutate: (draft: AidtUiStageDraft) => AidtUiStageDraft) => void;
  readOnly: boolean;
  availableCards: readonly AidtDiscoveryCardDraft[];
  availableCardsRevision?: number;
  discoveryCardFields?: Readonly<Record<string, string>>;
};

function useDefinitionEvidence({ projectId, draft, availableCards, availableCardsRevision, discoveryCardFields }: DefinitionProps) {
  const session = useOptionalSession()?.session;
  const pinnedRevision = readAidtDefinitionEvidenceRevision(draft.fields);
  const stale = pinnedRevision !== null && availableCardsRevision !== pinnedRevision;
  const token = session?.sessionToken;
  const key = JSON.stringify([projectId, session?.currentOrgId, session?.userId, token, pinnedRevision, stale]);
  const [history, setHistory] = React.useState<{ key: string; stage: AidtSharedStage | null } | null>(null);
  React.useEffect(() => {
    if (!stale || pinnedRevision === null || !projectId || !token) return;
    const cancellation = new AbortController();
    void listAidtStageHistory(projectId, 2, token, { beforeRevision: pinnedRevision + 1, limit: 1 }, cancellation.signal).then(result => {
      if (cancellation.signal.aborted) return;
      const stage = result.items[0];
      setHistory({ key, stage: stage?.revision === pinnedRevision ? stage : null });
    }).catch(() => {
      if (!cancellation.signal.aborted) setHistory({ key, stage: null });
    });
    return () => cancellation.abort();
  }, [key, pinnedRevision, projectId, stale, token]);
  const historicalStage = stale && history?.key === key ? history.stage : null;
  const source = stale ? historicalStage?.content.draft : { fields: discoveryCardFields ?? {}, discoveryCards: availableCards };
  const revision = stale ? historicalStage?.revision : availableCardsRevision;
  const sources = source?.discoveryCards ?? [];
  const cards = aidtDefinitionCards(sources, source?.fields ?? {});
  return {
    cards, revision, stale, pinnedRevision,
    unconfirmedCards: sources.length - cards.length,
    sourceFields: source?.fields ?? {},
    ready: isAidtSurpriseConfirmed(draft, cards, revision),
    unavailable: stale && !historicalStage,
  };
}

export function AidtDefinitionDirectory(props: DefinitionProps & { entityHref: (id: string) => string }) {
  const { draft, update, readOnly, availableCardsRevision, entityHref } = props;
  const { cards, revision, ready, stale, pinnedRevision, unavailable } = useDefinitionEvidence(props);
  const { personas, hmws, invalid } = readAidtDefinition(draft.fields);
  const entities = readAidtDefinitionEntities(draft.fields);
  const selected = readAidtDefinitionSelection(draft.fields);
  const add = (kind: "persona" | "hmw") => {
    const id = crypto.randomUUID();
    update(old => addAidtDefinitionEntity(old, kind, id));
  };
  return <section className="space-y-4" aria-label="综合与定义产物" data-testid="aidt-definition-directory">
    <AidtSurpriseReflection draft={draft} onChange={next => {
      const changed = Object.entries(next.fields).filter(([key, value]) => draft.fields[key] !== value);
      update(old => ({ ...old, fields: { ...old.fields, ...Object.fromEntries(changed) } }));
    }} availableCards={cards} availableCardsRevision={revision} readOnly={readOnly || unavailable} />
    {invalid && <p role="alert" className="text-13">部分产物格式无法读取。请在历史版本中核对，当前产物暂不可修改。</p>}
    {stale && <div className="space-y-2" role="status"><p className="text-13">本轮引用第 2 步 V{pinnedRevision}。{availableCardsRevision ? `第 2 步当前为 V${availableCardsRevision}。` : "当前材料暂不可读取。"}已保存的旧引用仍随历史版本保留。改用新版时，本轮须重新核对证据和 HMW。</p>{availableCardsRevision && <Button type="button" size="sm" variant="outline" disabled={readOnly || invalid} onClick={() => update(rebaseAidtDefinitionEvidence)}>以最新访谈重新核对引用</Button>}</div>}
    <div className="space-y-2"><h3 className="text-16 font-semibold">用户画像与 HMW</h3>
      {entities.length ? <ul className="space-y-2">{entities.map(entity => <li key={entity.id} className="rounded-lg border border-border p-3 text-13"><span className="mr-2 text-muted-foreground">{entity.kind === "persona" ? "画像" : "HMW"}</span>{entity.archived ? <span>{entity.title} · 已归档</span> : <Link className="font-medium text-primary underline" href={entityHref(entity.id)}>{entity.title}</Link>}{selected?.id === entity.id && <span className="ml-2 text-muted-foreground">本轮选用</span>}</li>)}</ul> : <p className="text-13 text-muted-foreground">还没有画像或 HMW。记录并确认意外发现后可新建画像。</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={readOnly || !ready || unavailable || invalid || personas.length >= AIDT_DEFINITION_ITEM_LIMIT} onClick={() => add("persona")}>新建画像</Button><Button type="button" size="sm" variant="outline" disabled={readOnly || !ready || unavailable || invalid || !personas.some(persona => persona.confirmed && !persona.archived) || hmws.length >= AIDT_DEFINITION_ITEM_LIMIT} onClick={() => add("hmw")}>新建 HMW</Button></div>
      <p className="text-12 text-muted-foreground">新建的草稿使用「保存到小组」共享；每项有独立对话。归档会保留已保存的历史版本。</p>
    </div>
  </section>;
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

function DefinitionEvidence({ projectId, sourceFields, cards, unconfirmedCards, revision, selected, disabled, onChange }: { projectId?: string; sourceFields: Readonly<Record<string, string>>; cards: readonly AidtDiscoveryCardDraft[]; unconfirmedCards: number; revision?: number; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  return <fieldset className="space-y-2" disabled={disabled || !revision}>
    <legend className="text-13 font-medium">关联已确认的人物发现卡{revision ? ` · 第 2 步 V${revision}` : ""}</legend>
    {cards.length ? cards.map(card => <div key={card.id} className="rounded-lg border border-border p-2 text-13">
      <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={selected.includes(card.id)} disabled={!selected.includes(card.id) && selected.length >= AIDT_DEFINITION_EVIDENCE_LIMIT} onChange={event => onChange(toggleId(selected, card.id, event.currentTarget.checked))} /><span className="min-w-0 break-words">{card.participantCode} · {card.headline || "人物发现"}</span></label>
      <DefinitionEvidenceSource projectId={projectId} card={card} source={sourceFields[researchMaterialKey("source", card.id)]} />
    </div>) : <p className="text-12 text-muted-foreground">当前没有可选的已确认人物发现卡。</p>}
    {unconfirmedCards > 0 && <p className="text-12 text-muted-foreground">另有 {unconfirmedCards} 张卡尚未确认或已归档，可回第 2 步核对。</p>}
  </fieldset>;
}

export function AidtDefinitionEditor(props: DefinitionProps & { entityId: string }) {
  const { projectId, draft, update, readOnly, entityId } = props;
  const { cards, revision, ready, stale, pinnedRevision, unavailable, unconfirmedCards, sourceFields } = useDefinitionEvidence(props);
  const { personas, hmws, invalid } = readAidtDefinition(draft.fields);
  const persona = personas.find(item => item.id === entityId);
  const hmw = hmws.find(item => item.id === entityId);
  const availableCardIds = new Set(cards.map(card => card.id));
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
  const hmwReady = hmw && isAidtDefinitionHmwReady(hmw, personas, availableCardIds);
  return <section className="space-y-4" data-testid="aidt-definition-editor">
    <h3 className="text-16 font-semibold">{persona ? "用户画像" : "我们如何……（HMW）"}</h3>
    {!ready && <p role="status" className="text-13">请先在综合与定义目录记录并确认意外发现或「暂无」。</p>}
    {stale && <p role="status" className="text-13">{unavailable ? `暂无法读取本轮引用的第 2 步 V${pinnedRevision}，请从目录核对材料。` : `本轮继续使用第 2 步 V${pinnedRevision}。可从目录核对后改用新版。`}</p>}
    {persona && <>
      <DefinitionText label="画像名称" value={persona.name} limit={220} disabled={disabled} onChange={name => editPersona({ name })} />
      <DefinitionText label="用户情境" value={persona.situation} disabled={disabled} onChange={situation => editPersona({ situation })} />
      <DefinitionText label="可观察的行为" value={persona.behavior} disabled={disabled} onChange={behavior => editPersona({ behavior })} />
      <DefinitionText label="需求" value={persona.need} disabled={disabled} onChange={need => editPersona({ need })} />
      <DefinitionText label="反例、适用范围或仍未知的地方" value={persona.limits} disabled={disabled} onChange={limits => editPersona({ limits })} />
      <DefinitionEvidence projectId={projectId} sourceFields={sourceFields} cards={cards} unconfirmedCards={unconfirmedCards} revision={revision} selected={persona.cardIds} disabled={disabled} onChange={cardIds => editPersona({ cardIds })} />
      <Button type="button" size="sm" disabled={disabled || persona.confirmed || !isAidtDefinitionPersonaReady(persona, availableCardIds)} onClick={() => editPersona({ confirmed: true })}>{persona.confirmed ? "画像已确认" : "确认画像"}</Button>
    </>}
    {hmw && <>
      <DefinitionText label="我们如何……（HMW）" value={hmw.text} limit={220} disabled={disabled} onChange={text => editHmw({ text })} />
      <DefinitionText label="选择理由或待核实处" value={hmw.rationale} disabled={disabled} onChange={rationale => editHmw({ rationale })} />
      <fieldset disabled={disabled} className="space-y-2"><legend className="text-13 font-medium">关联已确认画像</legend>{personas.filter(item => !item.archived).map(item => <label className="flex items-center gap-2 text-13" key={item.id}><input type="checkbox" checked={hmw.personaIds.includes(item.id)} disabled={!item.confirmed && !hmw.personaIds.includes(item.id)} onChange={event => editHmw({ personaIds: toggleId(hmw.personaIds, item.id, event.currentTarget.checked) })} />{item.name || "未命名画像"}{!item.confirmed && " · 待确认"}</label>)}</fieldset>
      <DefinitionEvidence projectId={projectId} sourceFields={sourceFields} cards={cards} unconfirmedCards={unconfirmedCards} revision={revision} selected={hmw.cardIds} disabled={disabled} onChange={cardIds => editHmw({ cardIds })} />
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled || hmw.confirmed || !hmwReady} onClick={() => editHmw({ confirmed: true })}>{hmw.confirmed ? "HMW 已确认" : "确认 HMW"}</Button><Button type="button" size="sm" variant="outline" disabled={disabled || selected || !hmw.confirmed || !hmwReady} onClick={() => update(old => chooseAidtDefinitionHmw(old, entityId, availableCardIds))}>{selected ? "本轮选用" : "选为本轮 HMW"}</Button></div>
    </>}
    <details className="border-t border-border pt-2 text-12"><summary className="cursor-pointer">归档这项产物</summary><p className="my-2 text-muted-foreground">归档后停止本轮使用，现有历史版本和下游引用仍可回查。</p><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => persona ? editPersona({ archived: true }) : editHmw({ archived: true })}>确认归档</Button></details>
    <p className="text-12 text-muted-foreground">确认或归档后请保存到小组。创意发散承接本轮保存的 HMW 版本。</p>
  </section>;
}
