import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { KG_TODO_STATUS_LABEL_ZH, type KgClaim, type KgTodoStatus } from "@repo/contracts/chat-knowledge-graph";

/** 待办状态 → Badge tone（颜色只是辅助，状态一律带文字，E6）。 */
const TODO_TONE: Record<KgTodoStatus, React.ComponentProps<typeof Badge>["tone"]> = {
  open: "primary",
  done: "success",
  dropped: "neutral",
};

/** 「M/D」（浏览器本地日期）。`until` 是左闭右开的终点：显示最后一个仍成立的那天。 */
export function lastDayLabel(until: string): string | null {
  const t = Date.parse(until);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t - 1);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * issue #4363（S6）：一条记忆的时间维度——待办状态与截止、有效期与「已过期」。面板与大脑页共用。
 * 服务端算好 `expired`（同召回同一个判定）；这里只负责把它说出来。没有时间维度的记忆什么都不渲染。
 */
export function ClaimTimeBadges({ claim }: { claim: Pick<KgClaim, "validUntil" | "expired" | "todoStatus" | "dueAt"> }) {
  const due = claim.dueAt ? lastDayLabel(claim.dueAt) : null;
  const until = claim.validUntil ? lastDayLabel(claim.validUntil) : null;
  const parts: React.ReactNode[] = [];
  if (claim.todoStatus) {
    parts.push(
      <Badge key="todo" tone={TODO_TONE[claim.todoStatus]} data-testid={`kg-todo-status-${claim.todoStatus}`}>
        {KG_TODO_STATUS_LABEL_ZH[claim.todoStatus]}
      </Badge>,
    );
    if (due !== null && claim.todoStatus === "open") {
      parts.push(<span key="due" className="text-10 text-muted-foreground" data-testid="kg-todo-due">截止 {due}</span>);
    }
  }
  if (claim.expired) {
    parts.push(
      <Badge key="expired" tone="outline" data-testid="kg-claim-expired">
        已过期{until !== null ? ` · 到 ${until} 为止` : ""}
      </Badge>,
    );
  } else if (until !== null) {
    parts.push(<span key="until" className="text-10 text-muted-foreground" data-testid="kg-claim-valid-until">有效到 {until}</span>);
  }
  if (parts.length === 0) return null;
  return <span className="inline-flex flex-wrap items-center gap-1" data-testid="kg-claim-time">{parts}</span>;
}
