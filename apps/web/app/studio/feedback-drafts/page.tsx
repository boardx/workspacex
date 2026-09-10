import { AppShell } from "@/components/shell/app-shell";
import { StudioFeedbackDraftsScreen } from "@/components/design-loop/studio-drafts-screen";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * Studio 一级导航「反馈草稿」的独立落点（issue #3339）。
 *
 * 同 `/studio/design-workbench`（`app/studio/design-workbench/page.tsx` 头注）：
 * 选中一级导航项时左栏不该带出平台后台的 `AdminNav` 宽侧栏——那是给平台运维用
 * 的两层 chrome，终端用户一步直达自己的草稿列表不该看到它。`left` 留空，
 * `AppShell` 据此不渲染宽侧栏。
 *
 * 与 `/platform-admin/feedback-drafts`（`app/platform-admin/[module]/page.tsx`）
 * 复用同一个真栈组件（`DesignLoopDraftsScreen`），区别只是这里不套 `AdminNav`。
 * 平台后台那个入口本身不下线，两者是独立路由、独立入口。
 */
export default function StudioFeedbackDraftsPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);

  return (
    <AppShell previewRole={previewRole}>
      <StudioFeedbackDraftsScreen state={state} />
    </AppShell>
  );
}
