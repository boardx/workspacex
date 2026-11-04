"use client";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton, WorkflowActionBar } from "@/components/research-studio/research-workflow-actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagField, commitDraft } from "@/components/ui/tag-input";
import { tagInputLimits, interview } from "@repo/contracts";
import { ApiError } from "@/lib/api-client";
import { createDigitalInterviewDraft, type InterviewScope } from "@/lib/interview-api";
import { withProjectId } from "@/components/project/project-breadcrumb";
const TAG_LIMITS = tagInputLimits(interview.DigitalInterviewDraftInput.shape.tags);

const INDEPENDENT_SCOPE: InterviewScope = { kind: "none", projectId: null, researchProjectId: null };


export function DigitalInterviewCreateModal({ open, onOpenChange, projectId = null, knownTags }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 项目中枢 B2-S2：有 `projectId` 时创建 scope 为 `{ kind: "project", projectId }`——访谈表自带
   * `project_id`，不走链接表；创建后进入 setup 页也续上 `?projectId=` 让面包屑能回项目。
   */
  projectId?: string | null;
  /** 已有标签词表，给输入框做建议；不给就没有建议。 */
  knownTags?: ReadonlyMap<string, number>;
}) {
 const { t } = useI18n();
  const { push } = useRouter();
  const defaultName = React.useRef(t("itv.create.untitled"));
  React.useEffect(() => {
    if (!open) { defaultName.current = t("itv.create.untitled"); setName(defaultName.current); }
  }, [open, t]);
  const scope: InterviewScope = projectId ? { kind: "project", projectId, researchProjectId: null } : INDEPENDENT_SCOPE;
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const nameInput = React.useRef<HTMLInputElement | null>(null);
  const [name, setName] = React.useState(defaultName.current);
  const [tags, setTags] = React.useState<readonly string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<import("@/lib/i18n/messages").MessageKey | "">("");
  const errorRef = React.useRef<HTMLParagraphElement | null>(null);
  React.useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const requestAttempt = React.useRef<{ readonly fingerprint: string; readonly requestId: string } | null>(null);

  function close() {
    onOpenChange(false);
    defaultName.current = t("itv.create.untitled");
    setName(defaultName.current);
    setTags([]);
    setTagDraft("");
    setBusy(false);
    setError("");
    requestAttempt.current = null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    const nextTags = commitDraft(tags, tagDraft, TAG_LIMITS);
    const payload = { name: name.trim(), tags: [...nextTags], scope };
    const fingerprint = JSON.stringify(payload);
    if (requestAttempt.current?.fingerprint !== fingerprint) {
      requestAttempt.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    setBusy(true);
    setError("");
    try {
      const created = await createDigitalInterviewDraft({ ...payload, requestId: requestAttempt.current.requestId });
      close();
      push(withProjectId(`/itv/${created.interviewId}/intake`, projectId));
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401 ? "itv.create.error.expired"
        : cause instanceof ApiError && cause.status === 403 ? "itv.create.error.forbidden"
          : cause instanceof ApiError && [400, 422].includes(cause.status) ? "itv.create.error.invalid"
            : "itv.create.error.unavailable");
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm animate-in fade-in" />
        <Dialog.Content onOpenAutoFocus={event => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; event.preventDefault(); nameInput.current?.focus(); if (nameInput.current?.value === defaultName.current) nameInput.current.select(); }} onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }} data-testid="itv-create-dialog" className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Dialog.Title className="text-20 font-semibold tracking-tight">{t("itv.new")}</Dialog.Title>
              <Dialog.Description className="sr-only">{t("itv.create.description")}</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label={t("itv.create.close")}><X className="size-4" aria-hidden /></Button></Dialog.Close>
          </div>
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="itv-create-name" className="text-13">{t("itv.create.name")}</Label><span className="text-11 text-muted-foreground">{name.length}/100</span></div>
              <Input id="itv-create-name" data-testid="itv-create-name" aria-describedby={!name.trim() ? "itv-create-name-hint" : undefined} maxLength={100} ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("itv.create.placeholder")} className="h-9" />
              {!name.trim() && <p id="itv-create-name-hint" className="text-xs text-muted-foreground">{t("itv.create.nameRequired")}</p>}
            </div>
            <TagField
              value={tags}
              onChange={setTags}
              draft={tagDraft}
              onDraftChange={setTagDraft}
              knownTags={knownTags}
              label={t("itv.create.tags")}
              {...TAG_LIMITS}
              testIdPrefix="itv-create-tag"
            />
            <div data-testid="itv-create-scope" className="text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-background-foreground">{t("itv.create.scope")}</span>{projectId ? t("itv.create.project") : t("itv.create.independent")}</div>
            {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-md text-sm text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t("itv.create.failure", { detail: t(error) })}</p>}
            <WorkflowActionBar placement="footer">
              <WorkflowActionButton type="button" variant="outline" onClick={close}>{t("itv.cancel")}</WorkflowActionButton>
              <WorkflowActionButton data-testid="itv-create-submit" type="submit" variant="primary" loading={busy} disabled={!name.trim() || busy}>{busy ? t("itv.create.pending") : t("itv.create.start")}</WorkflowActionButton>
            </WorkflowActionBar>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
