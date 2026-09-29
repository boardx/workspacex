/** WF08 —— Workflow 路由左栏导航（我的运行 / 待我审批）；CT10 加 Board 运行卡视图。 */
import * as React from "react";
import { CheckSquare, KanbanSquare, PlayCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type WorkflowNavKey = "runs" | "approvals" | "board";

const ITEMS: ReadonlyArray<{ key: WorkflowNavKey; href: string; label: string; icon: LucideIcon }> = [
  { key: "runs", href: "/workflows/runs", label: "我的运行", icon: PlayCircle },
  { key: "approvals", href: "/workflows/approvals", label: "待我审批", icon: CheckSquare },
  { key: "board", href: "/workflows/board", label: "运行看板", icon: KanbanSquare },
];

/** 左栏样式同后台左栏（`admin-nav.tsx`）：标题 + 一列带图标的链接，当前页高亮。 */
export function WorkflowNav({ active }: { readonly active: WorkflowNavKey }) {
  return (
    <nav aria-label="Workflow" data-testid="workflow-nav" className="flex flex-col gap-4 p-3">
      <span className="px-1 text-13 font-semibold">Workflow</span>
      <div className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const isActive = item.key === active;
          const Icon = item.icon;
          return (
            <a
              key={item.key}
              href={item.href}
              data-testid={`workflow-nav-${item.key}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-12 transition-colors duration-base",
                isActive
                  ? "bg-card font-medium text-background-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-background-foreground",
              )}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/** Workflow 各页的内容区外框 + 页标题（字号档位同后台页标题）。 */
export function WorkflowPage({ title, children }: { readonly title?: string; readonly children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6" data-testid="workflow-page">
      {title !== undefined && (
        <h1 className="text-20 font-semibold tracking-tight" data-testid="workflow-page-title">{title}</h1>
      )}
      {children}
    </div>
  );
}
