import type * as React from "react";

function Region({ title, testId, children, accent = false }: { title: string; testId: string; children: React.ReactNode; accent?: boolean }) {
  return <section className={`rounded-xl border p-6 shadow-sm ${accent ? "border-border bg-muted/20" : "border-border bg-card"}`} data-testid={testId}><h2 className="text-2xl font-bold">{title}</h2><div className="mt-5 text-base leading-relaxed">{children}</div></section>;
}

export function GuidedResearchSourceWorkspace({ progress, activity, evidence, insights, risk, actions, sourcePreview }: {
  progress: React.ReactNode;
  activity: React.ReactNode;
  evidence: React.ReactNode;
  insights: React.ReactNode;
  risk: React.ReactNode;
  actions: React.ReactNode;
  sourcePreview?: React.ReactNode;
}) {
  return <section className="space-y-5" data-testid="guided-research-source-workspace" data-reference-layout="research-operations">
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)_minmax(0,1fr)]">
      <div className="space-y-4"><Region title="研究章节与任务" testId="guided-research-source-progress" accent>{progress}</Region></div>
      <div className="min-w-0 space-y-4"><Region title="实时动态" testId="guided-research-source-activity">{activity}</Region><div className="flex flex-wrap gap-2">{actions}</div></div>
      <div className="space-y-4"><Region title="研究洞察" testId="guided-research-source-insights" accent>{insights}</Region><Region title="关键来源" testId="guided-research-source-evidence">{sourcePreview ? <>{sourcePreview}<details className="mt-4"><summary className="cursor-pointer font-medium">查看全部来源与 Markdown</summary><div className="mt-4">{evidence}</div></details></> : evidence}</Region><Region title="潜在冲突 / 风险提示" testId="guided-research-source-risks">{risk}</Region></div>
    </div>
  </section>;
}
