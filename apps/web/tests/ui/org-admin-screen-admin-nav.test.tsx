/**
 * org-management-integration（issue #2581，PR #2583 review 要求补的反证测试）——
 * 「组织管理」入口并入组织后台左栏这件事的**本体**是 `org-admin-screen.tsx` 里
 * `<AppShell left={<AdminNav active="org-profile" />}>` 这一行接线，而不是
 * `lib/mock/admin.ts` 那份导航数据本身（数据结构对不对，`admin-scope-split.test.tsx`
 * 等既有测试早已覆盖）。真正渲染出的 DOM 才是用户会看到的东西：点「组织管理」进
 * `/org-admin` 后，是不是真的出现了「组织后台」的左栏、且「组织管理」这一项高亮、
 * 平台面的项一个都不出现。
 *
 * 真渲染 `OrgAdminScreen`（走真的 `SessionProvider` + 真的 `AppShell`，只把网络边界
 * 换成 mock，同 `org-switcher-real-names.test.tsx` 的既有做法），断言：
 *   ① 左栏（`shell-left-panel`）与 `admin-nav` 都存在；
 *   ② `data-admin-scope="org"`——平台面的项（如 `admin-nav-agent`）一个都不渲染；
 *   ③ `admin-nav-org-profile` 指向 `/org-admin`、`aria-current="page"`（当前高亮项）；
 *   ④ 反证：把 `org-admin-screen.tsx` 的 `left={<AdminNav .../>}` 拿掉，①②③三条
 *      断言全部会失败（`shell-left-panel`/`admin-nav` 根本不会挂载）——本文件不需要
 *      另外写一条「回退后失败」的用例，这三条本身就是那条回归线。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import {
  SESSION_COMMIT_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  SessionProvider,
} from "@/components/session/session-provider";
import { ADMIN_NAV_TESTID } from "@/components/admin/asset-kind-nav";

const { replace, resolveIdentity } = vi.hoisted(() => ({
  replace: vi.fn(),
  resolveIdentity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/org-admin",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/session-api", () => ({ resolveIdentity, switchCurrentOrganization: vi.fn() }));

// 团队标签页（默认打开的那个）真实接口换成 mock，避免测试环境里真的发网络请求；
// 成员/邀请/组织资料三个标签页 Radix Tabs 默认不挂载非激活面板，不需要一并 mock。
vi.mock("@/lib/live-org-admin", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/live-org-admin")>();
  return { ...mod, listTeams: vi.fn(async () => ({ teams: [] })) };
});

// 左栏「AI 能力」组两项口径明确的计数（agent/skill）走真实 `GET /capabilities`——
// 同样只需要挡住网络请求，返回值本身与本文件的断言无关。
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities: vi.fn(async () => []) }));

import { OrgAdminScreen } from "@/components/org-admin/org-admin-screen";

const ORG = { id: "org-2581", name: "远洋咨询" } as const;

function seedSession() {
  const revision = "rev-2581";
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "bearer-2581");
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    version: 2,
    revision,
    userId: "user-2581",
    orgs: [ORG.id],
    currentOrgId: ORG.id,
    expiresAt: "2099-01-01T00:00:00.000Z",
  }));
  window.localStorage.setItem(SESSION_COMMIT_STORAGE_KEY, revision);
}

beforeEach(() => {
  replace.mockReset();
  resolveIdentity.mockReset();
  window.localStorage.clear();
  seedSession();
  resolveIdentity.mockResolvedValue({
    org: { id: ORG.id, name: ORG.name, kind: "organization", team: null },
    orgRole: "admin",
    teamId: null,
    projectRole: null,
    groupId: null,
    displayName: "user-2581",
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/org-admin 接上组织后台左栏（AdminNav）", () => {
  it("左栏、组织 scope、「组织管理」高亮项都真实渲染", async () => {
    render(
      <SessionProvider>
        <OrgAdminScreen />
      </SessionProvider>,
    );

    // 唯一一次异步等待：挂载完成。
    await screen.findByTestId("org-admin-screen");

    // ① 左栏存在——`AppShell` 只有拿到非空 `left` 才会画 `shell-left-panel`。
    expect(screen.getByTestId("shell-left-panel")).toBeInTheDocument();
    const nav = screen.getByTestId("admin-nav");
    expect(nav).toBeInTheDocument();

    // ② 这是组织后台的面，不是平台后台——平台组的项（如 Agent 目录）一个都不出现。
    expect(nav.getAttribute("data-admin-scope")).toBe("org");
    expect(screen.queryByTestId(ADMIN_NAV_TESTID.agent)).toBeNull();
    expect(screen.queryByTestId(ADMIN_NAV_TESTID.platform)).toBeNull();

    // ③ 「组织管理」项本身：指向 /org-admin、当前高亮。
    const orgProfileItem = screen.getByTestId(ADMIN_NAV_TESTID["org-profile"]);
    expect(orgProfileItem.getAttribute("href")).toBe("/org-admin");
    expect(orgProfileItem.getAttribute("aria-current")).toBe("page");
  });
});
