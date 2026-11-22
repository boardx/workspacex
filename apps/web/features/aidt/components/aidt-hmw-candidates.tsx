"use client";

import * as React from "react";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AIDT_DEFINITION_EVIDENCE_LIMIT, AIDT_DEFINITION_ITEM_LIMIT, readAidtDefinition } from "../lib/aidt-definition";
import { addAidtHmwCandidate, aidtHmwCandidateSourceKey, aidtHmwGenerationPrompt, collectAidtHmwCandidates, type AidtHmwCandidate } from "../lib/aidt-hmw-candidates";
import type { AidtPersonaCandidatesProps } from "./aidt-persona-candidates";
import { loadAidtAuthorizedDefinitionEvidence, aidtDefinitionCardTextIdentity, sameAidtDefinitionSyntheticSources, AIDT_DEFINITION_SYNTHETIC_NOTICE } from "../lib/aidt-definition-current-evidence";
import { previewAidtText } from "../lib/aidt-print-preview";

export function AidtHmwCandidates(props: AidtPersonaCandidatesProps) {
  const session = useOptionalSession()?.session;
  const identity = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, props.projectId, props.revision, props.definitionRevision, props.cards.map(aidtDefinitionCardTextIdentity)]);
  const lifecycle = React.useRef({ identity, generation: 0 });
  if (lifecycle.current.identity !== identity) lifecycle.current = { identity, generation: lifecycle.current.generation + 1 };
  return <HmwCandidates key={lifecycle.current.generation} {...props} />;
}

function HmwCandidates(props: AidtPersonaCandidatesProps) {
  const session = useOptionalSession()?.session;
  const orgId = session?.currentOrgId;
  const [open, setOpen] = React.useState(Boolean(props.initialOpen));
  const [selectedCards, setSelectedCards] = React.useState<string[]>([]);
  const [selectedPersonas, setSelectedPersonas] = React.useState<string[]>([]);
  const [requested, setRequested] = React.useState(1);
  const [candidates, setCandidates] = React.useState<AidtHmwCandidate[]>([]);
  const [selected, setSelected] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState("");
  const running = React.useRef(false);
  const request = React.useRef(0);
  const scope = JSON.stringify([orgId, session?.userId, session?.sessionToken, props.projectId, props.revision, props.definitionRevision, props.cards.map(aidtDefinitionCardTextIdentity)]);
  const latest = React.useRef(scope); latest.current = scope;
  const personas = readAidtDefinition(props.savedDraft?.fields ?? {}).personas.filter(item => item.confirmed && !item.archived && item.cardIds.length > 0 && item.cardIds.every(id => props.cards.some(card => card.id === id)));
  React.useEffect(() => {
    request.current += 1; running.current = false; setBusy(false); setCandidates([]); setSelected(""); setSelectedCards([]); setSelectedPersonas([]);
    return () => { request.current += 1; };
  }, [scope]);
  const active = candidates.find(candidate => candidate.id === selected);
  const imported = active ? Boolean(props.savedDraft?.fields[aidtHmwCandidateSourceKey(active.id)]) : false;
  const printKey = JSON.stringify([scope, selected, active?.proposal.text, active?.proposal.rationale]);
  const printScope = React.useRef(printKey); printScope.current = printKey;
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const canGenerate = !props.disabled && !busy && Boolean(orgId && session?.sessionToken && props.revision && selectedCards.length && selectedPersonas.length);
  const choose = (values: string[], setter: (values: string[]) => void) => { if (values.length > AIDT_DEFINITION_EVIDENCE_LIMIT) return; setter(values); setCandidates([]); setSelected(""); setFailure(""); };
  async function generate() {
    if (!canGenerate || !orgId || !props.revision || running.current) return;
    const selectedProfiles = personas.filter(persona => selectedPersonas.includes(persona.id));
    const cardIds = [...new Set([...selectedCards, ...selectedProfiles.flatMap(persona => persona.cardIds)])];
    const cards = props.cards.filter(card => cardIds.includes(card.id));
    if (cards.length !== cardIds.length || cardIds.length > AIDT_DEFINITION_EVIDENCE_LIMIT || selectedProfiles.length !== selectedPersonas.length) { setFailure("所选材料或画像已变化，请重新选择。"); return; }
    const source = { orgId, projectId: props.projectId, revision: props.revision, definitionRevision: props.definitionRevision, cardIds };
    const id = ++request.current; const requestScope = scope;
    running.current = true; setBusy(true); setFailure("");
    try {
      const result = await props.host.generate({ kind: "hmw", source, cards, personaIds: [...selectedPersonas], prompt: aidtHmwGenerationPrompt(cards, selectedProfiles, requested) });
      const values = await collectAidtHmwCandidates({ source: { ...source, syntheticCardIds: result.syntheticCardIds }, personaIds: [...selectedPersonas], ...result });
      if (request.current !== id || latest.current !== requestScope) return;
      setCandidates(values); setSelected("");
      if (!values.length) setFailure("本次回复还没有完整HMW候选。可继续在对话中修订，或手动创建问题。");
    } catch { if (request.current === id && latest.current === requestScope) setFailure("HMW生成未完成，请核对本步对话状态，已有材料仍保留。"); }
    finally { if (request.current === id && latest.current === requestScope) { running.current = false; setBusy(false); } }
  }
  async function apply() {
    if (!active || busy || running.current || props.disabled || !props.onCreate || imported || active.source.orgId !== orgId || active.source.projectId !== props.projectId) return;
    if (!session?.sessionToken) return;
    const requestScope = scope; running.current = true; setBusy(true); setFailure("");
    try {
      const evidence = await loadAidtAuthorizedDefinitionEvidence({ projectId: props.projectId, revision: active.source.revision,
        sessionToken: session.sessionToken, cardIds: active.source.cardIds });
      if (latest.current !== requestScope) return;
      if (!sameAidtDefinitionSyntheticSources(active.source.syntheticCardIds, evidence.syntheticCardIds)) throw new Error("访谈材料性质已变化，请重新生成候选。");
      const change = (draft: typeof props.draft) => addAidtHmwCandidate(draft, active, evidence.cards, evidence.revision);
      if (change(props.draft) === props.draft) throw new Error("来源或画像确认状态已变化。");
      const saved = await props.onCreate(active.id, change);
      if (latest.current === requestScope) { if (saved) setOpen(false); else setFailure("加入尚未确认。请核对共享保存状态后重试，不会创建第二份问题。"); }
    } catch { if (latest.current === requestScope) setFailure("加入尚未确认，候选仍保留，请核对共享保存状态后重试。"); }
    finally { if (latest.current === requestScope) { running.current = false; setBusy(false); } }
  }
  return <>
    <Button type="button" variant="outline" disabled={props.disabled || !personas.length} onClick={() => setOpen(true)}>AI 构思 HMW</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
      <DialogTitle>找到值得继续探索的问题</DialogTitle>
      <DialogDescription>比较候选，选一份并用自己的话修改。加入后仍需小组确认。</DialogDescription>
      {!candidates.length && <div className="space-y-4">
        <fieldset disabled={busy} className="space-y-2"><legend className="text-13 font-medium">来源画像</legend>{personas.map(persona => <label key={persona.id} className="flex gap-2 text-13"><input type="checkbox" checked={selectedPersonas.includes(persona.id)} onChange={event => choose(event.target.checked ? [...selectedPersonas, persona.id] : selectedPersonas.filter(id => id !== persona.id), setSelectedPersonas)} />{persona.name}</label>)}</fieldset>
        <fieldset disabled={busy} className="space-y-2"><legend className="text-13 font-medium">来源访谈</legend>{props.cards.map(card => <label key={card.id} className="flex gap-2 text-13"><input type="checkbox" checked={selectedCards.includes(card.id)} onChange={event => choose(event.target.checked ? [...selectedCards, card.id] : selectedCards.filter(id => id !== card.id), setSelectedCards)} />{card.participantCode} · {card.headline}</label>)}</fieldset>
        <label className="block max-w-48 text-13">候选数量<Input type="number" min={1} max={AIDT_DEFINITION_ITEM_LIMIT} disabled={busy} value={requested} onChange={event => setRequested(Math.max(1, Math.min(AIDT_DEFINITION_ITEM_LIMIT, Number(event.target.value) || 1)))} /></label>
        <Button type="button" disabled={!canGenerate} onClick={() => void generate()}>{busy ? "正在构思…" : "生成 HMW 候选"}</Button>
      </div>}
      {candidates.length > 0 && <div className="space-y-4"><fieldset disabled={busy} className="space-y-2"><legend className="text-13 font-medium">选择一个方向</legend>{candidates.map(candidate => <label key={candidate.id} className="flex gap-2 rounded-lg border border-border p-3 text-13"><input name="aidt-hmw-candidate" type="radio" checked={selected === candidate.id} onChange={() => setSelected(candidate.id)} />{candidate.proposal.text}</label>)}</fieldset>
        {active?.source.syntheticCardIds?.length ? <p className="text-12 text-muted-foreground">{AIDT_DEFINITION_SYNTHETIC_NOTICE}</p> : null}
        {active && <div className="space-y-3"><label className="block text-13">我们如何……<Textarea value={active.proposal.text} maxLength={220} disabled={busy || imported} onChange={event => setCandidates(values => values.map(candidate => candidate.id === active.id ? { ...candidate, proposal: { ...candidate.proposal, text: event.target.value } } : candidate))} /></label><label className="block text-13">为什么选择这个问题<Textarea value={active.proposal.rationale ?? ""} maxLength={400} disabled={busy || imported} onChange={event => setCandidates(values => values.map(candidate => candidate.id === active.id ? { ...candidate, proposal: { ...candidate.proposal, rationale: event.target.value } } : candidate))} /></label></div>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={!active || busy} onClick={() => {
          if (!active) return;
          const captured = printKey;
          void previewAidtText(`${active.source.syntheticCardIds?.length ? AIDT_DEFINITION_SYNTHETIC_NOTICE + "\n\n" : ""}${active.proposal.text}\n\n选择理由：${active.proposal.rationale || "待补充"}\n\n来源：第2步 V${props.revision}；AI候选，尚未作为小组结论确认。`, `HMW 候选 · 访谈 V${props.revision}`, { isCurrent: () => alive.current && printScope.current === captured, defaultPaper: "A4" }).catch(() => { if (alive.current && printScope.current === captured) setFailure("打印预览未打开，请重试。"); });
        }}>打印问题</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setCandidates([]); setSelected(""); }}>重新选择来源</Button><Button type="button" disabled={!active?.proposal.text.trim() || busy || props.disabled || !props.onCreate || imported} onClick={() => void apply()}>{imported ? "已加入问题" : busy ? "正在加入…" : "将此问题加入产物"}</Button></div>
      </div>}
      {failure && <p role="alert" className="text-13">{failure}</p>}
      <div className="flex justify-end"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{busy ? "查看对话" : "关闭"}</Button></div>
    </DialogContent></Dialog>
  </>;
}
