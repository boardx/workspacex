import { AppShell } from "@/components/shell/app-shell";
import { DigitalInterviewSetup } from "@/components/itv/digital-interview-setup";

export default function Page({ params }: { params: { interviewId: string } }) {
  return <AppShell previewRole={null}><DigitalInterviewSetup interviewId={params.interviewId} /></AppShell>;
}
