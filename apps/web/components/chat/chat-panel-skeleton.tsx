"use client";

import * as React from "react";

/**
 * issue #2075（TW-P2-7「Skeleton + 空态 + 错误态 + 恢复态四态齐」）—— 右栏读取中的骨架行。
 *
 * 此前右栏「产物」/「材料」的加载态是**一行灰字**（"正在读取产物列表…"），
 * 不是骨架屏：内容一到位，那行字消失、列表撑开，布局跳一下。`uiux-standards.md`
 * §0 U1 要的是"skeleton 或带 `data-testid="loading"` 的占位区"，一行字两条都不算。
 *
 * 一份实现两处用（产物 / 材料），不是各画一份——尺寸与节奏是同一个事实。
 */
export function ChatPanelSkeleton({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-3" data-testid="chat-task-workbench-skeleton" aria-busy="true">
      {/* 可见的只有骨架条；这句话是给读屏用户的，视觉上不占位。 */}
      <span className="sr-only">{label}</span>
      <div className="flex animate-pulse flex-col gap-2" aria-hidden>
        <div className="h-9 rounded-md bg-muted" />
        <div className="h-9 rounded-md bg-muted" />
      </div>
    </div>
  );
}
