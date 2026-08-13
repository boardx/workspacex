"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";

export function DigitalInterviewCreateModal({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { push } = useRouter();
  const [name, setName] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");

  function close() {
    onOpenChange(false);
    setName("");
    setTags([]);
    setTagDraft("");
  }

  function addTag() {
    const next = tagDraft.trim();
    if (!next || tags.includes(next) || tags.length >= 5) return;
    setTags((current) => [...current, next]);
    setTagDraft("");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const pending = tagDraft.trim();
    const nextTags = pending && !tags.includes(pending) && tags.length < 5 ? [...tags, pending] : tags;
    const created = createMockDigitalInterviewDraft({ name, tags: nextTags });
    close();
    push(`/itv/${created.interviewId}/setup`);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm" />
        <Dialog.Content data-testid="itv-create-dialog" className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-7 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-2xl font-semibold">新建访谈</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-muted-foreground">创建后将直接进入访谈设计流程</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label="关闭新建访谈弹窗"><X className="size-4" /></Button></Dialog.Close>
          </div>
          <form onSubmit={submit} className="mt-7 grid gap-6">
            <div className="grid gap-2">
              <div className="flex justify-between"><Label htmlFor="itv-create-name">访谈名称</Label><span className="text-xs text-muted-foreground">{name.length}/100</span></div>
              <Input id="itv-create-name" data-testid="itv-create-name" maxLength={100} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：欧洲市场进入讨论" />
            </div>
            <div className="grid gap-2">
              <div className="flex justify-between"><Label htmlFor="itv-create-tag-input">标签（可选）</Label><span className="text-xs text-muted-foreground">{tags.length}/5</span></div>
              <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-lg border border-input p-2">
                {tags.map((tag) => <span data-testid="itv-create-tag" key={tag} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">{tag}<button type="button" aria-label={`删除标签 ${tag}`} onClick={() => setTags((current) => current.filter((value) => value !== tag))}><X className="size-3" /></button></span>)}
                <Input id="itv-create-tag-input" data-testid="itv-create-tag-input" disabled={tags.length >= 5} value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "," || event.key === "，") { event.preventDefault(); addTag(); } }} placeholder={tags.length >= 5 ? "最多 5 个标签" : "添加标签，按回车确认"} className="min-w-40 flex-1 border-0 shadow-none focus-visible:ring-0" />
              </div>
              <p className="text-xs text-muted-foreground">最多可添加 5 个标签</p>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" size="lg" onClick={close}>取消</Button>
              <Button data-testid="itv-create-submit" type="submit" variant="primary" size="lg" disabled={!name.trim()}>开始访谈</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
