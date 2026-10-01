import { notFound } from "next/navigation";
import { DigitalInterviewSetup } from "@/components/itv/digital-interview-setup";
import type { WorkbenchStep } from "@/components/itv/digital-interview-workflow";
import { AppShell } from "@/components/shell/app-shell";

const STAGES: readonly WorkbenchStep[] = ["intake", "analysis", "experts", "outline", "runs", "report"];

export default function Page({ params, searchParams = {} }: { params: { interviewId: string; stage: string }; searchParams?: { documentId?: string; version?: string } }) {
  if (!STAGES.includes(params.stage as WorkbenchStep)) notFound();
  const pinned = searchParams.documentId !== undefined || searchParams.version !== undefined;
  const version = Number(searchParams.version);
  if (pinned && (!searchParams.documentId || !Number.isSafeInteger(version) || version < 1)) notFound();
  return <AppShell previewRole={null} fullscreen><DigitalInterviewSetup interviewId={params.interviewId} initialWorkbenchStep={params.stage as WorkbenchStep} reportPin={pinned ? { documentId: searchParams.documentId!, version } : undefined} /></AppShell>;
}
