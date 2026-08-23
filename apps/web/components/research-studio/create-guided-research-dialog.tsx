"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface GuidedResearchCreateDraft {
  readonly title: string;
  readonly tags: readonly string[];
}

export function CreateGuidedResearchDialog({
  open,
  onOpenChange,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (draft: GuidedResearchCreateDraft) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");

  function reset() {
    setTitle("");
    setTags([]);
    setTagDraft("");
  }

  function changeOpen(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function addTag() {
    const next = tagDraft.trim();
    if (!next || tags.includes(next) || tags.length >= 5) return;
    setTags((current) => [...current, next]);
    setTagDraft("");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const pendingTag = tagDraft.trim();
    const submittedTags = pendingTag && !tags.includes(pendingTag) && tags.length < 5
      ? [...tags, pendingTag]
      : tags;
    onContinue({ title: nextTitle, tags: submittedTags });
    changeOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm animate-in fade-in" />
        <Dialog.Content
          data-testid="research-create-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-7 text-card-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Dialog.Title className="text-20 font-semibold tracking-tight">创建研究</Dialog.Title>
              <Dialog.Description className="text-12 text-muted-foreground">先为研究命名，进入后再确认研究主题与范围。</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" size="icon" variant="ghost" aria-label="关闭创建研究弹窗"><X className="h-4 w-4" aria-hidden /></Button>
            </Dialog.Close>
          </div>

          <form className="mt-6 flex flex-col gap-5" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="research-create-name" className="text-13">研究名称</Label>
                <span className="text-11 text-muted-foreground">{title.length}/100</span>
              </div>
              <Input
                id="research-create-name"
                data-testid="research-create-name"
                value={title}
                maxLength={100}
                placeholder="例如：欧洲储能市场进入策略"
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
                className="h-10"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="research-create-tags" className="text-13">标签（可选）</Label>
                <span className="text-11 text-muted-foreground">{tags.length}/5</span>
              </div>
              <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-md border border-input bg-card p-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
                {tags.map((tag) => (
                  <Badge key={tag} tone="neutral" className="gap-1 py-1">
                    {tag}
                    <button type="button" aria-label={`移除标签 ${tag}`} className="rounded-sm transition-colors duration-200 hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setTags((current) => current.filter((item) => item !== tag))}>
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </Badge>
                ))}
                <Input
                  id="research-create-tags"
                  data-testid="research-create-tags"
                  value={tagDraft}
                  disabled={tags.length >= 5}
                  maxLength={20}
                  aria-label="添加研究标签"
                  placeholder={tags.length >= 5 ? "最多 5 个标签" : "添加标签，按回车确认"}
                  className="h-8 min-w-40 flex-1 border-0 px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "," || event.key === "，") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                />
              </div>
              <p className="text-11 text-muted-foreground">标签可选，最多添加 5 个</p>
            </div>

            <div className="mt-2 flex justify-end gap-3">
              <Button type="button" variant="outline" size="lg" className="min-w-24" onClick={() => changeOpen(false)}>取消</Button>
              <Button data-testid="research-create-submit" type="submit" variant="primary" size="lg" className="min-w-28" disabled={!title.trim()}>进入研究</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
