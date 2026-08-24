"use client";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { TASK_VIEWS, RUN_CENTER } from "@/lib/mock/tasks";

/**
 * 左栏（272px）—— 原型实测字节 15920518 起：
 *   `任务` 标题 → `人和 AI 共用同一种任务对象` 副标题 → `＋ 新建任务`（黑底主按钮）→ 视图列表 → 运行中心。
 * ⚠ `按行动方`/`按项目` 分组切换**不在左栏**——原型里那两个按钮在中栏内容头（56px 顶条），
 *   随 `TodayBoard` 的页头一起渲染，这里不重复放。
 */
export function TasksLeftRail() {
  // 视图选择：默认落在 primary 视图（我的今天）。切换是预览手段，改的是本地高亮。
  const [activeView, setActiveView] = React.useState<string>(
    TASK_VIEWS.find((v) => v.primary)?.key ?? TASK_VIEWS[0]?.key ?? "my-today",
  );

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-2 pb-1" data-testid="tasks-left-heading">
        <div>
          <h1 className="text-13 font-semibold">任务</h1>
          <p className="text-10 text-muted-foreground">人和 AI 共用同一种任务对象</p>
        </div>
        <Button
          size="sm"
          variant="primary"
          className="w-full justify-center"
          onClick={() => window.alert("演示：任务创建流程")}
          data-testid="tasks-new-task-rail"
        >
          ＋ 新建任务
        </Button>
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
                "flex items-center justify-between rounded-md border-l-2 px-2 py-1.5 text-12 transition-colors duration-200",
                selected
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-transparent text-background-foreground hover:bg-muted",
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
