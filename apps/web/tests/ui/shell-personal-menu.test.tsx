import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));

import { IconRail } from "@/components/shell/icon-rail";
import { MOCK_ORGS, mockIdentity } from "@/lib/identity";

/**
 * 2026-08-09 信息架构调整（2026-08-11 迭代）：
 *   - 左上角从黑底 `X` logo（点击直跳 `/org-admin`）换成组织菜单触发器
 *     （`org-menu.tsx`，人类直接要求）：点开菜单 = 切换组织 + 组织管理。
 *     `org-admin-entry` 挪到菜单里的「组织管理」项上，仍是**唯一**的组织管理入口——
 *     验证语义不变（从左上角能到 /org-admin），交互路径从「点击直达」变成
 *     「点开菜单 → 点组织管理」，断言读法跟着变。
 *   - 左下角头像从直接 `<Link href="/profile">` 换成下拉个人菜单（`personal-menu.tsx`），
 *     退出从顶栏挪进来，`onLogout` 缺失时（旧版 `identity` 直传原型页）不渲染退出项。
 */
const IDENTITY = mockIdentity("org-yuanyang", null);
const ORGS = MOCK_ORGS.map((o) => ({ id: o.id, label: o.name }));

function renderRail(extra?: { onLogout?: () => void; onSwitch?: (orgId: string) => void }) {
  return render(
    <IconRail
      identity={IDENTITY}
      organizations={ORGS}
      onSwitchOrganization={extra?.onSwitch ?? (() => undefined)}
      avatarInitial="X"
      onLogout={extra?.onLogout}
    />,
  );
}

describe("IconRail：左上角组织菜单 + 个人菜单", () => {
  afterEach(() => cleanup());

  it("左上角触发器点开组织菜单：`org-admin-entry` 指向 `/org-admin`，带 aria-label，且只有一处", () => {
    renderRail();
    const trigger = screen.getByTestId("org-switcher");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    // Radix DropdownMenuTrigger 靠 pointerdown 开菜单（fireEvent.click 在 jsdom 下不触发）。
    fireEvent.pointerDown(trigger, { button: 0 });

    const entry = screen.getByTestId("org-admin-entry");
    expect(entry.getAttribute("href")).toBe("/org-admin");
    expect(entry.getAttribute("aria-label")).toBe("组织管理");
    // 只有这一处——不存在第二个同 testid 的元素
    expect(screen.getAllByTestId("org-admin-entry")).toHaveLength(1);
  });

  it("组织菜单列出全部组织，当前组织 aria-checked=true；点另一个组织触发切换回调", () => {
    const onSwitch = vi.fn();
    renderRail({ onSwitch });
    fireEvent.pointerDown(screen.getByTestId("org-switcher"), { button: 0 });

    const menu = screen.getByTestId("org-menu");
    const options = Array.from(menu.querySelectorAll('[role="menuitemradio"]'));
    expect(options.length).toBe(ORGS.length);
    expect(screen.getByTestId("org-switcher-option-org-yuanyang").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByTestId("org-switcher-option-org-hengtai"));
    expect(onSwitch).toHaveBeenCalledWith("org-hengtai");
    // 点当前组织不触发切换（切到自己没有意义，也不该清空项目上下文）
    fireEvent.pointerDown(screen.getByTestId("org-switcher"), { button: 0 });
    fireEvent.click(screen.getByTestId("org-switcher-option-org-yuanyang"));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("组织菜单 Escape 关闭；无头像时触发器显示组织名首字回落标识", () => {
    renderRail();
    const trigger = screen.getByTestId("org-switcher");
    // mock 身份没有组织头像 ⇒ 首字回落（远洋新能源 → 远），不再是品牌 X
    expect(trigger.textContent).toBe("远");
    fireEvent.pointerDown(trigger, { button: 0 });
    expect(screen.getByTestId("org-menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("org-menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("头像触发器点击后展开个人菜单：个人资料 / 个人 Brain / 主题切换三项恒在", () => {
    renderRail();
    fireEvent.pointerDown(screen.getByTestId("rail-profile-menu"), { button: 0 });

    expect(screen.getByTestId("personal-menu-profile").getAttribute("href")).toBe("/profile");
    expect(screen.getByTestId("personal-menu-brain").getAttribute("href")).toBe("/brain");
    expect(screen.getByTestId("personal-menu-theme")).toBeTruthy();
  });

  it("没有 `onLogout`（旧版 `identity` 直传原型页）时不渲染退出项——不留一个点了没反应的假按钮", () => {
    renderRail();
    fireEvent.pointerDown(screen.getByTestId("rail-profile-menu"), { button: 0 });
    expect(screen.queryByTestId("personal-menu-logout")).toBeNull();
  });

  it("传了 `onLogout` 时渲染退出项，点击后调用它", () => {
    const onLogout = vi.fn();
    renderRail({ onLogout });
    fireEvent.pointerDown(screen.getByTestId("rail-profile-menu"), { button: 0 });

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

  it("不再自带 OrgSwitcher 实现（2026-08-11：切换器并入左上角组织菜单，顶栏组织名是纯展示文本）", () => {
    expect(topBar).not.toMatch(/function OrgSwitcher/);
    expect(topBar).not.toMatch(/data-testid="org-switcher"/);
    // <md 的组织菜单入口是共享组件 OrgMenu（testid 带 -mobile 后缀），不是第二套实现
    expect(topBar).toMatch(/testIdSuffix="-mobile"/);
    expect(topBar).toMatch(/data-testid="topbar-org-name"/);
  });
});

/**
 * 2026-09-02 短视口策略：rail 分三段——顶部组织菜单 / 中段可滚动导航 / 底部反馈 + 个人菜单。
 * 高度不够时只有中段滚动，个人菜单头像**永远**不在滚动容器里，所以永远可见。
 */
describe("IconRail：短视口三段布局", () => {
  afterEach(() => cleanup());

  it("一级导航全部落在可滚动中段（overflow-y-auto + min-h-0 + flex-1）", () => {
    renderRail();
    const scroll = screen.getByTestId("rail-scroll");
    for (const cls of ["overflow-y-auto", "min-h-0", "flex-1"]) expect(scroll.className).toContain(cls);
    const links = Array.from(scroll.querySelectorAll('a[data-testid^="rail-"]'));
    expect(links.length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(/^rail-(chat|projects|research|brain|tasks)$/).every((el) => scroll.contains(el))).toBe(true);
  });

  it("个人菜单头像在底部固定段，不在滚动容器里（反馈按钮需 FeedbackProvider，此处不挂，不断言）", () => {
    renderRail();
    const scroll = screen.getByTestId("rail-scroll");
    const bottom = screen.getByTestId("rail-bottom");
    const profile = screen.getByTestId("rail-profile-menu");
    expect(bottom.contains(profile)).toBe(true);
    expect(scroll.contains(profile)).toBe(false);
    expect(bottom.className).toContain("shrink-0");
    expect(screen.getByTestId("rail-top").className).toContain("shrink-0");
  });

  it("源码：nav 自身 h-full min-h-0 overflow-hidden，紧凑模式用 max-height 媒体查询隐藏文字标签", () => {
    const src = readFileSync(path.join(process.cwd(), "components/shell/icon-rail.tsx"), "utf8");
    expect(src).toMatch(/h-full min-h-0 .*overflow-hidden/);
    expect(src).toContain("[@media(max-height:640px)]:hidden");
  });
});
