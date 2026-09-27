import type * as React from "react";
import { ResearchPrototypeTips } from "./research-prototype-tips";

export function GuidedResearchTopicPanel({ workspace, actions }: { workspace: React.ReactNode; actions?: React.ReactNode; assistant?: React.ReactNode }) {
  return <section className="grid min-w-0 items-stretch gap-5 lg:grid-cols-[minmax(0,2.05fr)_minmax(18rem,1fr)]" data-testid="guided-research-topic-panel" data-reference-layout="topic-workspace">
    <div data-testid="research-topic-card" className="min-w-0 space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-7">{workspace}{actions}</div>
    <ResearchPrototypeTips topic />
  </section>;
}
