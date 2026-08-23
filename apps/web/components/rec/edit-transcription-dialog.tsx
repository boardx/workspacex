"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EditTranscriptionDialog({ open, initialName, initialTags, onOpenChange, onSave }: {
  open: boolean; initialName: string; initialTags: readonly string[]; onOpenChange: (open: boolean) => void;
  onSave: (draft: { name: string; tags: readonly string[] }) => void | Promise<void>;
}) {
  const [name, setName] = React.useState(initialName);
  const [tags, setTags] = React.useState<string[]>([...initialTags]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { if (open) { setName(initialName); setTags([...initialTags]); setTagDraft(""); setFailed(false); } }, [open, initialName, initialTags]);
  function addTag() { const tag = tagDraft.trim(); if (tag && tags.length < 5 && !tags.includes(tag)) setTags((current) => [...current, tag]); setTagDraft(""); }
  async function submit(event: React.FormEvent) { event.preventDefault(); const pending = tagDraft.trim();
    const nextTags = pending && tags.length < 5 && !tags.includes(pending) ? [...tags, pending] : tags;
    if (!name.trim() || saving) return; setSaving(true); setFailed(false);
    try { await onSave({ name: name.trim(), tags: nextTags }); onOpenChange(false); } catch { setFailed(true); } finally { setSaving(false); }
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm" />
    <Dialog.Content data-testid="rec-edit-dialog" className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-7 shadow-lg">
      <div className="flex justify-between"><div><Dialog.Title className="text-20 font-semibold">修改转录</Dialog.Title><Dialog.Description className="text-12 text-muted-foreground">修改名称和标签</Dialog.Description></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="关闭修改转录弹窗"><X aria-hidden className="h-4 w-4" /></Button></Dialog.Close></div>
      <form className="mt-6 flex flex-col gap-5" onSubmit={submit}>
        <div className="flex flex-col gap-2"><Label htmlFor="rec-edit-name">转录名称</Label><Input id="rec-edit-name" data-testid="rec-edit-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="flex flex-col gap-2"><Label htmlFor="rec-edit-tags">标签（可选）</Label><div className="flex min-h-14 flex-wrap gap-2 rounded-md border p-2">{tags.map((tag) => <Badge key={tag} tone="neutral" className="gap-1">{tag}<button type="button" aria-label={`移除标签 ${tag}`} onClick={() => setTags((current) => current.filter((item) => item !== tag))}><X className="h-3 w-3" aria-hidden /></button></Badge>)}<Input id="rec-edit-tags" data-testid="rec-edit-tags" value={tagDraft} disabled={tags.length >= 5} maxLength={20} className="h-8 min-w-32 flex-1 border-0" onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} /></div></div>
        {failed && <p role="alert" className="text-12 text-destructive">修改失败，请稍后重试。</p>}
        <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button data-testid="rec-edit-submit" type="submit" variant="primary" disabled={!name.trim() || saving}>{saving ? "保存中" : "保存修改"}</Button></div>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
