"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type HistoryMetadata = { name: string; tags: readonly string[] };

export function StudioMetadataDialog({ business, prefix, open, initialName, initialTags, onOpenChange, onSave }: {
  business: string; prefix: string; open: boolean; initialName: string; initialTags: readonly string[];
  onOpenChange: (open: boolean) => void; onSave: (draft: HistoryMetadata) => void | Promise<void>;
}) {
  const [name, setName] = React.useState(initialName);
  const [tags, setTags] = React.useState([...initialTags]);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const busy = React.useRef(false);
  React.useEffect(() => {
    if (open) { setName(initialName); setTags([...initialTags]); setDraft(""); setFailed(false); }
  }, [open, initialName, initialTags]);
  const addTag = () => { const tag = draft.trim(); if (tag && tags.length < 5 && !tags.includes(tag)) setTags([...tags, tag]); setDraft(""); };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !name.trim()) return;
    busy.current = true; setSaving(true); setFailed(false);
    const tag = draft.trim();
    try { await onSave({ name: name.trim(), tags: tag && tags.length < 5 && !tags.includes(tag) ? [...tags, tag] : tags }); onOpenChange(false); }
    catch { setFailed(true); }
    finally { busy.current = false; setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy.current) onOpenChange(value); }}><DialogContent data-testid={`${prefix}-edit-dialog`} className="w-[calc(100%-2rem)] max-w-md overflow-y-auto p-6">
    <DialogTitle>修改{business}</DialogTitle><DialogDescription>修改名称和标签，方便查找和整理。</DialogDescription>
    <form onSubmit={save} className="mt-4 space-y-5">
      <div className="space-y-2"><Label htmlFor={`${prefix}-edit-name`}>{business}名称</Label><Input autoFocus id={`${prefix}-edit-name`} data-testid={`${prefix}-edit-name`} maxLength={100} disabled={saving} value={name} onChange={event => setName(event.target.value)} /></div>
      <div className="space-y-2"><div className="flex justify-between"><Label htmlFor={`${prefix}-edit-tags`}>标签（可选）</Label><span className="text-11 text-muted-foreground">{tags.length}/5</span></div>
        <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-md border border-input p-2">{tags.map(tag => <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 text-12"><span className="break-all">{tag}</span><Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" disabled={saving} aria-label={`移除标签 ${tag}`} onClick={() => setTags(tags.filter(value => value !== tag))}><X className="size-3" aria-hidden /></Button></span>)}<Input id={`${prefix}-edit-tags`} data-testid={`${prefix}-edit-tags`} maxLength={20} disabled={saving || tags.length >= 5} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (!event.nativeEvent.isComposing && ["Enter", ",", "，"].includes(event.key)) { event.preventDefault(); addTag(); } }} placeholder="添加标签，按回车确认" className="h-8 min-w-0 flex-1 border-0" /></div>
      </div>
      {failed && <p role="alert" data-testid={`${prefix}-edit-error`} className="text-12 text-destructive">保存失败，请确认有修改权限再重试。</p>}
      <div className="flex justify-end gap-3"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" variant="primary" data-testid={`${prefix}-edit-submit`} disabled={saving || !name.trim()}>{saving ? "保存中…" : "保存修改"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}

export function StudioDeleteDialog({ business, prefix, name, description, open, onOpenChange, onConfirm }: {
  business: string; prefix: string; name: string; description: string; open: boolean;
  onOpenChange: (open: boolean) => void; onConfirm: () => void | Promise<void>;
}) {
  const [deleting, setDeleting] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const busy = React.useRef(false);
  React.useEffect(() => { if (open) setFailed(false); }, [open]);
  async function remove() {
    if (busy.current) return;
    busy.current = true; setDeleting(true); setFailed(false);
    try { await onConfirm(); onOpenChange(false); } catch { setFailed(true); }
    finally { busy.current = false; setDeleting(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy.current) onOpenChange(value); }}><DialogContent data-testid={`${prefix}-delete-dialog`} className="w-[calc(100%-2rem)] max-w-md overflow-y-auto p-6">
    <DialogTitle>删除{business}？</DialogTitle><DialogDescription className="break-words">“{name}”{description}</DialogDescription>
    {failed && <p role="alert" data-testid={`${prefix}-delete-error`} className="text-12 text-destructive">删除失败，请确认有删除权限再重试。</p>}
    <div className="mt-4 flex justify-end gap-3"><Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>取消</Button><Button variant="destructive" disabled={deleting} data-testid={`${prefix}-delete-confirm`} onClick={() => void remove()}>{deleting ? "删除中…" : "确认删除"}</Button></div>
  </DialogContent></Dialog>;
}

export function StudioHistoryManagement({ business, prefix, id, name, tags, deleteDescription, onSave, onDelete }: {
  business: string; prefix: string; id: string; name: string; tags: readonly string[]; deleteDescription: string;
  onSave: (draft: HistoryMetadata) => void | Promise<void>; onDelete: () => void | Promise<void>;
}) {
  const [mode, setMode] = React.useState<"edit" | "delete" | null>(null);
  return <><DropdownMenu.Root><DropdownMenu.Trigger asChild><Button variant="ghost" size="icon" aria-label={`${name} 更多操作`} data-testid={`${prefix}-history-actions-${id}`}><MoreVertical className="size-4" aria-hidden /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 min-w-32 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
    <DropdownMenu.Item data-testid={`${prefix}-history-edit-${id}`} onSelect={() => setMode("edit")} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 transition-colors focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Pencil className="size-4" aria-hidden />修改</DropdownMenu.Item>
    <DropdownMenu.Item data-testid={`${prefix}-history-delete-${id}`} onSelect={() => setMode("delete")} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-12 text-destructive transition-colors focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Trash2 className="size-4" aria-hidden />删除</DropdownMenu.Item>
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
    <StudioMetadataDialog business={business} prefix={prefix} open={mode === "edit"} initialName={name} initialTags={tags} onOpenChange={open => { if (!open) setMode(null); }} onSave={onSave} />
    <StudioDeleteDialog business={business} prefix={prefix} name={name} description={deleteDescription} open={mode === "delete"} onOpenChange={open => { if (!open) setMode(null); }} onConfirm={onDelete} />
  </>;
}
