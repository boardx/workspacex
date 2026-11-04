"use client";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton, WorkflowActionBar } from "./research-workflow-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { GuidedResearchMarkdownDocument } from "@/lib/guided-research-markdown";

export type ResearchMarkdownSaveResult = { ok: boolean; message?: string; messageKey?: MessageKey; messageParams?: MessageParams };
type MarkdownError = { message: string } | { key: MessageKey; params?: MessageParams };

export function GuidedResearchMarkdownWorkspace({
  document,
  onSave,
  saving = false,
  parseError,
  provenance,
  readOnly = false,
  initiallyEditing = false,
  editOnDoubleClick = false,
  confirmChanges = false,
  onDirtyChange,
  preview,
}: {
  document: GuidedResearchMarkdownDocument;
  onSave: (markdown: string) => Promise<ResearchMarkdownSaveResult>;
  saving?: boolean;
  parseError?: string | null;
  provenance?: React.ReactNode;
  readOnly?: boolean;
  initiallyEditing?: boolean;
  editOnDoubleClick?: boolean;
  confirmChanges?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  preview?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = React.useState(initiallyEditing);
  const [markdown, setMarkdown] = React.useState(document.markdown);
  const [localSaving, setLocalSaving] = React.useState(false);
  const [error, setError] = React.useState<MarkdownError | null>(parseError ? { message: parseError } : null);
  const [saved, setSaved] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<"save" | "discard" | null>(null);
  React.useEffect(() => { if (!editing) setMarkdown(document.markdown); }, [document.markdown, editing]);
  React.useEffect(() => setError(parseError ? { message: parseError } : null), [parseError]);
  const dirty = markdown !== document.markdown;
  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  React.useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  const pending = saving || localSaving;
  function discard() { setMarkdown(document.markdown); setError(null); setEditing(false); }
  async function save() {
    if (!dirty || pending) return;
    setLocalSaving(true); setError(null); setSaved(false);
    try {
      const result = await onSave(markdown);
      if (!result.ok) { setError(result.messageKey ? { key: result.messageKey, params: result.messageParams } : result.message ? { message: result.message } : { key: "research.markdown.invalid" }); return; }
      setSaved(true); setEditing(false);
    } catch { setError({ key: "research.markdown.failed" }); }
    finally { setLocalSaving(false); }
  }
  return <Card data-testid="guided-research-markdown-workspace">
    <CardHeader className="flex-row items-center justify-between gap-3">
      <CardTitle className="text-16">{document.title}</CardTitle>
      {!readOnly && !editing && <Button variant={editOnDoubleClick ? "outline" : "primary"} size="sm" aria-label={editOnDoubleClick ? t("research.markdown.editPlan") : t("research.markdown.edit")} onClick={() => { setEditing(true); setSaved(false); }}><Pencil className="mr-1 size-3.5" aria-hidden />{editOnDoubleClick ? t("studio.edit") : t("research.markdown.edit")}</Button>}
    </CardHeader>
    <CardContent className="space-y-4">
      {saved && <p data-testid="guided-research-markdown-saved" role="status" className="text-12 text-success">{t("research.markdown.saved")}</p>}
      {error && <p data-testid="guided-research-markdown-error" role="alert" className="text-12 text-destructive">{"key" in error ? t(error.key, error.params) : error.message}</p>}
      {editing ? <>
        <Textarea aria-label={t("research.markdown.editor", { title: document.title })} data-testid="guided-research-markdown-editor" className="min-h-80 font-mono text-12" value={markdown} onChange={(event) => { setMarkdown(event.target.value); setSaved(false); }} disabled={pending} />
        {dirty && <p data-testid="guided-research-markdown-dirty" className="text-12 text-muted-foreground">{t("research.markdown.unsaved")}</p>}
        <WorkflowActionBar placement="footer"><WorkflowActionButton variant="outline" disabled={pending} onClick={() => dirty && confirmChanges ? setConfirmAction("discard") : discard()}>{t("common.cancel")}</WorkflowActionButton><WorkflowActionButton variant="primary" loading={pending} disabled={!dirty || pending} onClick={() => confirmChanges ? setConfirmAction("save") : void save()}>{pending ? t("studio.saving") : t("research.markdown.save")}</WorkflowActionButton></WorkflowActionBar>
      </> : <>{editOnDoubleClick && !readOnly && <p className="text-right text-12 text-muted-foreground">{t("research.markdown.doubleClick")}</p>}<section data-testid="guided-research-markdown-preview" aria-label={t("research.markdown.preview", { title: document.title })} onDoubleClick={editOnDoubleClick && !readOnly ? () => { setEditing(true); setSaved(false); } : undefined} className={`${preview ? "" : "chat-markdown"} min-w-0 break-words text-14 leading-7 ${editOnDoubleClick && !readOnly ? "cursor-text" : ""}`}>{preview ?? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml>{document.markdown}</ReactMarkdown>}</section></>}
      {provenance && <aside className="rounded-md border border-border bg-muted/30 p-3 text-12" aria-label={t("research.markdown.provenance")}>{provenance}</aside>}
      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}><DialogContent><DialogTitle>{confirmAction === "save" ? t("research.plan.confirm") : t("research.markdown.discardTitle")}</DialogTitle><DialogDescription>{confirmAction === "save" ? t("research.markdown.confirmDescription") : t("research.markdown.discardDescription")}</DialogDescription><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmAction(null)}>{t("research.shell.keepEditing")}</Button><Button variant="primary" onClick={() => { const action = confirmAction; setConfirmAction(null); if (action === "save") void save(); else discard(); }}>{confirmAction === "save" ? t("research.plan.confirmSave") : t("research.markdown.discard")}</Button></div></DialogContent></Dialog>
    </CardContent>
  </Card>;
}
