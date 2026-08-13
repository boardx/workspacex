/**
 * 2026-08-13 —— 人类直接裁决：`/skill` 只剩一个屏，砍掉整个左栏导航列。
 *
 * 人类原话：「后台的 skill 目前有两个菜单，请只保留一个，并且保留真实数据的这个。
 * 不需要有中间的这个 column，直接显示 skills 的列表，用卡片的方式来展示」。
 *
 * 这里断言的是**关系**，不是「文案存在」这种空转断言：
 *   ① `SkillApp` 渲染时，`AppShell` 收到的 `left` 是 `undefined`（不是「传了个空组件」）——
 *      这与 `AppShell` 自身在 `left` 为空时自动收起左栏（见 `app-shell.tsx` 的 `left &&`）
 *      配合，才是「整列消失」而不是「列还在、内容空了」。
 *   ② `catalog` 屏组件仍然被渲染（`?screen=catalog` 直达仍可用），只是不再从左栏可点——
 *      这条防的是「删屏」而不是「删导航项」这个越界改动。
 *   ③ 源码层面：`skill-app.tsx` 不再包含 `left={` 这个 prop 传递（防止有人绕过组件树
 *      悄悄传回一个左栏）。
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

describe("2026-08-13 /skill 单屏化：砍掉左栏导航列", () => {
  it("① AppShell 收到的 left 是 undefined —— 不是传了个空组件，是压根没传这个插槽", () => {
    capturedAppShellProps = null;
    render(<SkillApp {...BASE_PROPS} screen="library" />);
    expect(capturedAppShellProps).not.toBeNull();
    expect(capturedAppShellProps!.left).toBeUndefined();
    expect(screen.queryByTestId("fake-left-slot")).toBeNull();
    // library 屏（真实数据）照常渲染在主内容区。
    expect(screen.getByTestId("fake-skill-catalog-live")).toBeTruthy();
  });

  it("② ?screen=catalog 仍然可达：catalog 组件本身没被删，只是不再从左栏可点", () => {
    capturedAppShellProps = null;
    render(<SkillApp {...BASE_PROPS} screen="catalog" />);
    expect(capturedAppShellProps!.left).toBeUndefined();
    expect(screen.getByTestId("fake-capability-catalog-screen")).toBeTruthy();
  });

  it("③ 源码层面：skill-app.tsx 不再有 left={ 这个 prop 传递", () => {
    const src = readFileSync(resolve(ROOT, "components/skill/skill-app.tsx"), "utf8");
    expect(src).not.toMatch(/left=\{/);
    // 反空转：不是整个 AppShell 调用都被删了，right 插槽还在正常传。
    expect(src).toMatch(/<AppShell[\s\S]*?right=\{<RightRail/);
    // catalog 屏渲染分支仍然保留在源码里（防止「删导航项」滑成「删屏」）。
    expect(src).toMatch(/screen === "catalog"/);
  });
});
