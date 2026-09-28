import { AppShell } from "@/components/shell/app-shell";
import { InterviewCreatePage } from "@/components/itv/interview-create-page";

export default function Page({ searchParams }: { searchParams: { projectId?: string } }) {
  return <AppShell previewRole={null} fullscreen><InterviewCreatePage projectId={searchParams.projectId ?? null} /></AppShell>;
}
