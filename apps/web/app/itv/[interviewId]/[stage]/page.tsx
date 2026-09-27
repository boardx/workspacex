import { notFound } from "next/navigation";
import { DigitalInterviewSetup } from "@/components/itv/digital-interview-setup";
import type { WorkbenchStep } from "@/components/itv/digital-interview-workflow";
import { AppShell } from "@/components/shell/app-shell";

const STAGES: readonly WorkbenchStep[] = ["intake", "analysis", "experts", "outline", "runs", "report"];

export default function Page({ params }: { params: { interviewId: string; stage: string } }) {
  if (!STAGES.includes(params.stage as WorkbenchStep)) notFound();
  return <AppShell previewRole={null} fullscreen><DigitalInterviewSetup interviewId={params.interviewId} initialWorkbenchStep={params.stage as WorkbenchStep} /></AppShell>;
}
