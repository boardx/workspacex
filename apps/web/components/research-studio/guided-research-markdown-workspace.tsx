"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { GuidedResearchMarkdownDocument } from "@/lib/guided-research-markdown";

export function GuidedResearchMarkdownWorkspace({
  document,
  onSave,
  saving = false,
  parseError,
  provenance,
}: {
  document: GuidedResearchMarkdownDocument;
  onSave: (markdown: string) => Promise<{ ok: boolean; message?: string }>;
  saving?: boolean;
  parseError?: string | null;
  provenance?: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [markdown, setMarkdown] = React.useState(document.markdown);
  const [localSaving, setLocalSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(parseError ?? null);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => { if (!editing) setMarkdown(document.markdown); }, [document.markdown, editing]);
  React.useEffect(() => setError(parseError ?? null), [parseError]);
  const dirty = markdown !== document.markdown;
  const pending = saving || localSaving;
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
      {!editing && <Button variant="outline" size="sm" onClick={() => { setEditing(true); setSaved(false); }}>编辑 Markdown</Button>}
    </CardHeader>
    <CardContent className="space-y-4">
      {saved && <p data-testid="guided-research-markdown-saved" role="status" className="text-12 text-success">Markdown 已保存</p>}
      {error && <p data-testid="guided-research-markdown-error" role="alert" className="text-12 text-destructive">{error}</p>}
      {editing ? <>
        <Textarea aria-label={`${document.title} Markdown 编辑器`} data-testid="guided-research-markdown-editor" className="min-h-80 font-mono text-12" value={markdown} onChange={(event) => { setMarkdown(event.target.value); setSaved(false); }} disabled={pending} />
        {dirty && <p data-testid="guided-research-markdown-dirty" className="text-12 text-muted-foreground">存在未保存的 Markdown 修改</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={pending} onClick={() => { setMarkdown(document.markdown); setError(null); setEditing(false); }}>取消</Button><Button disabled={!dirty || pending} onClick={() => void save()}>{pending ? "保存中…" : "保存 Markdown"}</Button></div>
      </> : <section data-testid="guided-research-markdown-preview" aria-label={`${document.title} Markdown 预览`} className="chat-markdown min-w-0 break-words text-14 leading-7"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml>{document.markdown}</ReactMarkdown></section>}
      {provenance && <aside className="rounded-md border border-border bg-muted/30 p-3 text-12" aria-label="来源与证据元数据">{provenance}</aside>}
    </CardContent>
  </Card>;
}
