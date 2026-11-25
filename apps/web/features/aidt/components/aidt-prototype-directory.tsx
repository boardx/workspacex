"use client";

import { useAidtPrototypeIdeas } from "./aidt-prototype-handoff";
import { AidtCardSources, useAidtCreateTags } from "./aidt-card-create-fields";
import type { AidtSharedStage } from "../lib/live-aidt-stages";
import * as React from "react";
import { AidtCardFilters, AidtCardHeader, AidtCardStatus, AidtEntityCard, AidtNewEntityCardButton } from "./aidt-entity-card";
import Link from "next/link";
import { AIDT_BRAINSTORM_METHODS } from "@repo/contracts/aidt-brainstorm";
import { ArrowUpRight, Palette, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useOptionalSession } from "@/components/session/session-provider";
import { createProject as createDesign } from "@/lib/live-design-workbench";
import { linkProjectResource, listProjectResources, type ProjectResourceItem } from "@/lib/live-project-resources";
import { aidtHref } from "../lib/project-aidt";
import { pinAidtPrototypeInputs, updateAidtPrototypeEntityDraft, archiveAidtPrototypeCard, isAidtPrototypeHandoffConfirmed, readAidtPrototypeEntityDraft, updateAidtPrototypeCard } from "../lib/aidt-prototype-handoff";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

const emptyDraft: AidtUiStageDraft = { fields: {}, ideas: [], selectedIdeaId: "" };
type Action = { kind: "create" } | { kind: "edit" | "delete"; id: string };
type SaveDraft = (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
const titles = { create: "新建原型", edit: "编辑原型", delete: "删除原型" };

export function aidtPrototypeEntityHref(projectId: string, designId: string, tool?: "outcome" | "design", ideaRevision?: string | null, returnContext?: { revision: string; entityId: string }) {
  const query = new URLSearchParams({ entity: designId });
  if (ideaRevision) query.set("ideaRevision", ideaRevision);
  if (returnContext) { query.set("returnRevision", returnContext.revision); query.set("returnEntity", returnContext.entityId); }
  if (tool === "design") query.set("resource", designId);
  return `${aidtHref(projectId, 5, { tool })}&${query}`;
}

type Props = {
  projectId: string;
  canWrite: boolean;
  ideaRevision?: string | null;
  draft?: AidtUiStageDraft;
  saveDraft?: SaveDraft;
  sourceIdeas?: AidtSharedStage;
  onCreated?: (id: string) => void;
  mutationBusy?: boolean;
};

export function AidtPrototypeDirectory(props: Props) {
  const session = useOptionalSession()?.session;
  const scope = JSON.stringify([props.projectId, session?.currentOrgId, session?.userId, session?.sessionToken]);
  return <PrototypeCards key={scope} {...props} />;
}

function PrototypeCards({ projectId, canWrite, ideaRevision, draft = emptyDraft, saveDraft, mutationBusy, onCreated, sourceIdeas }: Props) {
  const tags = useAidtCreateTags(draft);
  const { adoptionSource: source, adoptionRounds: rounds } = useAidtPrototypeIdeas({ projectId, ideaRevision, draft: emptyDraft, workflow: { ideas: sourceIdeas, matchesServer: true } });
  const [roundId, setRoundId] = React.useState("");
  const [roundRevision, setRoundRevision] = React.useState<number | null>(null);
  const selectedRound = roundRevision === source?.revision ? rounds.find(round => round.stableId === roundId) : undefined;
  const choices = selectedRound?.ideas ?? [];
  const [selectedIdeas, selectIdeas] = React.useState<string[]>([]);
  const [resources, setResources] = React.useState<ProjectResourceItem[] | null>(null);
  const [listError, setListError] = React.useState(false);
  const [refresh, reload] = React.useReducer((count: number) => count + 1, 0);
  const [action, setAction] = React.useState<Action | null>(null);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState(false);
  const pending = React.useRef<{ id: string; linked: boolean } | null>(null);
  const mounted = React.useRef(true);
  const nameId = React.useId();
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => {
    let live = true;
    setListError(false);
    void listProjectResources(projectId).then(result => {
      if (live) setResources(result.items.filter(resource => resource.kind === "design"));
    }).catch(() => { if (live) setListError(true); });
    return () => { live = false; };
  }, [projectId, refresh]);

  const cards = (resources ?? []).flatMap(resource => {
    const fields = readAidtPrototypeEntityDraft(draft, resource.id);
    if (fields?.fields.prototypeArchived === "true") return [];
    return [{ id: resource.id, name: fields?.fields.prototypeCardTitle || resource.title, completed: Boolean(fields && isAidtPrototypeHandoffConfirmed(fields)) }];
  });
  const target = action && action.kind !== "create" ? cards.find(card => card.id === action.id) : null;
  const allowed = canWrite && Boolean(saveDraft) && !mutationBusy;
  function open(next: Action, title = "") {
    tags.reset(next.kind === "edit" ? next.id : undefined);
    setRoundId("");
    setRoundRevision(null);
    selectIdeas(next.kind === "create" ? [] : choices.map(idea => idea.id));
    setAction(next);
    setName(title);
    setSaveError(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!action || !allowed || busy || !saveDraft || (action.kind !== "delete" && !name.trim())) return;
    if (action.kind === "create" && (!source || !selectedRound || !selectedIdeas.length || !selectedIdeas.every(id => choices.some(idea => idea.id === id)))) return;
    setBusy(true);
    setSaveError(false);
    try {
      if (action.kind === "create") {
        if (!pending.current) {
          const { project } = await createDesign({ name: name.trim(), template: "ui" });
          if (!mounted.current) return;
          pending.current = { id: project.id, linked: false };
        }
        const resource = pending.current;
        if (!resource.linked) {
          try {
            await linkProjectResource({ projectId, kind: "design", resourceId: resource.id });
          } catch (error) {
            if (!mounted.current) return;
            const linked = await listProjectResources(projectId);
            if (!linked.items.some(item => item.kind === "design" && item.id === resource.id)) throw error;
          }
          if (!mounted.current) return;
          resource.linked = true;
        }
        if (!await saveDraft(old => {
          const named = updateAidtPrototypeCard(old, resource.id, name);
          if (named === old || !source || !selectedRound || !selectedIdeas.length) return old;
          const linked = updateAidtPrototypeEntityDraft(named, resource.id, entity => pinAidtPrototypeInputs(entity, source, selectedIdeas, selectedRound.stableId));
          return tags.apply(linked, resource.id);
        })) throw new Error("prototype card not saved");
        pending.current = null;
        onCreated?.(resource.id);
      } else {
        const id = action.id;
        if (!await saveDraft(old => action.kind === "delete" ? archiveAidtPrototypeCard(old, id) : tags.apply(updateAidtPrototypeCard(old, id, name), id))) throw new Error("prototype card not saved");
      }
      if (mounted.current) { setAction(null); reload(); }
    } catch { if (mounted.current) setSaveError(true); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <section aria-label="原型列表" className="space-y-4" data-testid="aidt-prototype-directory">
    <header className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">原型列表</h2>
      {canWrite && <AidtNewEntityCardButton disabled={!allowed || busy} onClick={() => open({ kind: "create" })} />}
    </header>
    <AidtCardFilters />
    {listError ? <div role="alert"><p>暂时无法读取原型。</p><Button type="button" variant="outline" onClick={reload}>重试</Button></div>
      : !resources ? <p role="status">正在读取原型…</p>
      : !cards.length ? <p className="rounded-container border border-dashed border-border bg-muted px-5 py-10 text-center text-13">暂无原型</p>
      : <ul className="grid gap-4 sm:grid-cols-2">{cards.map(card => <AidtEntityCard key={card.id} entityId={card.id}
        action={<Button asChild variant="primary" size="sm"><Link href={aidtPrototypeEntityHref(projectId, card.id, undefined, ideaRevision)} aria-label={card.name}><Palette className="size-4" aria-hidden />打开原型<ArrowUpRight className="size-3" aria-hidden /></Link></Button>}
        management={canWrite && <>
          <Button type="button" variant="outline" size="sm" disabled={!allowed || busy} aria-label={`编辑原型 ${card.name}`} onClick={() => open({ kind: "edit", id: card.id }, card.name)}><Pencil aria-hidden className="size-4" />改名与标签</Button>
          <Button type="button" variant="outline" size="sm" disabled={!allowed || busy} aria-label={`删除原型 ${card.name}`} onClick={() => open({ kind: "delete", id: card.id })}><Trash2 aria-hidden className="size-4" /></Button>
        </>}>
        <AidtCardHeader label="原型"><AidtCardStatus confirmed={card.completed}>{card.completed ? "已确认" : "待确认"}</AidtCardStatus></AidtCardHeader>
        <h3 className="break-words text-16 font-semibold">{card.name}</h3>
      </AidtEntityCard>)}</ul>}
    {action && <Dialog open onOpenChange={open => { if (!open && !busy) setAction(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titles[action.kind]}</DialogTitle>
          <DialogDescription>{action.kind === "delete" ? `删除「${target?.name ?? "原型"}」卡片，已保存的 Design 版本与引用会保留。` : "在卡片中打开原生对话和 Design。"}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          {action.kind !== "delete" && <div className="space-y-2"><label htmlFor={nameId}>原型名称</label><Input id={nameId} value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} /></div>}
          {action.kind !== "delete" && tags.field}
          {action.kind === "create" && <><label className="block text-13">已确认 Ideation 列表
            <select aria-label="已确认 Ideation 列表" className="mt-1 block w-full rounded-md border border-border bg-background p-2" value={selectedRound?.stableId ?? ""} disabled={busy}
              onChange={event => { setRoundId(event.target.value); setRoundRevision(source?.revision ?? null); selectIdeas([]); }}><option value="">选择一个已确认列表</option>
              {rounds.map(round => <option key={round.stableId} value={round.stableId}>{round.title} · {AIDT_BRAINSTORM_METHODS[round.method]} · 第4步 V{source?.revision}</option>)}
            </select></label>
            {selectedRound && <p className="text-12 text-muted-foreground">固定 HMW：第3步 V{selectedRound.source.revision} · {selectedRound.source.text}</p>}
            <fieldset disabled={busy}><AidtCardSources label="来源点子" options={choices} selected={selectedIdeas} select={selectIdeas} /></fieldset>
            <p className="text-12 text-muted-foreground">选择一项或多项，按本轮原型需要组合。当前已选 {selectedIdeas.length} 项。</p></>}
          {saveError && <p role="alert" className="text-13 text-destructive">原型卡片尚未保存，请重试。</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>取消</Button>
            <Button type="submit" variant={action.kind === "delete" ? "destructive" : "primary"} disabled={!allowed || busy || (action.kind === "create" && (!selectedRound || !selectedIdeas.length || !selectedIdeas.every(id => choices.some(idea => idea.id === id)))) || (action.kind !== "delete" && !name.trim())}>{busy ? "正在保存…" : action.kind === "create" ? "创建原型" : action.kind === "delete" ? "确认删除" : "保存修改"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>}
  </section>;
}
