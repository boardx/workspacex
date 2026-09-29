"use client";
import * as React from "react";
import { StatePreviewSwitcher } from "@/components/state/state-shell";
import { TodayBoard } from "@/components/tasks/today-board";
import type { UiState } from "@/lib/ui-state";

/**
 * 「我的今天」七态 mock 演示（设计签核用的视觉原型，`?state=` 手动切换）。
 *
 * ⚠ 只挂在 UI 先行原型命名空间 `/preview/tasks`。此前它是生产 `/tasks` 的"未登录回落"，
 * 生产页同时还用 mock 身份画顶栏、用 mock 画左右栏——于是真实登录用户在真实空态旁边
 * 看到一整套编造的人物、运行与待签字卡片。生产 `/tasks` 现在只渲染 `TodayBoardLive`。
 */
export function TasksPreviewContent({ state }: { state: UiState }) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-border-subtle px-5 py-2">
        <StatePreviewSwitcher current={state} />
      </div>
      <TodayBoard state={state} />
    </div>
  );
}
