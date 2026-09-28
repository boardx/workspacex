"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { GuidedResearchMarkdownDocument } from "@/lib/guided-research-markdown";

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
}: {
  document: GuidedResearchMarkdownDocument;
  onSave: (markdown: string) => Promise<{ ok: boolean; message?: string }>;
  saving?: boolean;
  parseError?: string | null;
  provenance?: React.ReactNode;
  readOnly?: boolean;
  initiallyEditing?: boolean;
  editOnDoubleClick?: boolean;
  confirmChanges?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = React.useState(initiallyEditing);
  const [markdown, setMarkdown] = React.useState(document.markdown);
  const [localSaving, setLocalSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(parseError ?? null);
  const [saved, setSaved] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<"save" | "discard" | null>(null);
  React.useEffect(() => { if (!editing) setMarkdown(document.markdown); }, [document.markdown, editing]);
  React.useEffect(() => setError(parseError ?? null), [parseError]);
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
      if (!result.ok) { setError(result.message ?? "Markdown 校验失败，请修改后重试。"); return; }
      setSaved(true); setEditing(false);
    } catch { setError("保存 Markdown 失败，请重试。"); }
    finally { setLocalSaving(false); }
  }
  return <Card data-testid="guided-research-markdown-workspace">
    <CardHeader className="flex-row items-center justify-between gap-3">
      <CardTitle className="text-16">{document.title}</CardTitle>
      {!readOnly && !editing && !editOnDoubleClick && <Button variant="primary" size="sm" onClick={() => { setEditing(true); setSaved(false); }}>编辑 Markdown</Button>}
    </CardHeader>
    <CardContent className="space-y-4">
      {saved && <p data-testid="guided-research-markdown-saved" role="status" className="text-12 text-success">Markdown 已保存</p>}
      {error && <p data-testid="guided-research-markdown-error" role="alert" className="text-12 text-destructive">{error}</p>}
      {editing ? <>
        <Textarea aria-label={`${document.title} Markdown 编辑器`} data-testid="guided-research-markdown-editor" className="min-h-80 font-mono text-12" value={markdown} onChange={(event) => { setMarkdown(event.target.value); setSaved(false); }} disabled={pending} />
        {dirty && <p data-testid="guided-research-markdown-dirty" className="text-12 text-muted-foreground">存在未保存的 Markdown 修改</p>}
        <div className="flex justify-end gap-2"><Button variant="primary" disabled={pending} onClick={() => dirty && confirmChanges ? setConfirmAction("discard") : discard()}>取消</Button><Button variant="primary" disabled={!dirty || pending} onClick={() => confirmChanges ? setConfirmAction("save") : void save()}>{pending ? "保存中…" : "保存 Markdown"}</Button></div>
      </> : <section data-testid="guided-research-markdown-preview" aria-label={`${document.title} Markdown 预览`} onDoubleClick={editOnDoubleClick && !readOnly ? () => { setEditing(true); setSaved(false); } : undefined} className={`chat-markdown min-w-0 break-words text-14 leading-7 ${editOnDoubleClick && !readOnly ? "cursor-text" : ""}`}><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml>{document.markdown}</ReactMarkdown></section>}
      {provenance && <aside className="rounded-md border border-border bg-muted/30 p-3 text-12" aria-label="来源与证据元数据">{provenance}</aside>}
      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}><DialogContent><DialogTitle>{confirmAction === "save" ? "确认修改研究计划" : "放弃研究计划修改？"}</DialogTitle><DialogDescription>{confirmAction === "save" ? "保存后需要重新确认研究计划，后续资料研究结果可能失效。" : "未保存的修改将丢失。"}</DialogDescription><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmAction(null)}>继续编辑</Button><Button variant="primary" onClick={() => { const action = confirmAction; setConfirmAction(null); if (action === "save") void save(); else discard(); }}>{confirmAction === "save" ? "确认保存" : "放弃修改"}</Button></div></DialogContent></Dialog>
    </CardContent>
  </Card>;
}
