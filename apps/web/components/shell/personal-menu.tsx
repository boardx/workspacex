"use client";
import * as React from "react";
import Link from "next/link";
import { BrainCircuit, LogOut, User } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

/**
 * 左下角头像 → 个人菜单（下拉，2026-08-09 信息架构调整）。
 *
 * F09 起改走 `components/ui/menu.tsx`（Radix DropdownMenu 的别名，见 F01）——此前是手写
 * `open` state + `document.mousedown`/`keydown` 监听 + `role="menu"` 绝对定位 div（F09
 * 盘点发现的 5 处重复实现之一）。焦点陷阱 / Esc 关闭 / 外点关闭 / ↑↓ 导航现在由 Radix
 * 原生提供，行为等价，DOM/testid 不变。
 *
 * 菜单项：
 *   - 个人资料 → `/profile`（不变）
 *   - 个人 Brain → `/brain`——**这是「个人记忆管理」与「个人大脑」合并后的唯一入口**。
 *     仓库里没有独立的「个人记忆」契约/页面，硬造一个会是没有后端支撑的假入口。
 *   - 主题切换 → 见 `theme-toggle.tsx`。选中它不关闭菜单（`onSelect` preventDefault），
 *     与迁移前行为一致（原实现里 ThemeToggle 的 onClick 从不调用 `setOpen(false)`）。
 *   - 退出 → 从顶栏挪过来（原来顶栏单独有一个 `session-logout` 按钮，同一功能不许
 *     两个入口，顶栏那份已删）。`onLogout` 在没有真实 session 的旧版原型页
 *     （`AppShell` 的 `identity` 直传分支）里不存在，此时不渲染这一项。
 */
export function PersonalMenu({
  avatarInitial, onLogout,
}: { avatarInitial: string; onLogout?: () => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-testid="rail-profile-menu"
          aria-label="个人菜单"
          className="mt-auto flex h-7 w-7 items-center justify-center rounded-full bg-accent text-11 font-medium text-accent-foreground transition-all duration-200 hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span data-testid="rail-avatar" aria-hidden>{avatarInitial}</span>
        </button>
      </MenuTrigger>
      <MenuContent
        side="right"
        align="end"
        sideOffset={8}
        aria-label="个人菜单"
        data-testid="rail-personal-menu"
        className="w-48"
      >
        <MenuItem asChild data-testid="personal-menu-profile-item">
          <Link href="/profile" data-testid="personal-menu-profile" className="gap-2">
            <User aria-hidden className="h-3.5 w-3.5" />
            个人资料
          </Link>
        </MenuItem>
        <MenuItem asChild data-testid="personal-menu-brain-item">
          <Link href="/brain" data-testid="personal-menu-brain" className="gap-2">
            <BrainCircuit aria-hidden className="h-3.5 w-3.5" />
            个人 Brain
          </Link>
        </MenuItem>
        <MenuSeparator />
        <MenuItem asChild onSelect={(e) => e.preventDefault()}>
          <ThemeToggle testId="personal-menu-theme" className="rounded-md" />
        </MenuItem>
        {onLogout && (
          <>
            <MenuSeparator />
            <MenuItem
              data-testid="personal-menu-logout"
              onSelect={() => onLogout()}
              className={cn("text-destructive data-[highlighted]:text-destructive")}
            >
              <LogOut aria-hidden className="h-3.5 w-3.5" />
              退出
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
