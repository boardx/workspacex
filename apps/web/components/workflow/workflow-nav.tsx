/** WF08 —— Workflow 路由左栏导航（我的运行 / 待我审批）；CT10 加 Board 运行卡视图。 */
import * as React from "react";
import { ArrowLeft, CheckSquare, KanbanSquare, PlayCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type WorkflowNavKey = "runs" | "approvals" | "board";

const ITEMS: ReadonlyArray<{ key: WorkflowNavKey; href: string; label: string; icon: LucideIcon }> = [
  { key: "runs", href: "/workflows/runs", label: "我的运行", icon: PlayCircle },
  { key: "approvals", href: "/workflows/approvals", label: "待我审批", icon: CheckSquare },
  { key: "board", href: "/workflows/board", label: "运行看板", icon: KanbanSquare },
];

/** 左栏样式同后台左栏（`admin-nav.tsx`）：标题 + 一列带图标的链接，当前页高亮。 */
export function WorkflowNav({ active, projectId }: { readonly active: WorkflowNavKey; readonly projectId?: string | null }) {
  return (
    <nav aria-label="工作流" data-testid="workflow-nav" className="flex flex-col gap-4 p-3">
      {projectId ? <BackToProjectLink projectId={projectId} testId="workflow-nav-back-to-project" /> : null}
      <span className="px-1 text-13 font-semibold">工作流</span>
      <div className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const isActive = item.key === active;
          const Icon = item.icon;
          return (
            <a
              key={item.key}
              href={projectId ? `${item.href}?projectId=${encodeURIComponent(projectId)}` : item.href}
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

/** 从项目进入 Workflow 视图后的退路：回到该项目（项目默认页，组织由服务端按 principal 解析）。 */
export function BackToProjectLink({ projectId, testId }: { readonly projectId: string; readonly testId: string }) {
  return (
    <a
      href={`/projects/${encodeURIComponent(projectId)}`}
      data-testid={testId}
      className="inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-12 text-muted-foreground transition-colors duration-base hover:bg-muted hover:text-background-foreground"
    >
      <ArrowLeft aria-hidden className="h-3.5 w-3.5" />返回项目
    </a>
  );
}

/** Workflow 各页的内容区外框 + 页标题（字号档位同后台页标题）。 */
export function WorkflowPage({ title, subtitle, active, projectId, children }: {
  readonly title?: string; readonly subtitle?: string;
  /** 传了 `active` 才在窄屏渲染顶部导航（左栏在 md 以下不显示）。 */
  readonly active?: WorkflowNavKey; readonly projectId?: string | null;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6" data-testid="workflow-page">
      {active !== undefined && <WorkflowMobileNav active={active} projectId={projectId ?? null} />}
      {title !== undefined && (
        <header className="flex flex-col gap-1">
          <h1 className="text-20 font-semibold tracking-tight" data-testid="workflow-page-title">{title}</h1>
          {subtitle !== undefined && <p className="text-12 text-muted-foreground" data-testid="workflow-page-subtitle">{subtitle}</p>}
        </header>
      )}
      {children}
    </div>
  );
}

/**
 * 窄屏（< md）没有左栏——「返回项目」和三个视图入口会一起消失，用户在手机上被困在看板里。
 * 这里用页内一行顶栏补上：返回项目 + 三个视图切换（宽屏由左栏承担，`md:hidden`）。
 */
export function WorkflowMobileNav({ active, projectId }: { readonly active: WorkflowNavKey; readonly projectId: string | null }) {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return (
    <nav aria-label="工作流" data-testid="workflow-mobile-nav" className="flex flex-col gap-2 md:hidden">
      {projectId ? <BackToProjectLink projectId={projectId} testId="workflow-mobile-back-to-project" /> : null}
      <div className="flex gap-1 overflow-x-auto">
        {ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <a
              key={item.key}
              href={`${item.href}${q}`}
              data-testid={`workflow-mobile-nav-${item.key}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-12 transition-colors duration-base",
                isActive ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-background-foreground",
              )}
            >
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
