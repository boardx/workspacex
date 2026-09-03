/**
 * org-management-integration（issue #2581，PR #2583 review 要求补的反证测试）——
 * 「组织管理」入口并入组织后台左栏这件事的**本体**是 `org-admin-screen.tsx` 里
 * `<AppShell left={<AdminNav .../>}>` 这一行接线，而不是 `lib/mock/admin.ts` 那份
 * 导航数据本身（数据结构对不对，`admin-scope-split.test.tsx` 等既有测试早已覆盖）。
 * 真正渲染出的 DOM 才是用户会看到的东西。
 *
 * issue #2615（拆平「组织管理」为与总览平级的三项，去掉团队概念）后，原来单一的
 * `OrgAdminScreen`（默认打开"团队"标签页）已经拆成三个独立导出的屏组件。本文件改为
 * 渲染 `OrgMembersScreen`（"成员"，`/org-admin/members`），断言：
 *   ① 左栏（`shell-left-panel`）与 `admin-nav` 都存在；
 *   ② `data-admin-scope="org"`——平台面的项（如 `admin-nav-agent`）一个都不渲染；
 *   ③ `admin-nav-org-members` 指向 `/org-admin/members`、`aria-current="page"`（当前高亮项）；
 *   ④ 反证：把 `org-admin-screen.tsx` 的 `left={<AdminNav .../>}` 拿掉，①②③三条
 *      断言全部会失败（`shell-left-panel`/`admin-nav` 根本不会挂载）——本文件不需要
 *      另外写一条「回退后失败」的用例，这三条本身就是那条回归线。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClientTestWrapper } from "../render-with-query";
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
  usePathname: () => "/org-admin/members",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/session-api", () => ({ resolveIdentity, switchCurrentOrganization: vi.fn() }));

// 成员屏用真实接口拉数据——换成 mock，避免测试环境里真的发网络请求。
vi.mock("@/lib/live-org-admin", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/live-org-admin")>();
  return { ...mod, listOrgMembers: vi.fn(async () => ({ members: [] })) };
});

// 左栏「AI 能力」组两项口径明确的计数（agent/skill）走真实 `GET /capabilities`——
// 同样只需要挡住网络请求，返回值本身与本文件的断言无关。
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities: vi.fn(async () => []) }));

import { OrgMembersScreen } from "@/components/org-admin/org-admin-screen";

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

describe("/org-admin/members 接上组织后台左栏（AdminNav）", () => {
  it("左栏、组织 scope、「成员」高亮项都真实渲染", async () => {
    render(
      <SessionProvider>
        <OrgMembersScreen />
      </SessionProvider>,
      { wrapper: QueryClientTestWrapper },
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

    // ③ 「成员」项本身：指向 /org-admin/members、当前高亮。
    const orgMembersItem = screen.getByTestId(ADMIN_NAV_TESTID["org-members"]);
    expect(orgMembersItem.getAttribute("href")).toBe("/org-admin/members");
    expect(orgMembersItem.getAttribute("aria-current")).toBe("page");
  });
});
