import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { OverviewScreen } from "@/components/admin/overview-screen";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";

/**
 * 后台 · 总览（治理 · 17-gov）
 * 后台是两栏布局（图标栏 + 左 272 + 中），无右栏——照 PROTOTYPE-DIGEST 第八节实测。
 */
export default function AdminOverviewPage({
  searchParams,
}: { searchParams: { state?: string; as?: string; org?: string } }) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell identity={identity} previewRole={previewRole} left={<AdminNav active="overview" />}>
      <OverviewScreen state={state} />
    </AppShell>
  );
}
