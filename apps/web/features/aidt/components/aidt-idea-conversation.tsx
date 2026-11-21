"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  allAidtIdeasConfirmed, canConfirmAidtIdeaText, confirmAidtIdeaFromChat, getAidtIdeaChatProposal, ideaChatEntity,
  readAidtIdeaChatProposal, sameSavedAidtIdeaConfirmation, saveAidtIdeaChatProposal,
} from "../lib/aidt-idea-chat";
import { activeAidtIdeaDraft, canConfirmAidtIdeaSheets, invalidateAidtIdeaSheets, readAidtIdeaHandoff, readAidtIdeaHmwSource } from "../lib/aidt-idea-handoff";
import { AIDT_IDEA_CLASSIFICATION_FIELDS } from "../lib/aidt-idea-classification";
import { isAidtResearchImage, parseAidtResearchMaterial, researchMaterialKey } from "../lib/aidt-research-material-reference";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { AidtIdeaClassification } from "./aidt-idea-classification";
import { AidtIdeaHmw, type AidtIdeaHandoffContext } from "./aidt-idea-handoff";
import { AidtResearchMaterialControl } from "./aidt-research-material";

type DraftChange = (old: AidtUiStageDraft) => AidtUiStageDraft;
type Turn = { id: string; role: string; content?: unknown };

export function AidtIdeaConversation({ projectId, entityId, draft, savedDraft, readOnly, update, requestSave, messages, loading, running, handoff, onProposalReady }: {
  projectId: string; entityId: string; draft: AidtUiStageDraft; savedDraft?: AidtUiStageDraft; readOnly: boolean;
  update: (change: DraftChange) => void; requestSave: () => void; messages: readonly Turn[]; loading: boolean; running: boolean;
  handoff?: AidtIdeaHandoffContext; onProposalReady?: () => void;
}) {
  const item = ideaChatEntity(draft, entityId);
  const saved = sameSavedAidtIdeaConfirmation(draft, savedDraft, entityId);
  const proposal = React.useMemo(() => readAidtIdeaChatProposal(messages), [messages]);
  const stored = getAidtIdeaChatProposal(draft, entityId);
  const [edited, setEdited] = React.useState<{ base: string; value: string } | null>(null);
  const [revising, setRevising] = React.useState(false);
  const [chosen, setChosen] = React.useState<string[] | null>(null);
  const text = proposal?.description ?? stored?.description ?? item?.description ?? "";
  const base = JSON.stringify([entityId, proposal?.messageId ?? stored?.messageId, text]);
  const description = edited?.base === base ? edited.value : text;
  React.useEffect(() => {
    if (readOnly || loading || running || !proposal || (stored?.messageId === proposal.messageId && stored.description === proposal.description)) return;
    update(old => saveAidtIdeaChatProposal(old, entityId, proposal));
    onProposalReady?.();
  }, [entityId, loading, running, readOnly, onProposalReady, proposal, stored?.messageId, stored?.description, update]);

  if (readOnly || !item || loading) return null;
  const active = activeAidtIdeaDraft(draft);
  const allConfirmed = allAidtIdeasConfirmed(draft);
  const sheetIds = active.ideas.filter(idea => {
    const reference = parseAidtResearchMaterial(draft.fields[researchMaterialKey("idea", idea.id)]);
    return reference?.projectId === projectId && isAidtResearchImage(reference);
  }).map(idea => idea.id);
  const sheetsReady = allConfirmed && canConfirmAidtIdeaSheets(draft, sheetIds, projectId);
  const selected = (chosen ?? readAidtIdeaHandoff(draft, projectId)?.selectedIds ?? []).filter(id => sheetIds.includes(id));
  const savedHandoff = savedDraft && allAidtIdeasConfirmed(savedDraft) && readAidtIdeaHandoff(savedDraft, projectId);
  const imageKey = researchMaterialKey("idea", entityId);
  return <section aria-label="点子确认" className="space-y-3 rounded-container border border-border bg-card p-3">
    {handoff && !readAidtIdeaHmwSource(draft) && <AidtIdeaHmw context={handoff} draft={draft} readOnly={false} update={update} />}
    {!running && (!saved || revising) && <>
      <label className="block space-y-1 text-13">点子描述草稿
        <Textarea value={description} maxLength={2000} rows={3} onChange={event => setEdited({ base, value: event.currentTarget.value })} placeholder="两三句说明你想做什么、怎样帮助用户" />
      </label>
      <details><summary className="cursor-pointer text-13">添加描述单配图</summary>
        <AidtResearchMaterialControl projectId={projectId} imagesOnly label="点子配图" value={parseAidtResearchMaterial(draft.fields[imageKey])}
          selectionScope={entityId} onChange={reference => update(old => invalidateAidtIdeaSheets({ ...old,
            fields: { ...old.fields, [imageKey]: reference ? JSON.stringify(reference) : "" },
          }))} />
      </details>
      <Button type="button" variant="primary" disabled={!canConfirmAidtIdeaText(description)} onClick={() => {
        update(old => confirmAidtIdeaFromChat(old, entityId, description));
        setRevising(false);
        requestSave();
      }}>确认点子产物</Button>
    </>}
    {saved && !revising && <div className="flex items-center justify-between gap-2"><span className="text-13">点子已确认</span>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setEdited({ base, value: item.description }); setRevising(true); }}>改写描述</Button>
    </div>}
    {allConfirmed && <details className="space-y-2">
      <summary className="cursor-pointer text-13 font-medium">确认分类与原型交接</summary>
      <AidtIdeaClassification draft={active} onChange={next => update(old => invalidateAidtIdeaSheets({ ...old, fields: {
        ...old.fields, ...Object.fromEntries(Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map(key => [key, next.fields[key] ?? ""])),
      } }))} />
      {sheetsReady ? <fieldset className="space-y-2">
        <legend className="text-13 font-medium">选择带入原型的点子</legend>
        {active.ideas.filter(idea => sheetIds.includes(idea.id)).map(idea => <label className="flex items-center gap-2 text-13" key={idea.id}>
          <input type="checkbox" checked={selected.includes(idea.id)} onChange={event => setChosen(event.currentTarget.checked ? [...selected, idea.id] : selected.filter(id => id !== idea.id))} />{idea.title}
        </label>)}
        <Button type="button" variant="primary" disabled={!selected.length} onClick={() => {
          update(old => ({ ...old, fields: { ...old.fields, ideaSheetIds: JSON.stringify(sheetIds), ideaHandoffIds: JSON.stringify(selected) } }));
          requestSave();
        }}>确认完成本阶段</Button>
      </fieldset> : <p className="text-12 text-muted-foreground">确认分类，并补齐至少三份带图描述单。</p>}
    </details>}
    {savedHandoff && handoff?.matchesServer && handoff.savedRevision && (!chosen || selected.length === savedHandoff.selectedIds.length && savedHandoff.selectedIds.every(id => selected.includes(id))) && <Button asChild variant="primary">
      <Link href={handoff.nextHref}>进入原型制作</Link>
    </Button>}
  </section>;
}
