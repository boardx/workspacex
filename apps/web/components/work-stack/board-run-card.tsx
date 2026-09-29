"use client";
/**
 * CT10 —— Board Workflow 运行卡（契约束 work-content ① UI §二；V7 / E10）。
 *
 * 只读投影：数据形状直接取契约 `BoardWorkflowRunCard`，不另起视图模型。卡体不可拖动
 * （`draggable=false`，无拖拽手柄），点击跳实例详情 `href`。无权限的运行在服务端投影前已被
 * 过滤——本组件拿不到就不渲染，列计数也不含它（无占位）。
 */
import * as React from "react";
import type { z } from "zod";
import type { BoardRunBadge, BoardWorkflowRunCard } from "@repo/contracts/work-content";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export type BoardRunCardData = z.infer<typeof BoardWorkflowRunCard>;
type RunBadge = z.infer<typeof BoardRunBadge>;

const BADGE_VIEW: Record<RunBadge, { label: string; tone: "ai" | "warning" | "success" | "neutral" | "danger" }> = {
  in_progress: { label: "进行中", tone: "ai" },
  awaiting_review: { label: "待审批", tone: "warning" },
  done: { label: "完成", tone: "success" },
  rejected: { label: "已驳回", tone: "neutral" },
  failed: { label: "失败", tone: "danger" },
};

const COLUMNS: readonly { key: BoardRunCardData["column"]; label: string }[] = [
  { key: "in_progress", label: "进行中" },
  { key: "review", label: "待审阅" },
  { key: "done", label: "已完成" },
];

function initialsOf(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join("") || "?";
}

function WorkflowIcon() {
  return (
    <svg data-testid="board-run-card-icon" aria-label="Workflow" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-ai-tint-foreground" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="3.5" cy="4" r="2" />
      <circle cx="12.5" cy="4" r="2" />
      <circle cx="8" cy="12" r="2" />
      <path d="M5.5 4h5M4.5 5.8 7 10.2M11.5 5.8 9 10.2" />
    </svg>
  );
}

export function BoardRunCard({ card, onOpen }: { card: BoardRunCardData; onOpen?: (href: string) => void }) {
  const badge = BADGE_VIEW[card.badge];
  const open = () => (onOpen ? onOpen(card.href) : window.location.assign(card.href));
  return (
    <article
      data-testid={`board-run-card-${card.instanceId}`}
      data-card-id={card.id}
      draggable={false}
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open();
      }}
      className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start gap-2">
        <WorkflowIcon />
        <p data-testid="board-run-card-title" className="flex-1 text-12 font-medium text-background-foreground">
          {card.title}
        </p>
        <Badge tone={badge.tone} data-testid="board-run-card-badge" data-badge={card.badge}>
          {badge.label}
        </Badge>
      </div>
      <div className="flex -space-x-1" data-testid="board-run-card-agents">
        {card.agents.length > 0
          ? card.agents.map((a) => (
              <Avatar key={a.agentId} initials={initialsOf(a.displayName)} src={a.avatarUrl} tone="ai" size="sm" title={a.displayName} className="ring-1 ring-card" />
            ))
          : <Avatar initials="人" tone="human" size="sm" title="发起人" className="ring-1 ring-card" />}
      </div>
    </article>
  );
}

export function BoardRunColumns({ cards, onOpen }: { cards: readonly BoardRunCardData[]; onOpen?: (href: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const colCards = cards.filter((c) => c.column === col.key);
        return (
          <section key={col.key} data-testid={`board-run-column-${col.key}`} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-12 font-medium text-muted-foreground">
              {col.label}
              <span data-testid={`board-run-column-count-${col.key}`} className="rounded-full bg-muted px-1.5 text-10">
                {colCards.length}
              </span>
            </h2>
            {colCards.map((c) => (
              <BoardRunCard key={c.id} card={c} onOpen={onOpen} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * 接真实 API 的运行卡看板：全局视图不带 projectId，项目视图带 projectId（服务端同一用例、同一读权限谓词）。
 * 失败只给通用文案，不渲染错误原文或原因码。
 */
export function LiveBoardRunColumns({
  projectId,
  load,
}: {
  projectId?: string | null;
  load: (projectId: string | null) => Promise<{ cards: BoardRunCardData[] }>;
}) {
  const [cards, setCards] = React.useState<BoardRunCardData[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    setCards(null);
    setFailed(false);
    load(projectId ?? null)
      .then((r) => { if (live) setCards(r.cards); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [projectId, load]);
  if (failed) return <p role="alert" data-testid="board-run-cards-error">运行卡加载失败，请稍后重试。</p>;
  if (cards === null) return <p data-testid="board-run-cards-loading">加载中…</p>;
  if (cards.length === 0) return <p data-testid="board-run-cards-empty">暂无可见的 Workflow 运行。</p>;
  return <BoardRunColumns cards={cards} />;
}
