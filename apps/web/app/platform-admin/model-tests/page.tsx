import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { PlatformModelTestbench } from "@/components/admin/platform-model-testbench";
export default function PlatformModelTestsPage() {
  return <AppShell previewRole={null} left={<AdminNav active="model-tests" scope="platform" />}><PlatformModelTestbench /></AppShell>;
}
