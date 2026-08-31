"use client";
import * as React from "react";
import { useOptionalSession } from "@/components/session/session-provider";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { TodayBoard } from "@/components/tasks/today-board";
import { TodayBoardLive } from "@/components/tasks/today-board-live";
import type { UiState } from "@/lib/ui-state";

/**
 * F02/F06 —— 已登录时显示真实数据（`TodayBoardLive`，接后端 `/tasks/today`），
 * 未登录/预览态时保留原有的七态 mock 演示（`TodayBoard`，签核用的视觉原型，
 * `?state=` 手动切换）。两者不是二选一的"替换"关系：mock 版本仍然是设计签核的
 * 呈现物（F06 notes"UI 已建成于 apps/web /tasks"指的就是它），真实版本是这次
 * 接后端之后新增的功能路径。
 */
export function TasksContent({ state }: { state: UiState }) {
  const session = useOptionalSession();
  const authenticated = session?.status === "authenticated";

  if (authenticated) return <TodayBoardLive />;

  return (
    <div className="flex flex-col">
      <div className="border-b border-border-subtle px-5 py-2">
        <StatePreviewSwitcher current={state} />
      </div>
      <TodayBoard state={state} />
    </div>
  );
}
