import type * as React from "react";

export function GuidedResearchReportWorkspace({ actions, contents, document, metrics, limitation }: {
  actions: React.ReactNode;
  contents: React.ReactNode;
  document: React.ReactNode;
  metrics: React.ReactNode;
  limitation: React.ReactNode;
}) {
  return <section className="space-y-5" data-testid="guided-research-report-workspace" data-reference-layout="report-document">
    {actions && <div className="flex flex-wrap justify-end gap-3">{actions}</div>}
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(16rem,0.75fr)_minmax(0,2fr)]">
      <aside className="rounded-xl border border-border bg-card p-6 shadow-sm xl:sticky xl:top-52 xl:h-fit" data-testid="guided-research-report-contents"><h2 className="text-3xl font-bold">报告目录</h2><div className="mt-5 text-base leading-loose">{contents}</div></aside>
      <main className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6" data-testid="guided-research-report-body">{metrics && <div data-testid="guided-research-report-metrics" className="mb-6 rounded-lg border bg-muted/20 p-5">{metrics}</div>}{document}<div data-testid="guided-research-report-limitation" className="mt-6 border-t pt-5">{limitation}</div></main>
    </div>
  </section>;
}
