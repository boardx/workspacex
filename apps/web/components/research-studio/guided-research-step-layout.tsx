import * as React from "react";

export function GuidedResearchStepLayout({
  assistant,
  children,
}: {
  assistant: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start"
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
