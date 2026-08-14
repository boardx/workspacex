/**
 * 2026-08-13 —— 两轮裁决，装的是两个不同的组件（细节见 `skill-app.tsx` 「左栏」长注）。
 *
 * 第一轮（#1102/#1104）人类原话：「后台的 skill 目前有两个菜单，请只保留一个，
 * 并且保留真实数据的这个。不需要有中间的这个 column，直接显示 skills 的列表，
 * 用卡片的方式来展示」——删掉的是 `SkillApp` 自己拼的 `LeftNav`（library/catalog
 * 两个按钮的二级导航），当时 `AdminNav` 从未出现在 `/skill`，不在这句话的指代范围内。
 *
 * 第二轮（本次改动）人类拿两张后台原型截图核对，要求 `/skill` 加回**后台**
 * `AdminNav` 侧栏（数据总览/Agent/Skill/模型/MCP/画布模板/项目蓝本/成员配额/反馈），
 * 让 `/skill` 在导航上仍处在「后台」里，与 `/admin/[module]` 那批屏一致。
 *
 * 这里断言的是**关系**，不是「文案存在」这种空转断言：
 *   ① `SkillApp` 渲染时，`AppShell` 收到的 `left` 现在是 `AdminNav`（`active="skill"`）
 *      ——不是 `undefined`，也不是旧的 `LeftNav`。
 *   ② 旧的 `LeftNav`（`skill-nav-library` / `skill-nav-catalog` 按钮、
 *      「Skill 能力包」标题）不再存在——防止第一轮的删除被悄悄撤销。
 *   ③ `catalog` 屏组件仍然被渲染（`?screen=catalog` 直达仍可用）——
 *      这条防的是「删屏」而不是「删导航项」这个越界改动。
 *   ④ 源码层面：`skill-app.tsx` 的 `left=` 传的是 `<AdminNav`，不是别的东西。
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

vi.mock("@/components/skill/skill-catalog-live", () => ({
  SkillCatalogLive: () => <div data-testid="fake-skill-catalog-live" />,
}));
vi.mock("@/components/admin/capability-catalog-screen", () => ({
  CapabilityCatalogScreen: () => <div data-testid="fake-capability-catalog-screen" />,
}));
vi.mock("@/components/admin/skill-content-editor", () => ({
  SkillContentEditorSection: () => null,
}));
vi.mock("@/components/skill/skill-library", () => ({ SkillLibrary: () => null }));
vi.mock("@/components/skill/skill-tryrun", () => ({ SkillTryRun: () => null }));
vi.mock("@/components/skill/skill-binding", () => ({ SkillBinding: () => null }));
vi.mock("@/components/skill/skill-temp-mount", () => ({ SkillTempMount: () => null }));
vi.mock("@/components/skill/skill-versioning", () => ({ SkillVersioning: () => null }));
vi.mock("@/components/skill/skill-promotion", () => ({ SkillPromotion: () => null }));
vi.mock("@/components/skill/skill-feedback", () => ({ SkillFeedback: () => null }));

import { SkillApp } from "@/components/skill/skill-app";

const BASE_PROPS = {
  previewRole: null,
  uiState: "default" as const,
  view: "maintainer" as const,
  qs: {},
};

describe("2026-08-13 /skill 单屏卡片网格 + 后台 AdminNav 侧栏", () => {
  it("① AppShell 收到的 left 是 AdminNav（active=\"skill\"），不是 undefined、也不是旧 LeftNav", () => {
    capturedAppShellProps = null;
    render(<SkillApp {...BASE_PROPS} screen="library" />);
    expect(capturedAppShellProps).not.toBeNull();
    expect(capturedAppShellProps!.left).toBeTruthy();
    expect(screen.getByTestId("fake-left-slot")).toBeTruthy();
    // AdminNav 真实渲染出「治理后台」标题与 admin-nav 容器（未登录态计数皆为「—」，不影响结构断言）。
    expect(screen.getByTestId("admin-nav")).toBeTruthy();
    expect(screen.getByText("治理后台")).toBeTruthy();
    // 「Skill 目录」这一项在 AdminNav 里高亮为当前所在模块（aria-current="page"）。
    expect(screen.getByTestId("admin-nav-skill").getAttribute("aria-current")).toBe("page");
    // library 屏（真实数据）照常渲染在主内容区。
    expect(screen.getByTestId("fake-skill-catalog-live")).toBeTruthy();
  });

  it("② 旧的 LeftNav（library/catalog 二级导航按钮）不再存在——第一轮的删除没被悄悄撤销", () => {
    capturedAppShellProps = null;
    render(<SkillApp {...BASE_PROPS} screen="library" />);
    expect(screen.queryByTestId("skill-left-nav")).toBeNull();
    expect(screen.queryByTestId("skill-nav-library")).toBeNull();
    expect(screen.queryByTestId("skill-nav-catalog")).toBeNull();
    expect(screen.queryByText("Skill 能力包")).toBeNull();
  });

  it("③ ?screen=catalog 仍然可达：catalog 组件本身没被删，只是不再从 skill 自己的二级导航可点", () => {
    capturedAppShellProps = null;
    render(<SkillApp {...BASE_PROPS} screen="catalog" />);
    expect(capturedAppShellProps!.left).toBeTruthy();
    expect(screen.getByTestId("fake-capability-catalog-screen")).toBeTruthy();
  });

  it("④ 源码层面：skill-app.tsx 的 left= 传的是 <AdminNav，不是别的东西", () => {
    const src = readFileSync(resolve(ROOT, "components/skill/skill-app.tsx"), "utf8");
    expect(src).toMatch(/left=\{<AdminNav\s+active="skill"\s*\/>\}/);
    // 反空转：不是整个 AppShell 调用都被删了，right 插槽还在按屏条件传（见 G7）。
    expect(src).toMatch(/<AppShell[\s\S]*?right=\{isProductionScreen \? undefined : <RightRail/);
    // catalog 屏渲染分支仍然保留在源码里（防止「删导航项」滑成「删屏」）。
    expect(src).toMatch(/screen === "catalog"/);
    // 旧的 LeftNav 组件定义与 LEFT_NAV_SCREENS 常量声明不再存在于源码里
    // （正则只锁"声明"，允许说明性注释里提到这两个历史名字用于交代沿革）。
    expect(src).not.toMatch(/const LEFT_NAV_SCREENS/);
    expect(src).not.toMatch(/function LeftNav\(/);
  });
});

describe("G7（2026-08-14，人类原话：「不需要右边的 column」）—— library/catalog 不再挂 RightRail", () => {
  it("library 屏：AppShell 收到的 right 是 undefined（RightRail 完全不渲染）", () => {
    capturedAppShellProps = null;
    render(<SkillApp {...BASE_PROPS} screen="library" />);
    expect(capturedAppShellProps).not.toBeNull();
    expect(capturedAppShellProps!.right).toBeUndefined();
    expect(screen.queryByTestId("skill-right-rail")).toBeNull();
  });

  it("catalog 屏：同 library，AppShell 收到的 right 也是 undefined", () => {
    capturedAppShellProps = null;
    render(<SkillApp {...BASE_PROPS} screen="catalog" />);
    expect(capturedAppShellProps!.right).toBeUndefined();
    expect(screen.queryByTestId("skill-right-rail")).toBeNull();
  });

  it("反证：签核用的原型屏（library-prototype）仍然保留 RightRail——不是把它整个删掉", () => {
    // ⚠ 这里的 fake `AppShell`（见文件头 mock）只转发渲染 `left`/`children`，不渲染
    //   `right`——所以只能断言**捕获到的 prop**本身，不能像①那样再断言 DOM 里有
    //   `skill-right-rail`。prop truthy 已经足够证明「library/catalog 传 undefined，
    //   其余屏仍然传一个真实 element」这条区分没有被误伤成「全部屏都不传了」。
    capturedAppShellProps = null;
    render(<SkillApp {...BASE_PROPS} screen="library-prototype" />);
    expect(capturedAppShellProps!.right).toBeTruthy();
  });
});
