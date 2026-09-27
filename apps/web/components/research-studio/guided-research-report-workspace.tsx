import type * as React from "react";

export function GuidedResearchReportWorkspace({ actions, contents, document, metrics, limitation }: {
  actions: React.ReactNode;
  contents: React.ReactNode;
  document: React.ReactNode;
  metrics: React.ReactNode;
  limitation: React.ReactNode;
}) {
  return <section className="space-y-5" data-testid="guided-research-report-workspace" data-reference-layout="report-document">
    <header className="flex flex-wrap items-center justify-between gap-3 pb-4"><div><h1 className="text-4xl font-bold">研究报告</h1><p className="mt-3 text-lg text-muted-foreground">查看基于研究需求与来源证据生成的完整报告。</p></div><div className="flex flex-wrap gap-2">{actions}</div></header>
    <div className="grid min-w-0 gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded-xl border border-primary/15 bg-accent/20 p-4 shadow-sm xl:sticky xl:top-4 xl:h-fit" data-testid="guided-research-report-contents"><h2 className="text-sm font-semibold">报告目录</h2><div className="mt-3">{contents}</div></aside>
      <main className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6" data-testid="guided-research-report-body"><div className="mb-6 rounded-lg border bg-muted/20 p-5">{metrics}</div>{document}<div className="mt-6 border-t pt-5">{limitation}</div></main>
    </div>
  </section>;
}
