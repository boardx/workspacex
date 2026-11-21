"use client";

import * as React from "react";
import { AidtEntityCard } from "./aidt-entity-card";
import Link from "next/link";
import { ArrowUpRight, Palette, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useOptionalSession } from "@/components/session/session-provider";
import { createProject as createDesign } from "@/lib/live-design-workbench";
import { linkProjectResource, listProjectResources, type ProjectResourceItem } from "@/lib/live-project-resources";
import { aidtHref } from "../lib/project-aidt";
import { archiveAidtPrototypeCard, isAidtPrototypeHandoffConfirmed, readAidtPrototypeEntityDraft, updateAidtPrototypeCard } from "../lib/aidt-prototype-handoff";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

const emptyDraft: AidtUiStageDraft = { fields: {}, ideas: [], selectedIdeaId: "" };
type Action = { kind: "create" } | { kind: "edit" | "delete"; id: string };
type SaveDraft = (change: (draft: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
const titles = { create: "新建原型", edit: "编辑原型", delete: "删除原型" };

export function aidtPrototypeEntityHref(projectId: string, designId: string, tool?: "outcome" | "design", ideaRevision?: string | null) {
  const query = new URLSearchParams({ entity: designId });
  if (ideaRevision) query.set("ideaRevision", ideaRevision);
  if (tool === "design") query.set("resource", designId);
  return `${aidtHref(projectId, 5, { tool })}&${query}`;
}

type Props = {
  projectId: string;
  canWrite: boolean;
  ideaRevision?: string | null;
  draft?: AidtUiStageDraft;
  saveDraft?: SaveDraft;
  mutationBusy?: boolean;
};

export function AidtPrototypeDirectory(props: Props) {
  const session = useOptionalSession()?.session;
  const scope = JSON.stringify([props.projectId, session?.currentOrgId, session?.userId, session?.sessionToken]);
  return <PrototypeCards key={scope} {...props} />;
}

function PrototypeCards({ projectId, canWrite, ideaRevision, draft = emptyDraft, saveDraft, mutationBusy }: Props) {
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
    setAction(next);
    setName(title);
    setSaveError(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!action || !allowed || busy || !saveDraft || (action.kind !== "delete" && !name.trim())) return;
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
        if (!await saveDraft(old => updateAidtPrototypeCard(old, resource.id, name))) throw new Error("prototype card not saved");
        pending.current = null;
      } else {
        const id = action.id;
        if (!await saveDraft(old => action.kind === "delete" ? archiveAidtPrototypeCard(old, id) : updateAidtPrototypeCard(old, id, name))) throw new Error("prototype card not saved");
      }
      if (mounted.current) { setAction(null); reload(); }
    } catch { if (mounted.current) setSaveError(true); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <section aria-label="原型列表" className="space-y-4" data-testid="aidt-prototype-directory">
    <header className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">原型列表</h2>
      {canWrite && <Button type="button" variant="primary" disabled={!allowed || busy} onClick={() => open({ kind: "create" })}>
        <Plus className="size-4" aria-hidden />新建原型
      </Button>}
    </header>
    {listError ? <div role="alert"><p>暂时无法读取原型。</p><Button type="button" variant="outline" onClick={reload}>重试</Button></div>
      : !resources ? <p role="status">正在读取原型…</p>
      : !cards.length ? <p className="rounded-container border border-dashed border-border bg-muted px-5 py-10 text-center text-13">暂无原型</p>
      : <ul className="grid gap-3 sm:grid-cols-2">{cards.map(card => <AidtEntityCard key={card.id} entityId={card.id}>
        <Link href={aidtPrototypeEntityHref(projectId, card.id, undefined, ideaRevision)} aria-label={card.name}
          className="flex items-center gap-3 rounded-container p-4 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <Palette className="size-5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 break-words font-semibold">{card.name}<span className="block text-12 font-normal text-muted-foreground">{card.completed ? "已确认" : "未完成"}</span></span>
          <ArrowUpRight className="size-4 shrink-0" aria-hidden />
        </Link>
        {canWrite && <div className="flex justify-end gap-1 border-t border-border px-3 py-2">
          <Button type="button" variant="ghost" size="sm" disabled={!allowed || busy} aria-label={`编辑原型 ${card.name}`} onClick={() => open({ kind: "edit", id: card.id }, card.name)}><Pencil className="size-3.5" aria-hidden />编辑</Button>
          <Button type="button" variant="ghost" size="sm" disabled={!allowed || busy} aria-label={`删除原型 ${card.name}`} onClick={() => open({ kind: "delete", id: card.id })}><Trash2 className="size-3.5" aria-hidden />删除</Button>
        </div>}
      </AidtEntityCard>)}</ul>}
    {action && <Dialog open onOpenChange={open => { if (!open && !busy) setAction(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titles[action.kind]}</DialogTitle>
          <DialogDescription>{action.kind === "delete" ? `删除「${target?.name ?? "原型"}」卡片，已保存的 Design 版本与引用会保留。` : "在卡片中打开原生对话和 Design。"}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          {action.kind !== "delete" && <div className="space-y-2"><label htmlFor={nameId}>原型名称</label><Input id={nameId} value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} /></div>}
          {saveError && <p role="alert" className="text-13 text-destructive">原型卡片尚未保存，请重试。</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setAction(null)}>取消</Button>
            <Button type="submit" variant={action.kind === "delete" ? "destructive" : "primary"} disabled={!allowed || busy || (action.kind !== "delete" && !name.trim())}>{busy ? "正在保存…" : action.kind === "create" ? "创建原型" : action.kind === "delete" ? "确认删除" : "保存修改"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>}
  </section>;
}
