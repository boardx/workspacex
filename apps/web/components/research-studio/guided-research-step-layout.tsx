import * as React from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GuidedResearchStepLayout({
  assistant,
  wideMain = false,
  reading = false,
  floatingAssistant = false,
  assistantOpen,
  onAssistantOpenChange,
  children,
}: {
  assistant?: React.ReactNode;
  wideMain?: boolean;
  reading?: boolean;
  floatingAssistant?: boolean;
  assistantOpen?: boolean;
  onAssistantOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [internalAssistantOpen, setInternalAssistantOpen] = React.useState(false);
  const reportAssistantOpen = assistantOpen ?? internalAssistantOpen;
  const setReportAssistantOpen = onAssistantOpenChange ?? setInternalAssistantOpen;
  if (floatingAssistant) return <div className="min-w-0">
    <main className="min-w-0" data-testid="research-step-main">{children}</main>
    {assistant && <div className="fixed bottom-5 left-5 z-40 max-w-[calc(100vw-2.5rem)] md:left-10">
      <Button variant="primary" className="h-12 rounded-full px-5 text-lg shadow-lg" aria-expanded={reportAssistantOpen} onClick={() => setReportAssistantOpen(!reportAssistantOpen)}><Bot className="mr-2 size-6" />AI 助手</Button>
      {reportAssistantOpen && <aside data-testid="guided-research-six-step-assistant" className="absolute bottom-14 left-0 h-[min(32rem,70vh)] w-80 overflow-auto rounded-xl border border-border bg-card shadow-xl">{assistant}</aside>}
    </div>}
  </div>;
  if (reading) return <div className="min-w-0 space-y-4" data-layout="report-reading">
    <div className={reportAssistantOpen ? "grid min-w-0 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]" : "min-w-0"}>
      <aside id="report-assistant" hidden={!reportAssistantOpen} className="min-w-0 lg:sticky lg:top-4 lg:h-[calc(100vh-9rem)]">{assistant}</aside>
      <main className="mx-auto w-full min-w-0 max-w-5xl" data-testid="research-step-main">{children}</main>
    </div>
  </div>;
  if (!assistant) return <main className="min-w-0" data-testid="research-step-main">{children}</main>;
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
