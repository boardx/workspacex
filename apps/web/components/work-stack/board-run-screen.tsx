"use client";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DeniedState, EmptyState, ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import { BOARD_RUN_CARDS, type BoardRunCard, type PreviewState } from "@/lib/mock/work-stack";

const COLUMNS: readonly { key: BoardRunCard["column"]; label: string }[] = [
  { key: "in_progress", label: "进行中" },
  { key: "review", label: "待审阅" },
  { key: "done", label: "已完成" },
];

function RunCard({ card }: { card: BoardRunCard }) {
  return (
    <article
      data-testid={`board-run-card-${card.instanceRef}`}
      className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-12 font-medium text-background-foreground">{card.title}</p>
        <Badge tone={card.statusTone} data-testid="board-run-card-status">
          {card.statusBadge}
        </Badge>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex -space-x-1" data-testid="board-run-card-participants">
          {card.participants.map((p) => (
            <Avatar key={p.name} initials={p.initials} tone="ai" size="sm" className="ring-1 ring-card" />
          ))}
        </div>
        <span className="text-10 text-muted-foreground">只读投影 · {card.instanceRef}</span>
      </div>
      {card.failed && (
        <p className="text-10 text-destructive">终态失败，点击查看实例详情与重试入口。</p>
      )}
    </article>
  );
}

export function BoardRunScreen({ state }: { state: PreviewState }) {
  if (state === "denied") {
    return (
      <div data-testid="board-run-projection" className="p-6">
        <DeniedState testid="board-run-denied" />
      </div>
    );
  }

  const cards = state === "empty" ? [] : BOARD_RUN_CARDS;

  return (
    <div data-testid="board-run-projection" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="text-14 font-bold text-background-foreground">看板 · Workflow 运行投影</h1>
        <Badge tone="outline" className="ml-2">只读</Badge>
        <p className="ml-auto text-11 text-muted-foreground">
          Agent 参与者与 Workflow 运行以只读卡投影到看板，点击跳实例详情。
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {state === "loading" ? (
          <LoadingSkeleton testid="board-run-loading" />
        ) : state === "depfail" ? (
          <ErrorState testid="board-run-error" message="投影读模型加载失败，请稍后重试。" />
        ) : cards.length === 0 ? (
          <EmptyState
            testid="board-run-empty"
            message="当前看板还没有 Workflow 运行卡。发起一个 Workflow 后会自动投影到这里。"
          />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {COLUMNS.map((col) => {
              const colCards = cards.filter((c) => c.column === col.key);
              return (
                <section key={col.key} data-testid={`board-run-column-${col.key}`} className="flex flex-col gap-2">
                  <h2 className="flex items-center gap-2 text-12 font-medium text-muted-foreground">
                    {col.label}
                    <span className="rounded-full bg-muted px-1.5 text-10">{colCards.length}</span>
                  </h2>
                  {colCards.length ? (
                    colCards.map((c) => <RunCard key={c.cardId} card={c} />)
                  ) : (
                    <p className="rounded-lg border border-dashed border-border py-6 text-center text-11 text-muted-foreground">
                      本列暂无运行
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
