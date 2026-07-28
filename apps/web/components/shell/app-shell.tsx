import * as React from "react";
import { IconRail } from "./icon-rail";
import { TopBar } from "./top-bar";
import { AmbientBar } from "./ambient-bar";
import type { Identity, ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";

/**
 * 三栏骨架 —— 尺寸来自原型实测：
 *   图标栏 76px ｜ 左栏 272px ｜ 中栏 flex ｜ 右栏 300px ｜ 底部环境态条
 * 这是**已确认的产品心智**，业务屏只填充三个栏位，不要另起布局（UC-0.4 R7）。
 */
export function AppShell({
  identity, previewRole, left, right, children,
}: {
  identity: Identity;
  previewRole: ProjectRole | null;
  left?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-testid="app-shell" className="flex h-dvh w-full overflow-hidden bg-background">
      <IconRail avatarInitial={identity.displayName.slice(0, 1)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar identity={identity} previewRole={previewRole} />
        <div className="flex min-h-0 flex-1">
          {left && (
            <aside
              data-testid="shell-left-panel"
              className="hidden w-panel shrink-0 overflow-y-auto border-r border-border bg-panel md:block"
            >
              {left}
            </aside>
          )}
          <main data-testid="shell-main" className="min-w-0 flex-1 overflow-y-auto bg-card">
            {children}
          </main>
          {right && (
            <aside
              data-testid="shell-right-panel"
              className={cn("hidden w-panel-alt shrink-0 overflow-y-auto border-l border-border bg-panel-alt xl:block")}
            >
              {right}
            </aside>
          )}
        </div>
        <AmbientBar />
      </div>
    </div>
  );
}
