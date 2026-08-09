import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * 2026-08-09 信息架构调整 —— `/profile` 顶部的移动端专用行（`profile-mobile-actions`）。
 *
 * 桌面档的主题切换 + 退出现在只挂在左下角个人菜单（`personal-menu.tsx`），而 `<md` 时
 * `IconRail` 整体隐藏（`hidden md:flex`），那份下拉不可达——所以这两个动作在移动端需要
 * 一条独立入口，就是这里断言的这一行，且只在 `md:hidden` 生效，不与桌面档重复。
 *
 * 本文件只测**入口结构**（存在、可点、调用了正确的回调），不重跑头像/密码/活动记录
 * 三块已有的业务逻辑——那些不属于本次改动范围。
 */

const { logout, listOwnActivity } = vi.hoisted(() => ({
  logout: vi.fn(),
  listOwnActivity: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
}));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: "org-current" },
    identity: { displayName: "验证用户", avatarUrl: null },
    updateDisplayName: vi.fn(),
    updateAvatarUrl: vi.fn(),
    logout,
  }),
}));

vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/live-identity", () => ({
  fetchAvatarObjectUrl: vi.fn(),
  listOwnActivity,
  updateOwnProfile: vi.fn(),
  uploadOwnAvatar: vi.fn(),
  changeOwnPassword: vi.fn(),
}));

import { ProfileScreen } from "@/components/profile/profile-screen";

afterEach(() => cleanup());

describe("`/profile` 移动端顶部动作行", () => {
  it("渲染出主题切换与退出两个入口，且都带 `md:hidden`（避免与桌面档下拉重复）", () => {
    render(<ProfileScreen />);
    const row = screen.getByTestId("profile-mobile-actions");
    expect(row.className).toMatch(/\bmd:hidden\b/);
    expect(screen.getByTestId("profile-mobile-theme-toggle")).toBeTruthy();
    expect(screen.getByTestId("profile-mobile-logout")).toBeTruthy();
  });

  it("点退出会调用 `session.logout`", () => {
    render(<ProfileScreen />);
    fireEvent.click(screen.getByTestId("profile-mobile-logout"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("点主题切换会给 `<html>` 加上 `.dark`，再点一次会去掉", () => {
    document.documentElement.classList.remove("dark");
    render(<ProfileScreen />);
    const toggle = screen.getByTestId("profile-mobile-theme-toggle");

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    fireEvent.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
