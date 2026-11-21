import { mockIdentity, MOCK_ORGS } from '@/lib/identity';
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { AppShell } from "@/components/shell/app-shell";
import { ConfigurationPreview } from "./configuration-preview";

export default function PlatformConfigurationPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <AppShell identity={mockIdentity(MOCK_ORGS[0]!.id, null)} previewRole={null} left={<AdminNav scope="platform" active="configuration" />}>
      <ConfigurationPreview />
    </AppShell>
  );
}
