import * as React from "react";

export function GuidedResearchStepLayout({
  assistant,
  children,
}: {
  assistant: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="min-w-0 lg:hidden">
        <details className="min-w-0 rounded-lg border border-border bg-card">
          <summary className="cursor-pointer px-4 py-3 font-medium">研究 Skill 助手</summary>
          <div className="min-w-0 border-t border-border p-3">{assistant}</div>
        </details>
        <main className="min-w-0 pt-5">{children}</main>
      </div>
      <div className="hidden lg:block">
        <div className="grid min-w-0 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="min-w-0 lg:sticky lg:top-5 lg:self-start">{assistant}</aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </>
  );
}
