/**
 * 后台管理界面统一标准（2026-08-15，人类截图核对，见 issue 正文）——「项目模板」
 * 这一块此前压根没有后台侧栏：`/tpl/list`（生产入口）的 `AppShell` 没传 `left`，
 * 用户从后台任何模块点「项目模板」进来，视觉上突然「掉出了后台」，跟 Agent 目录 /
 * Skill 目录 / 模型 / MCP 那批屏不一致。
 *
 * 同 `skill-single-screen-nav.test.tsx` ①④ 的断言形态（关系断言，不是「文案存在」
 * 这种空转断言）：
 *   ① `TplListPage` 渲染时，`AppShell` 收到的 `left` 是 `AdminNav`（`active="blueprint"`）。
 *   ② 「项目模板」这一项在 `AdminNav` 里高亮为当前所在模块（`aria-current="page"`）。
 *   ③ 源码层面：`app/tpl/list/page.tsx` 的 `left=` 传的是 `<AdminNav active="blueprint" />`。
 *   ④ 设计器真实挂载点 `/tpl/designer` 不受本次改动影响，源码里没有多出 `AdminNav`
 *      （同 Skill 目录：只有 library 屏有 AdminNav，别的工作区屏没有）。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { ROOT } from "../session/import-closure";

let capturedAppShellProps: Record<string, unknown> | null = null;

vi.mock("@/components/shell/app-shell", () => ({
  AppShell: (props: { left?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) => {
    capturedAppShellProps = props;
    return (
      <div data-testid="fake-app-shell">
        {props.left ? <div data-testid="fake-left-slot">{props.left}</div> : null}
        <div data-testid="fake-main-slot">{props.children}</div>
      </div>
    );
  },
}));

vi.mock("@/components/tpl/blueprint-list-screen-live", () => ({
  BlueprintListScreenLive: () => <div data-testid="fake-blueprint-list-screen-live" />,
}));

import TplListPage from "@/app/tpl/list/page";

describe("2026-08-15 /tpl/list：后台 AdminNav 侧栏（此前压根没有）", () => {
  it("① AppShell 收到的 left 是 AdminNav（active=\"blueprint\"），不是 undefined", () => {
    capturedAppShellProps = null;
    render(<TplListPage searchParams={{}} />);
    expect(capturedAppShellProps).not.toBeNull();
    expect(capturedAppShellProps!.left).toBeTruthy();
    expect(screen.getByTestId("fake-left-slot")).toBeTruthy();
    // AdminNav 真实渲染出「治理后台」标题与 admin-nav 容器（未登录态计数皆为「—」，不影响结构断言）。
    expect(screen.getByTestId("admin-nav")).toBeTruthy();
    expect(screen.getByText("治理后台")).toBeTruthy();
    // ② 「项目模板」这一项在 AdminNav 里高亮为当前所在模块。
    expect(screen.getByTestId("admin-nav-blueprint").getAttribute("aria-current")).toBe("page");
    // 生产列表组件照常渲染在主内容区。
    expect(screen.getByTestId("fake-blueprint-list-screen-live")).toBeTruthy();
  });

  it("③ 源码层面：app/tpl/list/page.tsx 的 left= 传的是 <AdminNav active=\"blueprint\" />，不是别的东西", () => {
    const src = readFileSync(resolve(ROOT, "app/tpl/list/page.tsx"), "utf8");
    expect(src).toMatch(/left=\{<AdminNav\s+active="blueprint"\s*\/>\}/);
  });

  it("④ 设计器真实挂载点 /tpl/designer 不受影响——源码里没有多出 AdminNav（全屏工作区，不需要）", () => {
    const src = readFileSync(resolve(ROOT, "app/tpl/designer/page.tsx"), "utf8");
    expect(src).not.toMatch(/AdminNav/);
  });
});
