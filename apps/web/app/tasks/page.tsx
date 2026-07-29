import { AppShell } from "@/components/shell/app-shell";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { TodayBoard } from "@/components/tasks/today-board";
import { TasksLeftRail } from "@/components/tasks/left-rail";
import { TasksWeekList } from "@/components/tasks/week-list";

/**
 * 任务看板 · 我的今天 —— UC-11.5（四语义分区）+ UC-11.6 入口（授权流）。
 *
 * 服务端组件：读 searchParams 决定七态与预览视角。所有事件处理器都下沉到
 * `"use client"` 子组件（TodayBoard / TasksLeftRail），不从服务端往客户端传函数。
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
      <div className="flex flex-col">
        <div className="border-b border-border-subtle px-5 py-2">
          <StatePreviewSwitcher current={state} />
        </div>
        <TodayBoard state={state} />
      </div>
    </AppShell>
  );
}
