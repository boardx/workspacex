import { AppShell } from "@/components/shell/app-shell";
import { DigitalExpertDetail } from "@/components/itv/digital-expert-detail";

export default function Page({ params }: { params: { expertId: string } }) {
  return (
    <AppShell previewRole={null}>
      <DigitalExpertDetail expertId={decodeURIComponent(params.expertId)} />
    </AppShell>
  );
}
