import { AppShell } from "@/components/shell/app-shell";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { TasksContent } from "@/components/tasks/tasks-content";
import { TasksLeftRail } from "@/components/tasks/left-rail";
import { TasksWeekList } from "@/components/tasks/week-list";

/**
 * 任务看板 · 我的今天 —— UC-11.5（四语义分区）+ UC-11.6 入口（授权流）。
 *
 * 服务端组件：读 searchParams 决定七态与预览视角。所有事件处理器都下沉到
 * `"use client"` 子组件（`TasksContent` 内部按登录态在真实数据/mock 演示间选择）。
 */
export default function TasksPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<TasksLeftRail />}
      right={<TasksWeekList />}
    >
      <TasksContent state={state} />
    </AppShell>
  );
}
