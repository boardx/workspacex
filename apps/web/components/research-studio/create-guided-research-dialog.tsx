"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagField, commitDraft } from "@/components/ui/tag-input";
import { STUDIO_TAG_LIMITS } from "@/lib/tag-utils";

const DEFAULT_RESEARCH_NAME = "未命名研究";

export interface GuidedResearchCreateDraft {
  readonly title: string;
  readonly tags: readonly string[];
}

export function CreateGuidedResearchDialog({
  open,
  onOpenChange,
  onContinue,
  knownTags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (draft: GuidedResearchCreateDraft) => void;
  /** 已有标签词表，给输入框做建议；不给就没有建议。 */
  knownTags?: ReadonlyMap<string, number>;
}) {
  const [title, setTitle] = React.useState(DEFAULT_RESEARCH_NAME);
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");

  function reset() {
    setTitle(DEFAULT_RESEARCH_NAME);
    setTags([]);
    setTagDraft("");
  }

  function changeOpen(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const submittedTags = commitDraft(tags, tagDraft, STUDIO_TAG_LIMITS);
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
              <TagField
                value={tags}
                onChange={setTags}
                draft={tagDraft}
                onDraftChange={setTagDraft}
                knownTags={knownTags}
                {...STUDIO_TAG_LIMITS}
                testIdPrefix="research-create-tag"
              />
            </div>

            <div className="mt-2 flex justify-end gap-3">
              <Button asChild type="button" variant="ghost" size="lg" className="mr-auto"><a href="/research/new">直接填写需求</a></Button>
              <Button type="button" variant="outline" size="lg" className="min-w-24" onClick={() => changeOpen(false)}>取消</Button>
              <Button data-testid="research-create-submit" type="submit" variant="primary" size="lg" className="min-w-28" disabled={!title.trim()}>进入研究</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
