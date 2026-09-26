import type * as React from "react";

function Region({ title, testId, children, accent = false }: { title: string; testId: string; children: React.ReactNode; accent?: boolean }) {
  return <section className={`rounded-xl border p-4 shadow-sm ${accent ? "border-primary/20 bg-accent/20" : "border-border bg-card"}`} data-testid={testId}><h2 className="text-sm font-semibold">{title}</h2><div className="mt-3">{children}</div></section>;
}

export function GuidedResearchSourceWorkspace({ progress, activity, evidence, insights, risk, actions }: {
  progress: React.ReactNode;
  activity: React.ReactNode;
  evidence: React.ReactNode;
  insights: React.ReactNode;
  risk: React.ReactNode;
  actions: React.ReactNode;
}) {
  return <section className="space-y-5" data-testid="guided-research-source-workspace" data-reference-layout="research-operations">
    <div className="border-b border-border pb-4"><p className="text-12 font-medium text-primary">步骤 5 · 资料研究</p><h1 className="mt-1 text-24 font-semibold">资料研究</h1><p className="mt-2 text-sm text-muted-foreground">实时查看任务、活动、来源证据与待处理风险。</p></div>
    <div className="grid min-w-0 gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_16rem]">
      <div className="space-y-4"><Region title="研究进度" testId="guided-research-source-progress" accent>{progress}</Region><div className="flex flex-wrap gap-2">{actions}</div></div>
      <div className="min-w-0 space-y-4"><Region title="最新动态" testId="guided-research-source-activity">{activity}</Region><Region title="来源与证据" testId="guided-research-source-evidence">{evidence}</Region></div>
      <div className="space-y-4"><Region title="关键发现" testId="guided-research-source-insights" accent>{insights}</Region><Region title="风险提示" testId="guided-research-source-risks">{risk}</Region></div>
    </div>
  </section>;
}
