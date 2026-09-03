/**
 * member-role-management delta（组织级）—— `/org-admin` 成员标签页的「组织角色」下拉，前端接线单测（mocked fetch）。
 *
 * 反证重点：
 *  · 非 admin：只渲染只读徽章，**没有**可操作的角色下拉（藏的是写入口，不是信息）；
 *  · admin：下拉初始值来自真实 `GET /members` 响应的 `orgRole`，不是写死的默认值；
 *  · 选一个角色真的发 `PATCH …/members/:userId/role`，body 带 `orgId/userId/orgRole`，
 *    成功后那一行就地更新、出现「前值 → 新值」的状态条；
 *  · 服务端回 409 `LAST_ADMIN` 时，行内显示的是**说清下一步**的人话，下拉值不变。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MembersTab } from "@/components/org-admin/org-admin-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const MEMBERS = {
  members: [
    { userId: "u-linke", displayName: "林可", email: "l@x.test", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
    { userId: "u-admin", displayName: "管理员甲", email: "a@x.test", orgRole: "admin", teamId: null, joinedAt: "2026-01-01", status: "active" },
  ],
};

const fetchMock = vi.fn();

function routed(overrides: { setRole?: (body: Record<string, unknown>) => Response } = {}) {
  return (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "PATCH" && /\/members\/[^/]+\/role$/.test(u)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Promise.resolve(
        overrides.setRole?.(body)
          ?? jsonResponse({ userId: body.userId, orgRole: body.orgRole, previousOrgRole: "consultant" }),
      );
    }
    if (method === "GET" && u.includes("/skill-reviewer-functions")) return Promise.resolve(jsonResponse({ assignments: [] }));
    if (method === "GET" && u.includes("/members")) return Promise.resolve(jsonResponse(MEMBERS));
    return Promise.resolve(jsonResponse({}, 404));
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MembersTab —— 组织角色调整", () => {
  it("非 admin：只读徽章，没有角色下拉", async () => {
    fetchMock.mockImplementation(routed());
    render(<MembersTab orgId="org-mrm" isAdmin={false} />);

    const row = await screen.findByTestId("org-admin-member-u-linke");
    expect(row).toHaveTextContent("顾问");
    expect(screen.queryByTestId("org-admin-member-u-linke-org-role")).toBeNull();
  });

  it("admin：下拉初始值来自 GET 响应（顾问 / 管理员各自正确）", async () => {
    fetchMock.mockImplementation(routed());
    render(<MembersTab orgId="org-mrm" isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("org-admin-member-u-linke-org-role")).toHaveTextContent("顾问");
      expect(screen.getByTestId("org-admin-member-u-admin-org-role")).toHaveTextContent("管理员");
    });
  });

  it("admin：选「项目负责人」真的发 PATCH，body 正确，行就地更新并出现前值 → 新值", async () => {
    fetchMock.mockImplementation(routed());
    render(<MembersTab orgId="org-mrm" isAdmin={true} />);

    const trigger = await screen.findByTestId("org-admin-member-u-linke-org-role");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId("org-admin-member-u-linke-org-role-option-lead"));

    await waitFor(() => expect(trigger).toHaveTextContent("项目负责人"));
    expect(screen.getByTestId("org-admin-member-role-banner")).toHaveTextContent("林可：顾问 → 项目负责人");

    const call = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(String(call?.[0])).toContain("/organizations/org-mrm/members/u-linke/role");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ orgId: "org-mrm", userId: "u-linke", orgRole: "lead" });
  });

  it("admin：服务端 409 LAST_ADMIN → 行内说清下一步，下拉值不变", async () => {
    fetchMock.mockImplementation(routed({ setRole: () => jsonResponse({ reasonCode: "LAST_ADMIN" }, 409) }));
    render(<MembersTab orgId="org-mrm" isAdmin={true} />);

    const trigger = await screen.findByTestId("org-admin-member-u-admin-org-role");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId("org-admin-member-u-admin-org-role-option-consultant"));

    const error = await screen.findByTestId("org-admin-member-u-admin-org-role-error");
    expect(error).toHaveTextContent("最后一名管理员");
    expect(error).toHaveTextContent("先把另一位成员设为管理员");
    expect(trigger).toHaveTextContent("管理员");
    expect(screen.queryByTestId("org-admin-member-role-banner")).toBeNull();
  });
});
