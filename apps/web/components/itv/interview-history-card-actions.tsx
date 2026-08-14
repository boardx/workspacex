"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DigitalInterviewHistoryRow } from "@/lib/interview-api";
import {
  deleteMockDigitalInterviewDraft,
  updateMockDigitalInterviewMetadata,
} from "@/lib/mock/digital-interview-drafts";

export function InterviewHistoryCardActions({ item, onChanged }: {
  item: DigitalInterviewHistoryRow;
  onChanged: () => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [error, setError] = React.useState<string>();

  if (!item.interviewId.startsWith("mock-batch-")) return null;

  function openEdit() {
    setMenuOpen(false);
    setName(item.name);
    setTags(item.tags.map((tag) => tag.trim()).filter(Boolean));
    setTagDraft("");
    setError(undefined);
    setEditOpen(true);
  }

  function addTag() {
    const next = tagDraft.trim();
    if (!next || tags.includes(next) || tags.length >= 5) return;
    setTags((current) => [...current, next]);
    setTagDraft("");
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const pendingTag = tagDraft.trim();
    const nextTags = pendingTag && !tags.includes(pendingTag) && tags.length < 5
      ? [...tags, pendingTag]
      : tags;

    try {
      updateMockDigitalInterviewMetadata(item.interviewId, { name, tags: nextTags });
      setEditOpen(false);
      setError(undefined);
      onChanged();
    } catch {
      setError("保存失败，请确认该访谈仍然存在。");
    }
  }

  function remove() {
    try {
      deleteMockDigitalInterviewDraft(item.interviewId);
      setDeleteOpen(false);
      setError(undefined);
      onChanged();
    } catch {
      setError("删除失败，请确认该访谈仍然存在。");
    }
  }

  return (
    <>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="管理访谈"
            data-testid={`itv-history-actions-${item.interviewId}`}
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-28 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <DropdownMenu.Item
              onSelect={openEdit}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil aria-hidden className="size-3.5" /> 编辑
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => { setMenuOpen(false); setError(undefined); setDeleteOpen(true); }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-muted focus:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 aria-hidden className="size-3.5" /> 删除
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog.Root open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setError(undefined); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-7 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-2xl font-semibold">编辑访谈</Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground">只会更新名称和标签。</Dialog.Description>
              </div>
              <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label="关闭编辑访谈弹窗"><X aria-hidden className="size-4" /></Button></Dialog.Close>
            </div>
            <form onSubmit={save} className="mt-7 grid gap-6">
              <div className="grid gap-2">
                <div className="flex justify-between"><Label htmlFor="itv-edit-name">访谈名称</Label><span className="text-xs text-muted-foreground">{name.length}/100</span></div>
                <Input id="itv-edit-name" data-testid="itv-edit-name" maxLength={100} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between"><Label htmlFor="itv-edit-tag-input">标签（可选）</Label><span className="text-xs text-muted-foreground">{tags.length}/5</span></div>
                <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-lg border border-input p-2">
                  {tags.map((tag) => <span data-testid="itv-edit-tag" key={tag} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">{tag}<button type="button" aria-label={`删除标签 ${tag}`} onClick={() => setTags((current) => current.filter((value) => value !== tag))} className="rounded-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X aria-hidden className="size-3" /></button></span>)}
                  <Input id="itv-edit-tag-input" data-testid="itv-edit-tag-input" disabled={tags.length >= 5} value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "," || event.key === "，") { event.preventDefault(); addTag(); } }} placeholder={tags.length >= 5 ? "最多 5 个标签" : "添加标签，按回车确认"} className="min-w-40 flex-1 border-0 shadow-none focus-visible:ring-0" />
                </div>
                <p className="text-xs text-muted-foreground">最多可添加 5 个标签</p>
              </div>
              {error && <p role="alert" data-testid="itv-edit-error" className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" size="lg" onClick={() => setEditOpen(false)}>取消</Button>
                <Button data-testid="itv-edit-submit" type="submit" variant="primary" size="lg" disabled={!name.trim()}>保存</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) setError(undefined); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-7 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Dialog.Title className="text-2xl font-semibold">删除访谈</Dialog.Title>
            <Dialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">删除后会永久移除此 Mock 访谈的主题、专家、问题、进度和报告，且不可恢复。</Dialog.Description>
            {error && <p role="alert" data-testid="itv-delete-error" className="mt-4 text-sm text-destructive">{error}</p>}
            <div className="mt-7 flex justify-end gap-3">
              <Button type="button" variant="outline" size="lg" onClick={() => setDeleteOpen(false)}>取消</Button>
              <Button data-testid="itv-delete-confirm" type="button" variant="destructive" size="lg" onClick={remove}>确认删除</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </>
  );
}
