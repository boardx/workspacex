import { AppShell } from "@/components/shell/app-shell";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { TasksPreviewContent } from "@/components/tasks/tasks-preview-content";
import { TasksLeftRail } from "@/components/tasks/left-rail";
import { TasksWeekList } from "@/components/tasks/week-list";

/**
 * UI 先行原型 · 任务看板「我的今天」（UC-11.5 / UC-11.6）—— mock 驱动，设计签核用。
 * 生产路由是 `/tasks`（只读真实 API）；本页不在生产导航里。
 */
export default function TasksPreviewPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell identity={identity} previewRole={previewRole} left={<TasksLeftRail />} right={<TasksWeekList />}>
      <TasksPreviewContent state={state} />
    </AppShell>
  );
}
