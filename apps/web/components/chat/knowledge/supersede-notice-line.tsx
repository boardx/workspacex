"use client";

import * as React from "react";
import { ArrowRightLeft } from "lucide-react";
import type { KgSupersedeNotice } from "@repo/contracts/chat-knowledge-graph";

/**
 * Issue #4290（人类决定 2026-09-26）：本人明确改口时，新决定自动取代旧决定——回答下方一行
 * 「已用〈新〉取代〈旧〉 · 撤销」。数据是 `getTurnMemory.supersede`（服务端只给看得到两条结论的人）。
 *
 * - 这是一行附注，不是卡片（不占 I-18「一轮一张主动卡」的名额），样式与「已记下 N 条」同一行级（U-1）。
 * - 「撤销」只在 `onUndo` 给了时渲染（所有者，读模型快照 `canEdit`）；点了经 `applyHumanAction{undoSupersede}`
 *   执行，成功后收成「已撤销：〈旧〉恢复为生效」。失败时 `onUndo` reject 的已经是人话，显示在这一行下，可以再试。
 * - 服务端读作 `undone`（别的标签页撤过）⇒ 直接显示撤销后的那一行。
 */
export function SupersedeNoticeLine({
  notice,
  onUndo,
}: {
  notice: KgSupersedeNotice;
  onUndo?: () => Promise<void>;
}) {
  const [undone, setUndone] = React.useState(notice.state === "undone");
  const [undoing, setUndoing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const runUndo = () => {
    if (!onUndo || undoing) return;
    setUndoing(true);
    setError(null);
    onUndo().then(
      () => { setUndoing(false); setUndone(true); },
      (e: unknown) => { setUndoing(false); setError(e instanceof Error ? e.message : "没能撤销，请稍后重试。"); },
    );
  };

  if (undone) {
    return (
      <p className="mt-2 text-10 text-muted-foreground" data-testid="kg-supersede-undone">
        已撤销：〈{notice.olderClaim.statement}〉恢复为生效
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1" data-testid="kg-supersede-notice">
      <p className="flex flex-wrap items-center gap-1 text-10 text-muted-foreground">
        <ArrowRightLeft aria-hidden className="h-3 w-3" />
        <span data-testid="kg-supersede-text">
          已用〈{notice.newerClaim.statement}〉取代〈{notice.olderClaim.statement}〉
        </span>
        {onUndo ? (
          <>
            <span aria-hidden>·</span>
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 transition-colors duration-base hover:underline disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:hover:no-underline"
              data-testid="kg-supersede-undo"
              disabled={undoing}
              onClick={runUndo}
            >
              {undoing ? "撤销中…" : "撤销"}
            </button>
          </>
        ) : null}
      </p>
      {error !== null ? (
        <p role="alert" className="text-10 text-destructive" data-testid="kg-supersede-undo-error">{error}</p>
      ) : null}
    </div>
  );
}
