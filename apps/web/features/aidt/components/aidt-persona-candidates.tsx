"use client";

import * as React from "react";
import { canvas } from "@repo/contracts";
import { aidtPersonaCanvasKey } from "@repo/contracts/aidt-persona-canvas";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/api-client";
import type { CanvasTemplate } from "@/lib/live-canvas";
import { AIDT_DEFINITION_EVIDENCE_LIMIT, AIDT_DEFINITION_ITEM_LIMIT } from "../lib/aidt-definition";
import {
  addAidtPersonaCandidate, aidtPersonaGenerationPrompt, collectAidtPersonaCandidates, selectAidtPersonaTemplate,
  type AidtPersonaCandidateHost, type AidtPersonaCanvasCandidate,
} from "../lib/aidt-persona-candidates";
import { loadAidtAuthorizedDefinitionEvidence, aidtDefinitionCardTextIdentity, sameAidtDefinitionSyntheticSources, AIDT_DEFINITION_SYNTHETIC_NOTICE } from "../lib/aidt-definition-current-evidence";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtPersonaCanvasPreview } from "./aidt-persona-canvas-preview";

export type AidtPersonaCandidatesProps = {
  projectId: string; draft: AidtUiStageDraft; savedDraft?: AidtUiStageDraft;
  cards: readonly AidtDiscoveryCardDraft[]; revision?: number; definitionRevision?: number; disabled: boolean;
  host: AidtPersonaCandidateHost;
  initialOpen?: boolean;
  onCreate?: (id: string, change: (old: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
};

export function AidtPersonaCandidates(props: AidtPersonaCandidatesProps) {
  const session = useOptionalSession()?.session;
  const identity = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, props.projectId, props.revision, props.definitionRevision, props.cards.map(aidtDefinitionCardTextIdentity)]);
  const lifecycle = React.useRef({ identity, generation: 0 });
  if (lifecycle.current.identity !== identity) lifecycle.current = { identity, generation: lifecycle.current.generation + 1 };
  return <PersonaCandidates key={lifecycle.current.generation} {...props} />;
}

function PersonaCandidates(props: AidtPersonaCandidatesProps) {
  const session = useOptionalSession()?.session;
  const orgId = session?.currentOrgId;
  const token = session?.sessionToken;
  const [open, setOpen] = React.useState(Boolean(props.initialOpen));
  const [template, setTemplate] = React.useState<CanvasTemplate | null>(null);
  const [loadingTemplate, setLoadingTemplate] = React.useState(false);
  const [selectedSources, setSelectedSources] = React.useState<string[]>([]);
  const [requested, setRequested] = React.useState(1);
  const [candidates, setCandidates] = React.useState<AidtPersonaCanvasCandidate[]>([]);
  const [selected, setSelected] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState("");
  const [templateAttempt, retryTemplate] = React.useReducer(value => value + 1, 0);
  const generation = React.useRef(0);
  const running = React.useRef(false);
  const scope = JSON.stringify([orgId, session?.userId, token, props.projectId, props.revision, props.definitionRevision, props.cards.map(aidtDefinitionCardTextIdentity)]);
  const latestScope = React.useRef(scope); latestScope.current = scope;
  React.useEffect(() => {
    generation.current += 1;
    setSelectedSources([]); setCandidates([]); setSelected(""); setBusy(false); running.current = false;
    return () => { generation.current += 1; };
  }, [scope]);
  React.useEffect(() => {
    setTemplate(null);
    if (!open || !orgId || !token) return;
    const cancellation = new AbortController();
    setLoadingTemplate(true); setFailure("");
    const operation = canvas.operations.listTemplates;
    void apiRequest<unknown>(operation.path, { method: operation.method, query: { orgId, filter: "published" }, sessionToken: token, signal: cancellation.signal })
      .then(raw => {
        if (cancellation.signal.aborted) return;
        const found = selectAidtPersonaTemplate(operation.out.parse(raw).templates);
        setTemplate(found);
        if (!found) setFailure("后台没有可用的已发布用户画像模板。你仍可手动新建画像。");
      }).catch(() => {
        if (!cancellation.signal.aborted) setFailure("暂时无法读取后台画像模板，请重试或手动新建画像。");
      }).finally(() => { if (!cancellation.signal.aborted) setLoadingTemplate(false); });
    return () => cancellation.abort();
  }, [open, orgId, token, templateAttempt]);
  const chooseSources = (ids: string[]) => { if (ids.length > AIDT_DEFINITION_EVIDENCE_LIMIT) return; setSelectedSources(ids); setCandidates([]); setSelected(""); setFailure(""); };
  const active = candidates.find(item => item.id === selected);
  const imported = active ? Boolean(props.savedDraft?.fields[aidtPersonaCanvasKey(active.id)]) : false;
  const canGenerate = !props.disabled && !busy && Boolean(template && orgId && token && props.revision && selectedSources.length);

  async function generate() {
    if (!canGenerate || !template || !orgId || !props.revision || running.current) return;
    running.current = true;
    const requestGeneration = ++generation.current;
    const requestScope = scope;
    const source = { orgId, projectId: props.projectId, revision: props.revision, definitionRevision: props.definitionRevision, cardIds: [...selectedSources] };
    const cards = props.cards.filter(card => selectedSources.includes(card.id));
    if (cards.length !== selectedSources.length) { running.current = false; setFailure("所选材料已变化，请重新选择访谈。"); return; }
    setBusy(true); setFailure(""); setCandidates([]); setSelected("");
    try {
      const result = await props.host.generate({ kind: "persona", source, template, cards, prompt: aidtPersonaGenerationPrompt(template, cards, requested) });
      const values = await collectAidtPersonaCandidates({ source: { ...source, syntheticCardIds: result.syntheticCardIds }, template, ...result });
      if (generation.current !== requestGeneration || latestScope.current !== requestScope) return;
      setCandidates(values);
      if (!values.length) setFailure("本次回复尚未形成完整的画像画布候选。请在对话中补充或修订；也可以手动创建，已有材料仍保留。");
    } catch {
      if (generation.current === requestGeneration && latestScope.current === requestScope) setFailure("画像生成未完成。请检查本步对话的实际状态后重试，或手动创建。");
    } finally {
      if (generation.current === requestGeneration && latestScope.current === requestScope) { running.current = false; setBusy(false); }
    }
  }
  async function importSelected() {
    if (!active || busy || running.current || props.disabled || !props.onCreate || imported || active.source.orgId !== orgId || active.source.projectId !== props.projectId) return;
    if (!token) return;
    running.current = true; setBusy(true); setFailure("");
    const requestScope = scope;
    try {
      const evidence = await loadAidtAuthorizedDefinitionEvidence({ projectId: props.projectId, revision: active.source.revision,
        sessionToken: token, cardIds: active.source.cardIds });
      if (latestScope.current !== requestScope) return;
      if (!sameAidtDefinitionSyntheticSources(active.source.syntheticCardIds, evidence.syntheticCardIds)) throw new Error("访谈材料性质已变化，请重新生成候选。");
      const change = (draft: AidtUiStageDraft) => addAidtPersonaCandidate(draft, active, evidence.cards, evidence.revision);
      if (change(props.draft) === props.draft) throw new Error("材料、确认状态或可保存空间已变化。");
      const success = await props.onCreate(active.id, change);
      if (latestScope.current !== requestScope) return;
      if (success) setOpen(false);
      else setFailure("加入尚未确认，请核对共享保存状态后重试；不会创建第二份画像。");
    } catch { if (latestScope.current === requestScope) setFailure("加入尚未确认。候选仍保留，请核对共享保存状态后重试。"); }
    finally { if (latestScope.current === requestScope) { running.current = false; setBusy(false); } }
  }

  return <>
    <Button type="button" variant="outline" disabled={props.disabled} onClick={() => setOpen(true)}>AI 综合用户画像</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] max-w-5xl overflow-y-auto">
        <DialogTitle>从证据形成画像</DialogTitle>
        <DialogDescription>先比较，再选择一份加入。加入后仍需小组核对与确认。</DialogDescription>
        {loadingTemplate && <p role="status">正在读取后台用户画像模板…</p>}
        {template && <p className="text-12 text-muted-foreground">{template.displayName} · V{template.version} · 第 2 步 V{props.revision}</p>}
        {!candidates.length && <div className="space-y-4">
          <fieldset disabled={busy || props.disabled} className="space-y-2"><legend className="text-13 font-medium">使用哪些访谈发现？</legend>
            {props.cards.map(card => <label key={card.id} className="flex items-start gap-2 text-13"><input type="checkbox" checked={selectedSources.includes(card.id)} onChange={event => chooseSources(event.target.checked ? [...selectedSources, card.id] : selectedSources.filter(id => id !== card.id))} /><span>{card.participantCode} · {card.headline || "人物发现"}</span></label>)}
          </fieldset>
          <label className="block max-w-48 text-13">候选数量<Input type="number" min={1} max={AIDT_DEFINITION_ITEM_LIMIT} disabled={busy} value={requested} onChange={event => setRequested(Math.max(1, Math.min(AIDT_DEFINITION_ITEM_LIMIT, Number(event.target.value) || 1)))} /></label>
          <p className="text-12 text-muted-foreground">材料只支持一种画像时，保留一种；未知信息不补造。</p>
          <Button type="button" disabled={!canGenerate} onClick={() => void generate()}>{busy ? "正在生成…" : "生成画像候选"}</Button>
        </div>}
        {candidates.length > 0 && <div className="space-y-4">
          <fieldset disabled={busy || props.disabled} className="flex flex-wrap gap-3"><legend className="mb-2 text-13 font-medium">选择要预览的画像</legend>
            {candidates.map(candidate => <label key={candidate.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-3 text-13"><input name="aidt-persona-candidate" type="radio" value={candidate.id} checked={selected === candidate.id} onChange={() => setSelected(candidate.id)} />{candidate.proposal.name || "未命名画像"}</label>)}
          </fieldset>
          {active && <><AidtPersonaCanvasPreview key={active.id} template={active.template} code={active.code} sourceNotice={active.source.syntheticCardIds?.length ? AIDT_DEFINITION_SYNTHETIC_NOTICE : undefined} onCodeChange={busy || imported ? undefined : code => setCandidates(values => values.map(candidate => candidate.id === active.id ? { ...candidate, code } : candidate))} /><p className="text-12 text-muted-foreground">可双击画布中的文字修订；保存前核对摘要与画布是否一致。</p>
            <details className="space-y-3 text-13"><summary className="cursor-pointer font-medium">核对画像摘要</summary>
              {([['name', '画像名称'], ['situation', '情境'], ['behavior', '行为'], ['need', '需求'], ['limits', '仍待核实']] as const).map(([field, label]) => <label key={field} className="block">{label}<Textarea value={active.proposal[field] ?? ""} maxLength={field === "name" ? 220 : 400} disabled={busy || imported} onChange={event => setCandidates(values => values.map(candidate => candidate.id === active.id ? { ...candidate, proposal: { ...candidate.proposal, [field]: event.target.value } } : candidate))} /></label>)}
            </details></>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => { setCandidates([]); setSelected(""); }}>重新选择来源</Button><Button type="button" disabled={!active || busy || props.disabled || !props.onCreate || imported} onClick={() => void importSelected()}>{imported ? "已加入画像" : busy ? "正在加入…" : "将此画像加入产物"}</Button></div>
        </div>}
        {failure && <p role="alert" className="text-13">{failure}</p>}
        {!template && !loadingTemplate && <Button type="button" variant="outline" disabled={busy} onClick={retryTemplate}>重试读取模板</Button>}
        <div className="flex justify-end"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{busy ? "查看对话" : "关闭"}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
