/**
 * member-role-management delta（平台级）—— `/platform-admin/members` 平台成员屏，前端接线单测（mocked fetch）。
 *
 * 反证重点：
 *  · 名册来自真实 `GET /platform/members`：账号 × 组织成员身份逐条渲染，无组织账号也在；
 *  · 超管标记按响应的 `platformSuperuser` 渲染，不是按组织角色推断；
 *  · 403 `NOT_PLATFORM_SUPERUSER` 渲染成「仅平台运维可见」说明，**不是**失败态/重试按钮；
 *  · 其它失败（503）才是失败态，带重试；
 *  · 选一个角色真的发 `PATCH /platform/members/:userId/organizations/:orgId/role`，
 *    成功后那一条成员身份就地更新并出现前值 → 新值；`LAST_ADMIN` 时说清下一步。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PlatformMembersScreen } from "@/components/admin/platform-members-screen";

const sessionMock = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => (sessionMock.userId ? { session: { userId: sessionMock.userId } } : null),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ROSTER = {
  members: [
    {
      userId: "u-ops", displayName: "运维", email: "ops@x.test", emailVerified: true, createdAt: "2026-01-01T00:00:00Z",
      platformSuperuser: true, platformAdmin: false,
      memberships: [],
    },
    {
      userId: "u-linke", displayName: "林可", email: "l@x.test", emailVerified: true, createdAt: "2026-02-01T00:00:00Z",
      platformSuperuser: false, platformAdmin: false,
      memberships: [
        { orgId: "org-a", orgName: "远洋咨询", orgRole: "consultant", teamId: null, joinedAt: "2026-02-02T00:00:00Z" },
        { orgId: "org-b", orgName: "北极星", orgRole: "admin", teamId: null, joinedAt: "2026-03-02T00:00:00Z" },
      ],
    },
  ],
};

const fetchMock = vi.fn();

function routed(overrides: {
  list?: Response;
  setRole?: (body: Record<string, unknown>) => Response;
  grantAdmin?: (body: Record<string, unknown>) => Response;
  revokeAdmin?: (body: Record<string, unknown>) => Response;
} = {}) {
  return (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "PATCH" && /\/platform\/members\/[^/]+\/organizations\/[^/]+\/role$/.test(u)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Promise.resolve(
        overrides.setRole?.(body)
          ?? jsonResponse({ userId: body.userId, orgId: body.orgId, orgRole: body.orgRole, previousOrgRole: "consultant" }),
      );
    }
    if (method === "GET" && u.endsWith("/platform/members")) return Promise.resolve(overrides.list ?? jsonResponse(ROSTER));
    if (method === "POST" && /\/platform\/members\/[^/]+\/platform-admin$/.test(u)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Promise.resolve(overrides.grantAdmin?.(body) ?? jsonResponse({ userId: body.userId, platformAdmin: true }));
    }
    if (method === "DELETE" && /\/platform\/members\/[^/]+\/platform-admin$/.test(u)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Promise.resolve(overrides.revokeAdmin?.(body) ?? jsonResponse({ userId: body.userId, platformAdmin: false }));
    }
    return Promise.resolve(jsonResponse({}, 404));
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  sessionMock.userId = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlatformMembersScreen", () => {
  it("名册逐条渲染：账号 × 组织成员身份、无组织账号、超管标记来自响应", async () => {
    fetchMock.mockImplementation(routed());
    render(<PlatformMembersScreen state="default" />);

    await screen.findByTestId("admin-platform-members-list");
    expect(screen.getByTestId("admin-platform-members-count")).toHaveTextContent("全平台 2 个账号");

    expect(screen.getByTestId("admin-platform-member-u-ops-superuser")).toBeTruthy();
    expect(screen.getByTestId("admin-platform-member-u-ops-no-org")).toHaveTextContent("尚未加入任何正式组织");
    // 组织 admin 不等于平台超管——林可在北极星是 admin，但没有超管标记。
    expect(screen.queryByTestId("admin-platform-member-u-linke-superuser")).toBeNull();

    expect(screen.getByTestId("admin-platform-member-u-linke-org-org-a-name")).toHaveTextContent("远洋咨询");
    expect(screen.getByTestId("admin-platform-member-u-linke-org-org-a-role")).toHaveTextContent("顾问");
    expect(screen.getByTestId("admin-platform-member-u-linke-org-org-b-role")).toHaveTextContent("管理员");
  });

  it("403 NOT_PLATFORM_SUPERUSER → 「仅平台运维可见」说明，不是失败态", async () => {
    fetchMock.mockImplementation(routed({ list: jsonResponse({ reasonCode: "NOT_PLATFORM_SUPERUSER" }, 403) }));
    render(<PlatformMembersScreen state="default" />);

    const notice = await screen.findByTestId("admin-platform-members-forbidden");
    expect(notice).toHaveTextContent("仅平台运维");
    expect(screen.queryByTestId("admin-platform-members-failed")).toBeNull();
    expect(screen.queryByTestId("admin-platform-members-list")).toBeNull();
  });

  it("503 → 失败态，带重试，不用旧数据顶替", async () => {
    fetchMock.mockImplementation(routed({ list: jsonResponse({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503) }));
    render(<PlatformMembersScreen state="default" />);

    const failed = await screen.findByTestId("admin-platform-members-failed");
    expect(failed).toHaveTextContent("DEPENDENCY_UNAVAILABLE");
    expect(screen.queryByTestId("admin-platform-members-list")).toBeNull();
  });

  it("选一个角色真的发 PATCH（路径含 userId 与 orgId），成功后就地更新并出现前值 → 新值", async () => {
    fetchMock.mockImplementation(routed());
    render(<PlatformMembersScreen state="default" />);

    const trigger = await screen.findByTestId("admin-platform-member-u-linke-org-org-a-role");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId("admin-platform-member-u-linke-org-org-a-role-option-lead"));

    await waitFor(() => expect(trigger).toHaveTextContent("项目负责人"));
    expect(screen.getByTestId("admin-platform-members-banner")).toHaveTextContent("林可 · 远洋咨询：顾问 → 项目负责人");
    // 另一条成员身份（北极星 · 管理员）不受影响。
    expect(screen.getByTestId("admin-platform-member-u-linke-org-org-b-role")).toHaveTextContent("管理员");

    const call = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(String(call?.[0])).toContain("/platform/members/u-linke/organizations/org-a/role");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ userId: "u-linke", orgId: "org-a", orgRole: "lead" });
  });

  it("409 LAST_ADMIN → 行内说清下一步，下拉值不变", async () => {
    fetchMock.mockImplementation(routed({ setRole: () => jsonResponse({ reasonCode: "LAST_ADMIN" }, 409) }));
    render(<PlatformMembersScreen state="default" />);

    const trigger = await screen.findByTestId("admin-platform-member-u-linke-org-org-b-role");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId("admin-platform-member-u-linke-org-org-b-role-option-consultant"));

    const error = await screen.findByTestId("admin-platform-member-u-linke-org-org-b-role-error");
    expect(error).toHaveTextContent("最后一名管理员");
    expect(trigger).toHaveTextContent("管理员");
  });
});

describe("PlatformMembersScreen · 平台管理员（platform-admin-role delta）", () => {
  it("查看者不是平台超管：看得到别人的平台管理员徽章，但看不到能点的授予/撤销按钮", async () => {
    sessionMock.userId = "u-linke"; // 林可本人不是平台超管。
    fetchMock.mockImplementation(
      routed({ list: jsonResponse({ members: [{ ...ROSTER.members[1], platformAdmin: true }] }) }),
    );
    render(<PlatformMembersScreen state="default" />);

    expect(await screen.findByTestId("admin-platform-member-u-linke-admin-badge")).toHaveTextContent("平台管理员");
    expect(screen.queryByTestId("admin-platform-member-u-linke-admin-toggle")).toBeNull();
  });

  it("查看者是平台超管：能点「设为平台管理员」，成功后徽章出现、按钮变「撤销」", async () => {
    sessionMock.userId = "u-ops"; // u-ops 在 ROSTER 里 platformSuperuser: true。
    fetchMock.mockImplementation(routed());
    render(<PlatformMembersScreen state="default" />);

    const toggle = await screen.findByTestId("admin-platform-member-u-linke-admin-toggle");
    expect(toggle).toHaveTextContent("设为平台管理员");
    expect(screen.queryByTestId("admin-platform-member-u-linke-admin-badge")).toBeNull();

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveTextContent("撤销平台管理员"));
    expect(screen.getByTestId("admin-platform-member-u-linke-admin-badge")).toHaveTextContent("平台管理员");
    expect(screen.getByTestId("admin-platform-members-banner")).toHaveTextContent("林可：已设为平台管理员");

    const call = fetchMock.mock.calls.find((c) => c[1]?.method === "POST" && String(c[0]).includes("platform-admin"));
    expect(String(call?.[0])).toContain("/platform/members/u-linke/platform-admin");
  });

  it("撤销失败（403 NOT_PLATFORM_SUPERUSER）：行内报错，状态不变", async () => {
    sessionMock.userId = "u-ops";
    fetchMock.mockImplementation(
      routed({
        list: jsonResponse({ members: [ROSTER.members[0], { ...ROSTER.members[1], platformAdmin: true }] }),
        revokeAdmin: () => jsonResponse({ reasonCode: "NOT_PLATFORM_SUPERUSER" }, 403),
      }),
    );
    render(<PlatformMembersScreen state="default" />);

    const toggle = await screen.findByTestId("admin-platform-member-u-linke-admin-toggle");
    expect(toggle).toHaveTextContent("撤销平台管理员");
    fireEvent.click(toggle);

    const error = await screen.findByTestId("admin-platform-member-u-linke-admin-error");
    expect(error).toHaveTextContent("只有平台超管");
    expect(toggle).toHaveTextContent("撤销平台管理员");
  });

  it("平台超管本人不叠加平台管理员徽章/按钮——权限已经在超管之上", async () => {
    sessionMock.userId = "u-ops";
    fetchMock.mockImplementation(routed());
    render(<PlatformMembersScreen state="default" />);

    await screen.findByTestId("admin-platform-member-u-ops-superuser");
    expect(screen.queryByTestId("admin-platform-member-u-ops-admin-badge")).toBeNull();
    expect(screen.queryByTestId("admin-platform-member-u-ops-admin-toggle")).toBeNull();
  });
});
