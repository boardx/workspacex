"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton, WorkflowActionBar } from "@/components/research-studio/research-workflow-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagField, commitDraft } from "@/components/ui/tag-input";
import { tagInputLimits, personalRealtimeTranscription } from "@repo/contracts";
const TAG_LIMITS = tagInputLimits(personalRealtimeTranscription.operations.createPersonalTranscription.in.shape.tags);


export interface NewTranscriptionDraft {
  readonly name: string;
  readonly tags: readonly string[];
}

export function CreateTranscriptionDialog({
  open, onOpenChange, onCreate, knownTags, openerRef,
}: {
  open: boolean;
  openerRef?: React.RefObject<HTMLElement>;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: NewTranscriptionDraft) => void | Promise<void>;
  /** 已有标签词表（`标签 → 用量`），给输入框做建议；不给就没有建议。 */
  knownTags?: ReadonlyMap<string, number>;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState(() => t("rec.create.default"));
  const nameTouched = React.useRef(false);
  React.useEffect(() => {
    if (!open) nameTouched.current = false;
    if (!nameTouched.current) setName(t("rec.create.default"));
  }, [open, t]);
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(false);
  const opener = React.useRef<HTMLElement | null>(null);
  const nameInput = React.useRef<HTMLInputElement | null>(null);
  const created = React.useRef(false);

  function reset() {
    nameTouched.current = false;
    setName(t("rec.create.default"));
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
    nameTouched.current = true;
    const submittedTags = commitDraft(tags, tagDraft, TAG_LIMITS);
    setSubmitting(true);
    setSubmitError(false);
    try {
      await onCreate({ name: nextName, tags: submittedTags });
      created.current = true;
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
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            created.current = false;
            opener.current = openerRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
            nameInput.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            // This controlled dialog has no Radix Trigger. Cancel restores the
            // actual opener; successful creation leaves navigation focus alone.
            event.preventDefault();
            const target = opener.current;
            if (!created.current && target?.isConnected && !target.matches(":disabled,[aria-disabled=true]") && !target.closest("[hidden],[inert]") && target.matches("button:not(:disabled),a[href],input:not(:disabled),[tabindex]:not([tabindex='-1'])")) target.focus();
            opener.current = null;
          }}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-20 font-semibold tracking-tight">{t("rec.create.title")}</Dialog.Title>
              <Dialog.Description className="sr-only">{t("rec.create.description")}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" size="icon" variant="ghost" aria-label={t("rec.create.close")}>
                <X aria-hidden className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <form className="mt-4 flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="rec-create-name" className="text-13 text-card-foreground">{t("rec.create.name")}</Label>
                <span data-testid="rec-create-name-count" className="text-11 text-muted-foreground">{name.length}/100</span>
              </div>
              <Input
                id="rec-create-name"
                data-testid="rec-create-name"
                value={name}
                maxLength={100}
                placeholder={t("rec.create.placeholder")}
                ref={nameInput}
                onChange={(event) => { nameTouched.current = true; setName(event.target.value); }}
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
              {submitError && <p role="alert" className="text-11 text-destructive">{t("rec.create.failed")}</p>}
            </div>

            <WorkflowActionBar placement="footer">
              <WorkflowActionButton data-testid="rec-create-cancel" type="button" variant="outline" onClick={() => changeOpen(false)}>
                {t("common.cancel")}
              </WorkflowActionButton>
              <WorkflowActionButton data-testid="rec-create-submit" type="submit" variant="primary" loading={submitting} disabled={!name.trim() || submitting}>
                {submitting ? t("rec.create.creating") : t("rec.create.open")}
              </WorkflowActionButton>
            </WorkflowActionBar>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
