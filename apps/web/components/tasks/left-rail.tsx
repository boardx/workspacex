"use client";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { TASK_VIEWS, RUN_CENTER } from "@/lib/mock/tasks";

/** 左栏视图切换：按行动方 / 按项目（预览手段，切换只改本地高亮）*/
const GROUPINGS = [
  { key: "by-actor", label: "按行动方" },
  { key: "by-project", label: "按项目" },
] as const;

export function TasksLeftRail() {
  const [grouping, setGrouping] = React.useState<string>("by-actor");
  // 视图选择：默认落在 primary 视图（我的今天）。切换是预览手段，改的是本地高亮。
  const [activeView, setActiveView] = React.useState<string>(
    TASK_VIEWS.find((v) => v.primary)?.key ?? TASK_VIEWS[0]?.key ?? "my-today",
  );

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex items-center gap-1 rounded-md border border-border-subtle bg-card p-0.5" data-testid="tasks-grouping-switch">
        {GROUPINGS.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setGrouping(g.key)}
            data-testid={`tasks-grouping-${g.key}`}
            className={cn(
              "flex-1 rounded-sm px-2 py-1 text-11 font-medium transition-colors duration-200",
              grouping === g.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      <nav className="flex flex-col gap-0.5" data-testid="tasks-view-list">
        {TASK_VIEWS.map((v) => {
          const selected = activeView === v.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setActiveView(v.key)}
              aria-current={selected ? "page" : undefined}
              data-testid={`tasks-view-${v.key}`}
              className={cn(
                "flex items-center justify-between rounded-md px-2 py-1.5 text-12 transition-colors duration-200",
                selected ? "bg-accent text-accent-foreground" : "text-background-foreground hover:bg-muted",
              )}
            >
              <span className={cn(selected && "font-medium")}>{v.label}</span>
              <span className="text-10 text-muted-foreground">{v.count}</span>
            </button>
          );
        })}
      </nav>

      <section className="flex flex-col gap-2" data-testid="tasks-run-center">
        <div className="flex items-center gap-2">
          <h2 className="text-11 font-semibold uppercase tracking-wide text-muted-foreground">运行中心</h2>
          <Badge tone="ai">{RUN_CENTER.length} 个在跑</Badge>
        </div>
        <ul className="flex flex-col gap-2">
          {RUN_CENTER.map((r) => (
            <li key={r.id} data-testid={`tasks-run-${r.id}`} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-card p-2">
              <div className="flex items-center gap-1.5">
                <Avatar initials={r.initials} tone="ai" size="xs" />
                <span className="min-w-0 truncate text-11 font-medium">{r.title}</span>
              </div>
              <span className="text-10 text-muted-foreground">{r.step}</span>
              <Progress value={55} label={`${r.title} 进度`} />
            </li>
          ))}
        </ul>
      </section>

      <p className="text-10 text-muted-foreground" data-testid="tasks-left-footnote">
        token、读取文件数、内部步骤都在任务详情的「执行」页，不占这一屏。
      </p>
    </div>
  );
}
