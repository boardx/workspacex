import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));

import { IconRail } from "@/components/shell/icon-rail";

/**
 * 2026-08-09 信息架构调整：
 *   - 左上角 `X` logo 是**唯一**的组织管理入口（`org-admin-entry`），顶栏那份文字/图标
 *     链接已删——同一功能不许两个入口，这里钉住「只有一处」。
 *   - 左下角头像从直接 `<Link href="/profile">` 换成下拉个人菜单（`personal-menu.tsx`），
 *     退出从顶栏挪进来，`onLogout` 缺失时（旧版 `identity` 直传原型页）不渲染退出项。
 */
describe("IconRail：组织管理入口 + 个人菜单", () => {
  afterEach(() => cleanup());

  it("logo 是 `org-admin-entry`，指向 `/org-admin`，带 aria-label", () => {
    render(<IconRail avatarInitial="X" />);
    const logo = screen.getByTestId("org-admin-entry");
    expect(logo.getAttribute("href")).toBe("/org-admin");
    expect(logo.getAttribute("aria-label")).toBe("组织管理");
    // 只有这一处——不存在第二个同 testid 的元素
    expect(screen.getAllByTestId("org-admin-entry")).toHaveLength(1);
  });

  it("头像触发器点击后展开个人菜单：个人资料 / 个人 Brain / 主题切换三项恒在", () => {
    render(<IconRail avatarInitial="X" />);
    fireEvent.click(screen.getByTestId("rail-profile-menu"));

    expect(screen.getByTestId("personal-menu-profile").getAttribute("href")).toBe("/profile");
    expect(screen.getByTestId("personal-menu-brain").getAttribute("href")).toBe("/brain");
    expect(screen.getByTestId("personal-menu-theme")).toBeTruthy();
  });

  it("没有 `onLogout`（旧版 `identity` 直传原型页）时不渲染退出项——不留一个点了没反应的假按钮", () => {
    render(<IconRail avatarInitial="X" />);
    fireEvent.click(screen.getByTestId("rail-profile-menu"));
    expect(screen.queryByTestId("personal-menu-logout")).toBeNull();
  });

  it("传了 `onLogout` 时渲染退出项，点击后调用它", () => {
    const onLogout = vi.fn();
    render(<IconRail avatarInitial="X" onLogout={onLogout} />);
    fireEvent.click(screen.getByTestId("rail-profile-menu"));

    const logoutItem = screen.getByTestId("personal-menu-logout");
    fireEvent.click(logoutItem);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

/** 静态断言：顶栏源码不再含被挪走的两个入口——不是隐藏，是压根没有第二份。 */
describe("顶栏源码：组织管理入口 / 退出按钮已挪走，不留第二份", () => {
  const topBar = readFileSync(path.join(process.cwd(), "components/shell/top-bar.tsx"), "utf8");

  it("不含 `data-testid=\"org-admin-entry\"`（组织管理入口只在 IconRail 的 logo 上；注释里提它没关系，JSX 属性不许有）", () => {
    expect(topBar).not.toMatch(/data-testid="org-admin-entry"/);
  });

  it("不含 `data-testid=\"session-logout\"`（退出已并入个人菜单的 `personal-menu-logout`）", () => {
    expect(topBar).not.toMatch(/data-testid="session-logout"/);
  });
});
