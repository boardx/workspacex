import type * as React from "react";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";

export function GuidedResearchSourceWorkspace({ state, actions }: {
  state: GuidedResearchRuntime;
  actions: React.ReactNode;
}) {
  const chapters = state.outline.filter((chapter) => chapter.enabled);
  const urls = state.sources.filter((source) => source.decision !== "excluded"
    && source.addedByUser !== true
    && !source.url.startsWith("https://internal.workspacex.local/"));

  return <section className="space-y-4" data-testid="guided-research-source-workspace" data-reference-layout="research-sources">
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card p-5" data-testid="guided-research-source-chapters">
        <h2 className="text-lg font-bold">报告章节</h2>
        <ol aria-label="报告章节" className="mt-3 divide-y divide-border">
          {chapters.map((chapter, index) => <li key={chapter.id} className="flex gap-3 py-3 text-sm"><span className="shrink-0 text-muted-foreground">{index + 1}.</span><span className="font-medium">{chapter.title}</span></li>)}
        </ol>
      </section>
      <section className="min-w-0 rounded-xl border border-border bg-card p-5" data-testid="guided-research-source-evidence">
        <h2 className="text-lg font-bold">研究资料</h2>
        {urls.length ? <ol aria-label="搜索得到的相关网址" className="mt-3 divide-y divide-border">
          {urls.map((source, index) => <li key={source.id} className="flex min-w-0 gap-3 py-3 text-sm"><span className="shrink-0 text-muted-foreground">{index + 1}.</span><a href={source.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all underline underline-offset-4">{source.url}</a></li>)}
        </ol> : <p className="mt-3 text-sm text-muted-foreground">尚未找到相关网址</p>}
      </section>
    </div>
    {actions && <div className="flex flex-wrap gap-2" data-testid="guided-research-source-actions">{actions}</div>}
  </section>;
}
