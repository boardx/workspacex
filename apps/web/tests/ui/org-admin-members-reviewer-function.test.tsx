/**
 * issue #852 —— 组织管理员任命 Skill 审核人职能，前端接线单测（mocked fetch）。
 *
 * 反证重点：
 *  · 非 admin 渲染时**不发** `listSkillReviewerFunctions` 请求，且不渲染任何指派控件——
 *    「看得到但按不动」和「压根不请求」是两件事，这里断的是后者；
 *  · admin 渲染时职能下拉的初始值来自真实 `GET` 响应，不是写死的 "无职能"；
 *  · 选择一个职能会真的发出 `POST assign` 请求，body 带 `orgId/userId/reviewerFunction`；
 *  · 选回"无审核职能"会发 `POST revoke`，不是发一次 `assign(null)`。
 *
 * F06（issue #1930）—— 控件从原生 `<select>` 换成 `PopoverSelect`（按钮 + `role=listbox`
 * 弹层）后，交互从 `fireEvent.change(select, ...)` 改为 `fireEvent.click` 触发按钮
 * 打开弹层、再点目标选项——同 `org-admin-screen.tsx` 里 `ReviewerFunctionPicker`
 * 头注说明的理由：原生 select 弹层不在自动化可驱动的 DOM 事件系统内。
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
  ],
};

const fetchMock = vi.fn();

function routed(overrides: { assignments?: Response; assign?: Response; revoke?: Response } = {}) {
  return (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    // ⚠ 顺序要紧：`/skill-reviewer-functions`（复数，list）本身就以
    // `/skill-reviewer-function` 为前缀子串，先判 revoke/GET-list 这两个更specific 的
    // 分支，最后才落到「单数、POST」这个最泛的 assign 分支——反过来会把 list 请求
    // 误判成 assign。
    if (u.includes("/skill-reviewer-function/revoke")) {
      return Promise.resolve(overrides.revoke ?? jsonResponse({ userId: "u-linke", revoked: true }, 201));
    }
    if (method === "GET" && u.includes("/skill-reviewer-functions")) {
      return Promise.resolve(overrides.assignments ?? jsonResponse({ assignments: [] }));
    }
    if (u.includes("/skill-reviewer-function")) {
      return Promise.resolve(
        overrides.assign
          ?? jsonResponse({ userId: "u-linke", reviewerFunction: "methodology-reviewer", assignedBy: "u-admin", assignedAt: "2026-08-15T00:00:00Z" }, 201),
      );
    }
    if (u.includes("/members") && method === "GET") {
      return Promise.resolve(jsonResponse(MEMBERS));
    }
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

describe("MembersTab —— issue #852 审核人职能指派", () => {
  it("非 admin：不发 listSkillReviewerFunctions 请求，不渲染任何指派控件", async () => {
    fetchMock.mockImplementation(routed());
    render(<MembersTab orgId="org-i852" isAdmin={false} />);

    await waitFor(() => expect(screen.getByTestId("org-admin-member-u-linke")).toBeTruthy());

    expect(screen.queryByTestId("org-admin-member-u-linke-reviewer-function")).toBeNull();
    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("skill-reviewer-function"))).toBe(false);
  });

  it("admin：下拉初始值来自真实 GET 响应（已指派 security-reviewer）", async () => {
    fetchMock.mockImplementation(
      routed({
        assignments: jsonResponse({
          assignments: [{ userId: "u-linke", reviewerFunction: "security-reviewer", assignedBy: "u-admin", assignedAt: "2026-08-01T00:00:00Z" }],
        }),
      }),
    );
    render(<MembersTab orgId="org-i852" isAdmin={true} />);

    await waitFor(() => {
      const trigger = screen.getByTestId("org-admin-member-u-linke-reviewer-function");
      expect(trigger).toHaveTextContent("安全评审人");
    });
  });

  it("admin：选一个职能真的发 POST assign，body 带 orgId/userId/reviewerFunction", async () => {
    fetchMock.mockImplementation(routed());
    render(<MembersTab orgId="org-i852" isAdmin={true} />);

    const trigger = await screen.findByTestId("org-admin-member-u-linke-reviewer-function");
    fireEvent.click(trigger);
    const option = await screen.findByTestId("org-admin-member-u-linke-reviewer-function-option-methodology-reviewer");
    fireEvent.click(option);

    await waitFor(() => expect(trigger).toHaveTextContent("方法论审核人"));

    const assignCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("skill-reviewer-function") && !String(c[0]).includes("revoke") && c[1]?.method === "POST",
    );
    expect(assignCall).toBeTruthy();
    const body = JSON.parse(String(assignCall?.[1]?.body ?? "{}"));
    expect(body).toMatchObject({ orgId: "org-i852", userId: "u-linke", reviewerFunction: "methodology-reviewer" });
  });

  it("admin：选回「无审核职能」发的是 POST revoke，不是 assign(null)", async () => {
    fetchMock.mockImplementation(
      routed({
        assignments: jsonResponse({
          assignments: [{ userId: "u-linke", reviewerFunction: "methodology-reviewer", assignedBy: "u-admin", assignedAt: "2026-08-01T00:00:00Z" }],
        }),
      }),
    );
    render(<MembersTab orgId="org-i852" isAdmin={true} />);

    const trigger = await screen.findByTestId("org-admin-member-u-linke-reviewer-function");
    await waitFor(() => expect(trigger).toHaveTextContent("方法论审核人"));

    fireEvent.click(trigger);
    const option = await screen.findByTestId("org-admin-member-u-linke-reviewer-function-option-");
    fireEvent.click(option);

    await waitFor(() => expect(trigger).toHaveTextContent("无审核职能"));

    const revokeCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("skill-reviewer-function/revoke"));
    expect(revokeCall).toBeTruthy();
    expect(revokeCall?.[1]?.method).toBe("POST");
  });
});
