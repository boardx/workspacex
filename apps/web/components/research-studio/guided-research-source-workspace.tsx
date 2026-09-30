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

  return <section className="space-y-4" data-testid="guided-research-source-workspace" data-reference-layout="research-sources">
    <div className={urls.length > 0 ? "min-w-0" : "sr-only"}>
      <section className="min-w-0 rounded-xl border border-border bg-card p-5" {...(urls.length > 0 ? { "data-testid": "guided-research-source-evidence" } : {})}>
        <h2 className="text-lg font-bold">研究资料</h2>
        <ol aria-label="已获取的研究资料" aria-live="polite" aria-relevant="additions" className="mt-4 space-y-3">
          {urls.map((source, index) => <li key={source.id} className="flex min-w-0 gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">{index + 1}.</span>
            <a href={source.url} title={source.document?.summary ?? source.presentation?.summary ?? source.content} target="_blank" rel="noopener noreferrer"
              data-testid={`research-source-description-${source.id}`}
              onClick={(event) => { if (event.detail > 0) event.preventDefault(); }}
              onDoubleClick={() => window.open(source.url, "_blank", "noopener,noreferrer")}
              className="min-w-0 rounded-sm font-medium leading-relaxed underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              {source.presentation?.title ?? source.title}
            </a>
          </li>)}
        </ol>
      </section>
    </div>
    {actions && <div className="flex flex-wrap gap-2" data-testid="guided-research-source-actions">{actions}</div>}
  </section>;
}
