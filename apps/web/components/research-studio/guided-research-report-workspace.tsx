import type * as React from "react";

export function GuidedResearchReportWorkspace({ actions, contents, document, metrics, limitation }: {
  actions: React.ReactNode;
  contents: React.ReactNode;
  document: React.ReactNode;
  metrics: React.ReactNode;
  limitation: React.ReactNode;
}) {
  return <section className="space-y-5" data-testid="guided-research-report-workspace" data-reference-layout="report-document">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4"><div><p className="text-12 font-medium text-primary">步骤 6 · 研究报告</p><h1 className="mt-1 text-24 font-semibold">研究报告</h1></div><div className="flex flex-wrap gap-2">{actions}</div></header>
    <div className="grid min-w-0 gap-5 xl:grid-cols-[13rem_minmax(0,1fr)_15rem]">
      <aside className="rounded-xl border border-primary/15 bg-accent/20 p-4 shadow-sm xl:sticky xl:top-4 xl:h-fit" data-testid="guided-research-report-contents"><h2 className="text-sm font-semibold">报告目录</h2><div className="mt-3">{contents}</div></aside>
      <main className="min-w-0 rounded-xl border border-primary/15 bg-card p-4 shadow-sm sm:p-6" data-testid="guided-research-report-body">{document}</main>
      <aside className="space-y-4"><section className="rounded-xl border border-primary/15 bg-accent/20 p-4 shadow-sm" data-testid="guided-research-report-metrics"><h2 className="text-sm font-semibold">质量与来源</h2><div className="mt-3">{metrics}</div></section><section className="rounded-xl border border-destructive/40 bg-muted p-4 shadow-sm" data-testid="guided-research-report-limitation"><h2 className="text-sm font-semibold">证据限制</h2><div className="mt-3 text-sm">{limitation}</div></section></aside>
    </div>
  </section>;
}
