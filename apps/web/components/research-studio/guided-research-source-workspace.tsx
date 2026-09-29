"use client";

import * as React from "react";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";

export function GuidedResearchSourceWorkspace({ state, actions }: {
  state: GuidedResearchRuntime;
  actions: React.ReactNode;
}) {
  const urls = state.sources.filter((source) => source.decision !== "excluded"
    && source.addedByUser !== true
    && !source.url.startsWith("https://internal.workspacex.local/"));
  const [expanded, setExpanded] = React.useState<string[]>([]);
  const fullTextCount = urls.filter((source) => source.document && !source.document.truncated).length;
  const partialTextCount = urls.filter((source) => source.document?.truncated).length;
  const summaryOnlyCount = urls.length - fullTextCount - partialTextCount;

  return <section className="space-y-4" data-testid="guided-research-source-workspace" data-reference-layout="research-sources">
    <div className={urls.length > 0 ? "min-w-0" : "sr-only"}>
      <section className="min-w-0 rounded-xl border border-border bg-card p-5" {...(urls.length > 0 ? { "data-testid": "guided-research-source-evidence" } : {})}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">研究资料</h2><p className="text-xs text-muted-foreground" aria-label="资料证据概况">全文 {fullTextCount} · 部分正文 {partialTextCount} · 检索摘要 {summaryOnlyCount}</p></div>
        {summaryOnlyCount > 0 && <p className="mt-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">检索摘要仅用于筛选，读取并核验正文后才能作为正式报告证据。</p>}
        <ol aria-label="已获取的研究资料" aria-live="polite" aria-relevant="additions" className="mt-3 divide-y divide-border">
          {urls.map((source, index) => { const description = source.presentation?.summary ?? source.content; const evidenceLevel = source.document ? source.document.truncated ? "已读取部分正文" : "已读取全文" : "检索摘要"; const open = expanded.includes(source.id); return <li key={source.id} className="flex min-w-0 gap-3 py-3 text-sm"><span className="shrink-0 text-muted-foreground">{index + 1}.</span><div className="min-w-0 flex-1"><a href={source.url} target="_blank" rel="noopener noreferrer" data-testid={`research-source-description-${source.id}`} className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-sm font-medium underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><span>{source.presentation?.title ?? source.title}</span><span className="rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground no-underline">{evidenceLevel}</span></a><p className={`mt-1 text-muted-foreground ${open ? "" : "line-clamp-2"}`}>{description}</p><button type="button" aria-expanded={open} aria-controls={`research-source-full-description-${source.id}`} onClick={() => setExpanded((current) => open ? current.filter((id) => id !== source.id) : [...current, source.id])} className="mt-1 rounded-sm text-xs text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{open ? "收起完整描述" : "查看完整描述"}</button>{open && <p id={`research-source-full-description-${source.id}`} data-testid={`research-source-full-description-${source.id}`} className="sr-only">{description}</p>}</div></li>; })}
        </ol>
      </section>
    </div>
    {actions && <div className="flex flex-wrap gap-2" data-testid="guided-research-source-actions">{actions}</div>}
  </section>;
}
