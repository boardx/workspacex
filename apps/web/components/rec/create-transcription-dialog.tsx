"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagField, commitDraft } from "@/components/ui/tag-input";
import { tagInputLimits, personalRealtimeTranscription } from "@repo/contracts";
const TAG_LIMITS = tagInputLimits(personalRealtimeTranscription.operations.createPersonalTranscription.in.shape.tags);

const DEFAULT_TRANSCRIPTION_NAME = "未命名转录";

export interface NewTranscriptionDraft {
  readonly name: string;
  readonly tags: readonly string[];
}

export function CreateTranscriptionDialog({
  open, onOpenChange, onCreate, knownTags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: NewTranscriptionDraft) => void | Promise<void>;
  /** 已有标签词表（`标签 → 用量`），给输入框做建议；不给就没有建议。 */
  knownTags?: ReadonlyMap<string, number>;
}) {
  const [name, setName] = React.useState(DEFAULT_TRANSCRIPTION_NAME);
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(false);

  function reset() {
    setName(DEFAULT_TRANSCRIPTION_NAME);
    setTags([]);
    setTagDraft("");
    setSubmitError(false);
  }

  function changeOpen(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || submitting) return;
    const submittedTags = commitDraft(tags, tagDraft, TAG_LIMITS);
    setSubmitting(true);
    setSubmitError(false);
    try {
      await onCreate({ name: nextName, tags: submittedTags });
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
              <TagField
                value={tags}
                onChange={setTags}
                draft={tagDraft}
                onDraftChange={setTagDraft}
                knownTags={knownTags}
                {...TAG_LIMITS}
                testIdPrefix="rec-create-tag"
              />
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
