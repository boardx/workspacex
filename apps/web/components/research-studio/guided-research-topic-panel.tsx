import type * as React from "react";

export function GuidedResearchTopicPanel({ workspace, assistant }: { workspace: React.ReactNode; assistant: React.ReactNode }) {
  return <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]" data-testid="guided-research-topic-panel" data-reference-layout="topic-workspace">
    <div className="min-w-0 space-y-5 rounded-xl border border-primary/15 bg-card p-4 shadow-sm sm:p-5">{workspace}</div>
    <aside className="min-w-0 rounded-xl border border-primary/20 bg-accent/25 p-4 shadow-sm xl:sticky xl:top-4 xl:h-fit" data-testid="guided-research-topic-assistant">
      <p className="text-sm font-semibold text-accent-foreground">Deep Research 助手</p>
      <p className="mt-1 text-12 text-muted-foreground">建议只会在你明确应用后写入研究内容。</p>
      <div className="mt-4">{assistant}</div>
    </aside>
  </section>;
}
