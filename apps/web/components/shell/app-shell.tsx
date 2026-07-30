import * as React from "react";
import { IconRail } from "./icon-rail";
import { TopBar } from "./top-bar";
import { AmbientBar } from "./ambient-bar";
import { MobileTabs } from "./mobile-tabs";
import type { Identity, ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";

/**
 * 三栏骨架 —— 尺寸来自原型实测：
 *   图标栏 76px ｜ 左栏 272px ｜ 中栏 flex ｜ 右栏 300px ｜ 底部环境态条
 * 这是**已确认的产品心智**，业务屏只填充三个栏位，不要另起布局（UC-0.4 R7）。
 *
 * 响应式（实测原型「同一信息架构，三栏折叠为三层」）：
 *   ≥xl  四栏全开
 *   ≥md  收起右栏（上下文包与证据栏），中栏拿到宽度
 *   <md  收起图标栏与左右栏，改用底部一级 tab；顶部条与中栏保留
 * 三档（375 / 768 / 1280）都不得出现横向溢出（uiux-standards U8 / UC-0.4 R12 V9）。
 *
 * ⚠ `hideRoleSwitcher`（2026-07-30）：当**本页内容区自带角色/视角切换器**时置 true，
 *   顶栏就不再渲染它自己的预览切换器——避免「同一页两套角色切换系统」。
 *   角色切换的唯一来源 = 各域内容区自带的切换器；顶栏只负责组织切换 + 上下文标签。
 */
export function AppShell({
  identity, previewRole, left, right, children, hideRoleSwitcher,
}: {
  identity: Identity;
  previewRole: ProjectRole | null;
  left?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  /** 本页自带角色/视角切换器时置 true，顶栏让位不再出第二套 */
  hideRoleSwitcher?: boolean;
}) {
  return (
    <div data-testid="app-shell" className="flex h-dvh w-full overflow-hidden bg-background">
      <div className="hidden md:flex">
        <IconRail avatarInitial={identity.displayName.slice(0, 1)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar identity={identity} previewRole={previewRole} hideRoleSwitcher={hideRoleSwitcher} />
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
        <div className="hidden md:block">
          <AmbientBar />
        </div>
        <MobileTabs />
      </div>
    </div>
  );
}
