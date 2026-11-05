"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { TurnMemory } from "@/lib/knowledge-graph-api";
import { useI18n } from "@/lib/i18n/provider";
import { HumanActionDisplayError, describeHumanActionFailure } from "@/lib/knowledge-graph-failure";

/**
 * U-1：回答气泡下方的单行「已记下 N 条 · 查看 · 撤销」（价值出现在对话里，不藏在面板）。
 * - 还在整理 → 「正在记…」（不阻塞正文，E10）。
 * - 已记下 → 一行灰字，可「查看」展开逐条、可「撤销」这一整轮的记录。
 *   打扰要克制（E8）：这只有一行，不遮正文；本轮的主动卡片另算，最多一张。
 *
 * - `onView`：给了就「查看」= 打开右栏「记忆」面板（真实 `/chat`）；没给就在原位展开逐条（签核预览）。
 * - `onUndo`（F10）：撤销这一轮 = 把本轮记下的逐条忘掉（`revokeClaim`）。只有所有者才传；
 *   不传时「撤销」**不渲染**（非所有者看不到一个点了必被拒的按钮）。失败返回的人话显示在这一行下。
 * - `undo="local"`：只给签核预览演示用（只切本地状态，不落后端）。
 */
export function AnswerMemoryLine({
  turn,
  onView,
  onUndo,
  undo,
}: {
  turn: TurnMemory;
  onView?: () => void;
  /** 成功 resolve；失败 reject 一个已经是人话的 `Error.message`。 */
  onUndo?: () => Promise<void>;
  undo?: "local";
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [undone, setUndone] = React.useState(false);
  const [undoing, setUndoing] = React.useState(false);
  const [undoError, setUndoError] = React.useState<{ owned: HumanActionDisplayError } | { raw: string } | { fallback: true } | null>(null);
  const canUndo = onUndo !== undefined || undo === "local";
  const runUndo = () => {
    if (!onUndo) { setUndone(true); return; }
    setUndoing(true);
    setUndoError(null);
    onUndo().then(
      () => { setUndoing(false); setUndone(true); },
      (e: unknown) => { setUndoing(false); setUndoError(e instanceof HumanActionDisplayError ? { owned: e } : e instanceof Error ? { raw: e.message } : { fallback: true }); },
    );
  };

  if (turn.pending) {
    return (
      <p className="mt-2 flex items-center gap-1 text-10 text-muted-foreground" data-testid="kg-turn-pending">
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
        {t("chatKnowledge.turn.pending")}
      </p>
    );
  }

  if (turn.captured.length === 0) return null;

  if (undone) {
    return (
      <p className="mt-2 text-10 text-muted-foreground" data-testid="kg-turn-captured-undone">
        {t("chatKnowledge.turn.undone")}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1" data-testid="kg-turn-captured">
      <p className="flex items-center gap-1 text-10 text-muted-foreground">
        <Sparkles aria-hidden className="h-3 w-3" />
        {t("chatKnowledge.turn.captured", { count: turn.captured.length })}
        <span aria-hidden>·</span>
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 transition-colors duration-base hover:underline"
          data-testid="kg-turn-captured-view"
          aria-expanded={onView ? undefined : open}
          onClick={() => (onView ? onView() : setOpen((v) => !v))}
        >
          {t("chatKnowledge.turn.view")}
        </button>
        {canUndo ? (
          <>
            <span aria-hidden>·</span>
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 transition-colors duration-base hover:underline disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:hover:no-underline"
              data-testid="kg-turn-captured-undo"
              disabled={undoing}
              onClick={runUndo}
            >
              {t(undoing ? "chatKnowledge.notice.undoing" : "chatKnowledge.memory.undo")}
            </button>
          </>
        ) : null}
      </p>
      {undoError !== null ? (
        <p role="alert" className="text-10 text-destructive" data-testid="kg-turn-undo-error">{"owned" in undoError ? describeHumanActionFailure(undoError.owned.failure, locale) : "raw" in undoError ? undoError.raw : t("chatKnowledge.notice.undoFailed")}</p>
      ) : null}
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
