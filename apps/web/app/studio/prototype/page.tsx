import { AppShell } from "@/components/shell/app-shell";
import { PrototypeScreen } from "@/components/studio/prototype-screen";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";

/**
 * Studio · 原型（07-canvas / uc-7-1 · PROTOTYPE-DIGEST 第五节）
 * 单栏 825px，无左右栏——内容自己在 max-w-[825px] 里居中。
 */
export default function StudioPrototypePage({
  searchParams,
}: { searchParams: { state?: string; as?: string; org?: string } }) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell identity={identity} previewRole={previewRole}>
      <PrototypeScreen state={state} />
    </AppShell>
  );
}
