import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WAITING_CARDS } from "@/lib/mock/tasks";

/** 右栏「本周清单」—— 我交出去、仍在等他人的高/中优先项（④ 区的浓缩视图）*/
export function TasksWeekList() {
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="tasks-week-list">
      <h2 className="text-13 font-semibold">本周清单</h2>
      <p className="text-11 text-muted-foreground">
        我已交棒、仍在等他人的关键项。逾期项可从「下一步轮到别人」区催办。
      </p>
      <ul className="flex flex-col gap-1.5">
        {WAITING_CARDS.map((c) => (
          <li
            key={c.id}
            data-testid={`tasks-week-item-${c.id}`}
            className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2"
          >
            <div className="flex items-center gap-1.5">
              {c.priority && (
                <Badge tone={c.priority === "高" ? "danger" : "neutral"}>{c.priority}</Badge>
              )}
              <span className="min-w-0 flex-1 text-11 font-medium">{c.what}</span>
            </div>
            <span className="flex items-center justify-between text-10 text-muted-foreground">
              <span>在等 {c.waitingOn}</span>
              <span className={cn(c.overdue && "text-destructive")}>{c.due}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
