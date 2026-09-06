"use client";
import * as React from "react";
import { Info, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";
type Source = GuidedResearchRuntime["sources"][number];
function SourceRow({ source, disabled, onRemove }: { source: Source; disabled: boolean; onRemove: () => void }) {
  const [open, setOpen] = React.useState(false);
  const descriptionId = React.useId();
  return <li className="relative border-b border-border last:border-b-0" data-testid="research-source-row" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); event.stopPropagation(); } }}>
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <a className="min-w-0 truncate text-12 font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary" href={source.url} target="_blank" rel="noreferrer" aria-describedby={open ? descriptionId : undefined}>{source.title}</a>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label={`查看描述 ${source.title}`} aria-expanded={open} aria-controls={descriptionId} onClick={() => setOpen(true)}><Info className="size-4" aria-hidden /></Button>
        </div>
        {open && <div className="absolute left-0 right-0 top-full z-30 pt-1" id={descriptionId} role="tooltip">
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-4 text-12 text-popover-foreground shadow-lg" tabIndex={0}>
            <p className="break-words font-medium">{source.title}</p>
            <p className="mt-1 break-all text-muted-foreground">{source.url}</p>
            <p className="mt-3 whitespace-pre-wrap break-words leading-relaxed">{source.content}</p>
          </div>
        </div>}
      </div>
      <Button variant="ghost" size="icon" disabled={disabled} onClick={onRemove} aria-label={`删除来源 ${source.title}`}><Trash2 className="size-4" aria-hidden /></Button>
    </div>
  </li>;
}
export function GuidedResearchSources({ sources, disabled, onAdd, onRemove }: {
  sources: Source[]; disabled: boolean;
  onAdd: (url: string) => Promise<boolean | undefined>;
  onRemove: (id: string) => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const visible = sources.filter((source) => source.decision !== "excluded");
  let validUrl = false;
  try { const parsed = new URL(url.trim()); validUrl = ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { /* Wait for a complete public URL. */ }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || submitting || !validUrl) return;
    setSubmitting(true);
    try { if (await onAdd(url.trim())) { setUrl(""); setAdding(false); } }
    finally { setSubmitting(false); }
  }
  return <section className="space-y-3" aria-label="研究来源" data-testid="research-sources">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">研究来源 · {visible.length}</h2><Button variant="outline" disabled={disabled} onClick={() => setAdding((value) => !value)}><Plus className="size-4" aria-hidden />添加来源</Button></div>
    <p className="text-12 text-muted-foreground">来源已自动纳入研究，可删除不需要的内容。移到链接上查看完整描述。</p>
    {adding && <form onSubmit={(event) => void submit(event)} className="space-y-2 rounded-lg border border-border bg-card p-4">
      <label htmlFor="research-source-url" className="text-12 font-medium">来源链接</label>
      <div className="flex flex-wrap gap-2"><Input id="research-source-url" type="url" className="min-w-0 flex-1" placeholder="https://…" value={url} disabled={disabled || submitting} onChange={(event) => setUrl(event.target.value)} /><Button type="submit" variant="primary" disabled={disabled || submitting || !validUrl}>{submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}{submitting ? "正在添加…" : "添加"}</Button></div>
      <p className="text-12 text-muted-foreground">读取检索服务返回的网页描述后加入研究。</p>
    </form>}
    {visible.length ? <ul className="rounded-lg border border-border bg-card">{visible.map((source) => <SourceRow key={source.id} source={source} disabled={disabled} onRemove={() => onRemove(source.id)} />)}</ul> : <p className="rounded-lg border border-dashed border-border p-6 text-center text-12 text-muted-foreground">暂无来源，可以添加链接或开始检索。</p>}
  </section>;
}
