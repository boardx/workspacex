/**
 * #1971 —— 人类截图实测反馈（2026-08-24）：`/admin/*` 后台管理界面里，顶栏
 * 「不在具体项目里 · 引导师/组长/组员等项目内角色暂不适用」这行提示是噪音——
 * 后台本就不挂在任何具体项目下，这是它的常态而不是缺失，每屏重复提醒一遍没有
 * 信息量。此前只对 `/chat` 做了同类排除（2026-08-23），本次把 `/admin` 与
 * `/admin/**`（含 `/admin/skill/[id]` 这类多段路由）一并排除。
 *
 * 反证：非 admin、非 /chat 的普通非项目路由（如 `/settings`）这句提示仍要保留——
 * 那些地方"为什么没有项目角色"确实需要说明，不能把排除范围改宽到覆盖所有路由。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/settings" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { TopBar } from "@/components/shell/top-bar";
import { mockIdentity } from "@/lib/identity";

const IDENTITY = mockIdentity("org-yuanyang", null);
const ORGS = [{ id: "org-yuanyang", label: "远洋新能源" }];

function renderTopBar(pathname: string) {
  nav.pathname = pathname;
  return render(
    <TopBar
      identity={IDENTITY}
      previewRole={null}
      organizations={ORGS}
      onSwitchOrganization={() => undefined}
    />,
  );
}

describe("F1971 · 后台管理界面顶栏不再出「不在具体项目里」提示", () => {
  afterEach(() => cleanup());

  it("`/admin` 总览页：提示不渲染", () => {
    renderTopBar("/admin");
    expect(screen.queryByTestId("topbar-no-project-hint")).toBeNull();
  });

  it("`/admin/skill/sk_1` 全屏编辑页（多段路由）：提示不渲染", () => {
    renderTopBar("/admin/skill/sk_1");
    expect(screen.queryByTestId("topbar-no-project-hint")).toBeNull();
  });

  it("`/admin/agent/agent_1`：提示不渲染", () => {
    renderTopBar("/admin/agent/agent_1");
    expect(screen.queryByTestId("topbar-no-project-hint")).toBeNull();
  });

  it("反证：`/settings`（普通非项目、非 admin 路由）提示仍然保留", () => {
    renderTopBar("/settings");
    expect(screen.getByTestId("topbar-no-project-hint")).toBeInTheDocument();
  });

  it("反证：路径前缀恰好以 `/admin` 起始但不是子路由（如 `/adminfoo`）不应被误伤排除", () => {
    renderTopBar("/adminfoo");
    expect(screen.getByTestId("topbar-no-project-hint")).toBeInTheDocument();
  });
});
