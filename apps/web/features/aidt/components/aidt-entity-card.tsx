"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

const prefix = "cardTags:";
const maxTags = 8;
const maxTagLength = 24;

export function readAidtEntityCardTags(fields: AidtUiStageDraft["fields"], id: string): string[] {
  try {
    const tags: unknown = JSON.parse(fields[prefix + id] ?? "[]");
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0 && tag.length <= maxTagLength).slice(0, maxTags) : [];
  } catch {
    return [];
  }
}

export function updateAidtEntityCardTags(draft: AidtUiStageDraft, id: string, tags: readonly string[]): AidtUiStageDraft {
  const key = prefix + id;
  const next = [...new Set(tags.map(tag => tag.trim()).filter(tag => tag && tag.length <= maxTagLength))].slice(0, maxTags);
  if (JSON.stringify(readAidtEntityCardTags(draft.fields, id)) === JSON.stringify(next)) return draft;
  if (!(key in draft.fields) && Object.keys(draft.fields).length >= 100) return draft;
  return { ...draft, fields: { ...draft.fields, [key]: JSON.stringify(next) } };
}

type CardTags = {
  draft: AidtUiStageDraft;
  labels: readonly string[];
  selected: string | null;
  canEdit: boolean;
  saveTags: (id: string, tags: readonly string[]) => Promise<boolean>;
};
const CardTagsContext = React.createContext<CardTags | null>(null);

export function AidtEntityCardDirectory({ draft, readOnly, saveDraft, children }: {
  draft: AidtUiStageDraft;
  readOnly: boolean;
  saveDraft: (mutation: (draft: AidtUiStageDraft) => AidtUiStageDraft) => Promise<boolean>;
  children: React.ReactNode;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const labels = [...new Set(Object.keys(draft.fields).flatMap(key =>
    key.startsWith(prefix) ? readAidtEntityCardTags(draft.fields, key.slice(prefix.length)) : [],
  ))].sort();
  const filter = selected && labels.includes(selected) ? selected : null;
  return <CardTagsContext.Provider value={{
    draft, labels, selected: filter, canEdit: !readOnly,
    saveTags: (id, tags) => saveDraft(previous => updateAidtEntityCardTags(previous, id, tags)),
  }}>
    {labels.length > 0 && <div className="flex flex-wrap gap-2" aria-label="筛选卡片标签" role="group">
      <Button size="sm" variant={filter === null ? "secondary" : "outline"} aria-pressed={filter === null} onClick={() => setSelected(null)}>全部</Button>
      {labels.map(label => <Button key={label} size="sm" variant={filter === label ? "secondary" : "outline"} aria-pressed={filter === label} onClick={() => setSelected(label)}>{label}</Button>)}
    </div>}
    {children}
  </CardTagsContext.Provider>;
}

export function AidtEntityCard({ entityId, className, children, useSharedTags = true }: {
  entityId: string;
  className?: string;
  children: React.ReactNode;
  useSharedTags?: boolean;
}) {
  const context = React.useContext(CardTagsContext);
  const tags = useSharedTags && context ? readAidtEntityCardTags(context.draft.fields, entityId) : [];
  const [editing, setEditing] = React.useState(false);
  if (useSharedTags && context?.selected && !tags.includes(context.selected)) return null;
  return <li data-testid="aidt-entity-card" className={cn("flex min-w-0 flex-col rounded-container border border-border bg-card text-card-foreground", className)}>
    {children}
    {tags.length > 0 && <ul aria-label="卡片标签" className="flex flex-wrap gap-1 px-4 pb-2 text-12">{tags.map(tag => <li key={tag} className="rounded-full bg-muted px-2 py-1">{tag}</li>)}</ul>}
    {useSharedTags && context?.canEdit && <div className="px-4 pb-2"><Button size="xs" variant="ghost" onClick={() => setEditing(true)}>编辑标签</Button></div>}
    {editing && context && <CardTagsDialog context={context} entityId={entityId} tags={tags} close={() => setEditing(false)} />}
  </li>;
}

function CardTagsDialog({ context, entityId, tags, close }: { context: CardTags; entityId: string; tags: string[]; close: () => void }) {
  const [draft, setDraft] = React.useState(tags);
  const [entry, setEntry] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const labels = [...new Set([...context.labels, ...draft])].sort();
  const added = entry.trim();
  const next = added && !draft.includes(added) && draft.length < maxTags ? [...draft, added] : draft;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      if (JSON.stringify(tags) === JSON.stringify(next) || await context.saveTags(entityId, next)) close();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) close(); }}>
    <DialogContent>
      <DialogTitle>编辑卡片标签</DialogTitle>
      <DialogDescription>点击选择本步标签，也可以新建标签。</DialogDescription>
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="可用标签">
          {labels.map(label => <Button key={label} type="button" size="sm" variant={draft.includes(label) ? "secondary" : "outline"}
            aria-pressed={draft.includes(label)} disabled={!draft.includes(label) && draft.length >= maxTags}
            onClick={() => setDraft(previous => previous.includes(label) ? previous.filter(item => item !== label) : [...previous, label])}>{label}</Button>)}
        </div>
        <Input value={entry} onChange={event => setEntry(event.currentTarget.value)} maxLength={maxTagLength} disabled={saving || draft.length >= maxTags} aria-label="新标签" />
        {failed && <p role="alert">标签未保存，核对小组版本后可重试。</p>}
        <Button type="submit" disabled={saving}>{saving ? "正在保存…" : "保存标签"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
