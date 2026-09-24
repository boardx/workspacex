"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { TurnMemory } from "@/lib/knowledge-graph-api";

/**
 * U-1：回答气泡下方的单行「已记下 N 条 · 查看 · 撤销」（价值出现在对话里，不藏在面板）。
 * - 还在整理 → 「正在记…」（不阻塞正文，E10）。
 * - 已记下 → 一行灰字，可「查看」展开逐条、可「撤销」这一整轮的记录。
 *   打扰要克制（E8）：这只有一行，不遮正文；本轮的主动卡片另算，最多一张。
 *
 * - `onView`：给了就「查看」= 打开右栏「记忆」面板（真实 `/chat`）；没给就在原位展开逐条（签核预览）。
 * - `undo`：撤销这一轮的真实通路（`revokeClaim` 批量）F10 才接。`"unavailable"`（默认）时「撤销」
 *   是禁用态并说明原因——不是一个点了只改本地状态、刷新就回来的假按钮；`"local"` 只给签核预览演示用。
 */
export function AnswerMemoryLine({
  turn,
  onView,
  undo = "unavailable",
}: {
  turn: TurnMemory;
  onView?: () => void;
  undo?: "local" | "unavailable";
}) {
  const [open, setOpen] = React.useState(false);
  const [undone, setUndone] = React.useState(false);

  if (turn.pending) {
    return (
      <p className="mt-2 flex items-center gap-1 text-10 text-muted-foreground" data-testid="kg-turn-pending">
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
        正在记…
      </p>
    );
  }

  if (turn.captured.length === 0) return null;

  if (undone) {
    return (
      <p className="mt-2 text-10 text-muted-foreground" data-testid="kg-turn-captured-undone">
        已撤销这一轮的记录
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1" data-testid="kg-turn-captured">
      <p className="flex items-center gap-1 text-10 text-muted-foreground">
        <Sparkles aria-hidden className="h-3 w-3" />
        已记下 {turn.captured.length} 条
        <span aria-hidden>·</span>
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 transition-colors duration-base hover:underline"
          data-testid="kg-turn-captured-view"
          aria-expanded={onView ? undefined : open}
          onClick={() => (onView ? onView() : setOpen((v) => !v))}
        >
          查看
        </button>
        <span aria-hidden>·</span>
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 transition-colors duration-base hover:underline disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:hover:no-underline"
          data-testid="kg-turn-captured-undo"
          disabled={undo === "unavailable"}
          title={undo === "unavailable" ? "撤销这一轮的记录暂未开放，可以在记忆面板里逐条查看" : undefined}
          onClick={() => setUndone(true)}
        >
          撤销
        </button>
      </p>
      {open ? (
        <ul className="ml-4 flex list-disc flex-col gap-0.5 text-10 text-muted-foreground" data-testid="kg-turn-captured-list">
          {turn.captured.map((c) => (
            <li key={c.claimId} data-testid={`kg-turn-captured-item-${c.claimId}`}>{c.statement}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
