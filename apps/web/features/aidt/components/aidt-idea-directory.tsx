"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { archiveAidtIdea, createAidtIdea, readAidtIdeaDirectory, renameAidtIdea } from "../lib/aidt-idea-handoff";
import { isAidtIdeaChatConfirmed } from "../lib/aidt-idea-chat";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

type Action = { kind: "create" | "edit" | "delete"; id: string; title: string };
type DraftChange = (old: AidtUiStageDraft) => AidtUiStageDraft;
const actionName = { create: "新建点子", edit: "编辑点子", delete: "删除点子" };

export function AidtIdeaDirectory({ draft, saved, href, update, readOnly, saveDraft, onCreated }: {
  draft: AidtUiStageDraft;
  saved: AidtUiStageDraft | undefined;
  href: (id: string) => string;
  update: (change: DraftChange) => void;
  readOnly: boolean;
  onCreated?: (id: string) => void;
  saveDraft?: (change: DraftChange) => Promise<boolean>;
}) {
  const [action, setAction] = React.useState<Action | null>(null);
  const [title, setTitle] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(false);
  const titleId = React.useId();
  const allItems = readAidtIdeaDirectory(draft);
  const items = allItems.filter(item => !item.archived);
  const archived = allItems.filter(item => item.archived);
  const savedIds = new Set(saved ? readAidtIdeaDirectory(saved).filter(item => !item.archived).map(item => item.id) : []);
  const canSubmit = !readOnly && !saving && action && (action.kind === "delete"
    || (Boolean(title.trim()) && title.trim() !== action.title && (action.kind !== "create" || allItems.length < 8)));

  function open(next: Action) {
    setTitle(next.title);
    setError(false);
    setAction(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !action) return;
    const { kind, id } = action;
    const change: DraftChange = old => kind === "create" ? createAidtIdea(old, id, title) :
      kind === "edit" ? renameAidtIdea(old, id, title) : archiveAidtIdea(old, id);
    if (!saveDraft) {
      update(change);
      setAction(null);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      if (await saveDraft(change)) { setAction(null); if (kind === "create") onCreated?.(id); }
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const create = !readOnly && <Button type="button" variant="primary" disabled={saving || allItems.length >= 8}
    onClick={() => open({ kind: "create", id: `idea-${crypto.randomUUID()}`, title: "" })}><Plus className="size-4" aria-hidden />新建点子</Button>;

  return <section aria-label="点子列表" className="space-y-4" data-testid="aidt-idea-directory">
    <header className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">点子列表</h2>
      {items.length > 0 && create}
    </header>
    {items.length === 0 ? <div className="space-y-4 rounded-container border border-dashed border-border bg-muted p-8 text-center">
      <p className="text-13 text-muted-foreground">暂无点子</p>{create}
    </div> : <ul className="grid gap-3 sm:grid-cols-2">
      {items.map(item => <li key={item.id} className="flex min-w-0 flex-col rounded-container border border-border bg-card">
        {savedIds.has(item.id) ? <Link className="flex flex-1 items-start gap-3 rounded-container p-4 transition-colors hover:bg-muted" href={href(item.id)} aria-label={`打开「${item.title}」对话`}>
          <MessageSquare aria-hidden className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1"><h3 className="break-words text-16 font-semibold">{item.title}</h3>
            <p className="mt-2 text-12 text-muted-foreground">{saved && isAidtIdeaChatConfirmed(saved, item.id) ? "已确认" : "待确认"}</p>
          </div><ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </Link> : <div className="p-4"><h3 className="break-words font-semibold">{item.title}</h3><p className="text-12 text-muted-foreground">保存后可打开对话</p></div>}
        {!readOnly && <div className="flex justify-end gap-1 border-t border-border px-3 py-2">
          <Button type="button" size="sm" variant="ghost" aria-label={`编辑点子 ${item.title}`} disabled={saving}
            onClick={() => open({ kind: "edit", id: item.id, title: item.title })}><Pencil aria-hidden className="size-4" />编辑</Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`删除点子 ${item.title}`} disabled={saving}
            onClick={() => open({ kind: "delete", id: item.id, title: item.title })}><Trash2 aria-hidden className="size-4" />删除</Button>
        </div>}
      </li>)}
    </ul>}
    {archived.length > 0 && <details className="text-12"><summary className="cursor-pointer">已删除点子（{archived.length}）</summary>
      <ul className="mt-2 space-y-1">{archived.map(item => <li key={item.id}>{item.title}</li>)}</ul>
    </details>}
    <Dialog open={Boolean(action && !readOnly)} onOpenChange={open => { if (!open && !saving) setAction(null); }}>
      {action && <DialogContent>
        <DialogHeader><DialogTitle>{actionName[action.kind]}</DialogTitle>
          <DialogDescription>{action.kind === "delete" ? `删除「${action.title}」并保留历史版本。` : "填写点子名称。"} </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {action.kind !== "delete" && <div className="space-y-2"><label htmlFor={titleId} className="text-13">点子名称</label>
            <Input id={titleId} maxLength={120} value={title} onChange={event => setTitle(event.currentTarget.value)} disabled={saving} autoFocus />
          </div>}
          {error && <p role="alert" className="text-13 text-destructive">保存失败，请重试。</p>}
          <DialogFooter><Button type="button" variant="ghost" disabled={saving} onClick={() => setAction(null)}>取消</Button>
            <Button type="submit" variant={action.kind === "delete" ? "destructive" : "primary"} disabled={!canSubmit}>
              {saving ? "正在保存…" : action.kind === "delete" ? "确认删除" : "保存点子"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>}
    </Dialog>
  </section>;
}
