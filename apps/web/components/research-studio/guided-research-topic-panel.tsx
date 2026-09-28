import type * as React from "react";
import { ResearchPrototypeTips } from "./research-prototype-tips";

export function GuidedResearchTopicPanel({ workspace, actions }: { workspace: React.ReactNode; actions?: React.ReactNode; assistant?: React.ReactNode }) {
  return <section className="grid min-w-0 items-stretch gap-4 lg:grid-cols-[minmax(0,2.05fr)_minmax(18rem,1fr)]" data-testid="guided-research-topic-panel" data-reference-layout="topic-workspace">
    <div data-testid="research-topic-card" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">{workspace}<div className="mt-auto">{actions}</div></div>
    <ResearchPrototypeTips topic />
  </section>;
}
