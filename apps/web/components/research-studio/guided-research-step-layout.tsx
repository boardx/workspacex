import * as React from "react";

export function GuidedResearchStepLayout({
  assistant,
  wideMain = false,
  reading = false,
  children,
}: {
  assistant: React.ReactNode;
  wideMain?: boolean;
  reading?: boolean;
  children: React.ReactNode;
}) {
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  if (reading) return <div className="min-w-0 space-y-4" data-layout="report-reading">
    <div className="mx-auto flex max-w-5xl justify-end"><button type="button" aria-expanded={assistantOpen} aria-controls="report-assistant" className="rounded-md border border-border px-4 py-2 text-13 font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setAssistantOpen(!assistantOpen)}>{assistantOpen ? "收起助手" : "修改报告"}</button></div>
    <div className={assistantOpen ? "grid min-w-0 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]" : "min-w-0"}>
      <aside id="report-assistant" hidden={!assistantOpen} className="min-w-0 lg:sticky lg:top-4 lg:h-[calc(100vh-9rem)]">{assistant}</aside>
      <main className="mx-auto w-full min-w-0 max-w-5xl" data-testid="research-step-main">{children}</main>
    </div>
  </div>;
  return (
    <div
      className={wideMain
        ? "grid min-w-0 gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2.7fr)] lg:items-start"
        : "grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start"}
      data-layout="skill-workspace-thirds"
    >
      <details open className="min-w-0 rounded-lg border border-border bg-card lg:contents lg:rounded-none lg:border-0 lg:bg-transparent">
        <summary className="cursor-pointer px-4 py-3 font-medium lg:hidden">研究 Skill 助手</summary>
        <aside className="min-w-0 border-t border-border p-3 lg:sticky lg:top-4 lg:h-[calc(100vh-9rem)] lg:border-0 lg:p-0">{assistant}</aside>
      </details>
      <main className="min-w-0" data-testid="research-step-main">{children}</main>
    </div>
  );
}
