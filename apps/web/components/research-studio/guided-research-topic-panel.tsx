import type * as React from "react";

export function GuidedResearchTopicPanel({ workspace, assistant }: { workspace: React.ReactNode; assistant: React.ReactNode }) {
  return <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]" data-testid="guided-research-topic-panel">
    <div className="min-w-0 space-y-5">{workspace}</div>
    <aside className="min-w-0 rounded-xl border border-border bg-card p-4 xl:sticky xl:top-4 xl:h-fit" data-testid="guided-research-topic-assistant">
      <p className="text-sm font-semibold">Deep Research 助手</p>
      <p className="mt-1 text-12 text-muted-foreground">建议只会在你明确应用后写入研究内容。</p>
      <div className="mt-4">{assistant}</div>
    </aside>
  </section>;
}
