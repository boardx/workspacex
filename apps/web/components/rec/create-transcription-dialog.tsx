"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export interface NewTranscriptionDraft {
  readonly name: string;
  readonly tags: readonly string[];
}

export function CreateTranscriptionDialog({
  open, onOpenChange, onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: NewTranscriptionDraft) => void | Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(false);

  function reset() {
    setName("");
    setTags([]);
    setTagDraft("");
    setSubmitError(false);
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      await onCreate({ name: nextName, tags });
      changeOpen(false);
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm animate-in fade-in" />
        <Dialog.Content
          data-testid="rec-create-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-7 text-card-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-20 font-semibold tracking-tight">新建转录</Dialog.Title>
              <Dialog.Description className="text-12 text-muted-foreground">创建后将立即进入实时转录</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" size="icon" variant="ghost" aria-label="关闭新建转录弹窗">
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <form className="mt-6 flex flex-col gap-5" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="rec-create-name" className="text-13 text-card-foreground">转录名称</Label>
                <span data-testid="rec-create-name-count" className="text-11 text-muted-foreground">{name.length}/100</span>
              </div>
              <Input
                id="rec-create-name"
                data-testid="rec-create-name"
                value={name}
                maxLength={100}
                placeholder="例如：欧洲市场进入讨论"
                autoFocus
                onChange={(event) => setName(event.target.value)}
                className="h-10"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="rec-create-tags" className="text-13 text-card-foreground">标签（可选）</Label>
                <span data-testid="rec-create-tag-count" className="text-11 text-muted-foreground">{tags.length}/5</span>
              </div>
              <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-md border border-input bg-card p-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
                {tags.map((tag) => (
                  <Badge key={tag} tone="neutral" className="gap-1 py-1">
                    {tag}
                    <button
                      type="button"
                      aria-label={`移除标签 ${tag}`}
                      className="rounded-sm transition-colors duration-200 hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                    >
                      <X aria-hidden className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Input
                  id="rec-create-tags"
                  data-testid="rec-create-tags"
                  value={tagDraft}
                  disabled={tags.length >= 5}
                  aria-label="添加转录标签"
                  placeholder={tags.length >= 5 ? "最多 5 个标签" : "添加标签，按回车确认"}
                  className="h-8 min-w-40 flex-1 border-0 px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  maxLength={20}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                />
              </div>
              <p className="text-11 text-muted-foreground">最多可添加 5 个标签</p>
              {submitError && <p role="alert" className="text-11 text-destructive">创建失败，请稍后重试。</p>}
            </div>

            <div className="mt-2 flex justify-end gap-3">
              <Button data-testid="rec-create-cancel" type="button" variant="outline" size="lg" className="min-w-24" onClick={() => changeOpen(false)}>
                取消
              </Button>
              <Button data-testid="rec-create-submit" type="submit" variant="primary" size="lg" className="min-w-32" disabled={!name.trim() || submitting}>
                {submitting ? "正在创建" : "开始实时转录"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
