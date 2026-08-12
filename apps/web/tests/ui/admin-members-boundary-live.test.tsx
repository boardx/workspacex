/**
 * F163 —— 「你作为管理员看不到什么」接**既有**真端点（F06 已 passing，前端此前没接）。
 *
 * 反证重点：
 *  · 计数来自 `GET /identity/personal-layer/summary`，**逐人一次请求**——
 *    一个「拿 mock 的 privateEntries 渲染」的实现不会发出任何请求；
 *  · 「本月访问过 N 个项目」是从留痕里的 `projectId` **去重**算出来的，
 *    不是一个写死的数字（原来的 mock 里它就是写死的 `ADMIN_PROJECT_ACCESS_COUNT`）；
 *  · 计数读失败要说失败，**不回落到示例人名**；
 *  · 访问记录读失败**不该**把整块边界说明也带走——那段说明是产品承诺，不是数据。
 *  · 组件手里**根本没有内容字段**（契约保证），所以断言的是「渲染出的文本里没有任何
 *    条目正文」这件事在结构上成立：响应里我们连一个可以泄漏的字段都构造不出来。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-f163" }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: { org: { id: sessionState.currentOrgId, name: "真实组织" }, orgRole: "admin" },
  }),
}));

import { AdminBoundaryLive } from "@/components/admin/admin-boundary-live";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const MEMBERS = {
  members: [
    { userId: "u-linke", displayName: "林可", email: "l@x.test", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
    { userId: "u-gaolin", displayName: "高琳", email: "g@x.test", orgRole: "admin", teamId: null, joinedAt: "2026-01-01", status: "active" },
  ],
};

const LOGS = {
  entries: [
    { logId: "log-1", adminId: "u-gaolin", projectId: "proj-a", objectRef: "artifact:1", readAt: "2026-08-01T10:00:00Z" },
    { logId: "log-2", adminId: "u-gaolin", projectId: "proj-a", objectRef: "artifact:2", readAt: "2026-08-02T10:00:00Z" },
    { logId: "log-3", adminId: "u-gaolin", projectId: "proj-b", objectRef: "artifact:3", readAt: "2026-08-03T10:00:00Z" },
  ],
};

const fetchMock = vi.fn();

function routed(overrides: { summary?: (userId: string) => Response; logs?: Response; members?: Response } = {}) {
  return (url: string) => {
    const u = String(url);
    if (u.includes("/identity/personal-layer/summary")) {
      const userId = new URL(u, "http://x").searchParams.get("userId") ?? "";
      return Promise.resolve(
        overrides.summary?.(userId)
          ?? jsonResponse({ userId, itemCount: userId === "u-linke" ? 34 : 0, reasonCode: "PERSONAL_LAYER_CLOSED" }),
      );
    }
    if (u.includes("/admin-access-log/mine")) return Promise.resolve(overrides.logs ?? jsonResponse(LOGS));
    return Promise.resolve(overrides.members ?? jsonResponse(MEMBERS));
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F163 管理员边界 —— 接既有真端点", () => {
  it("计数逐人来自 personal-layer/summary（mock 实现不会发出这些请求）", async () => {
    fetchMock.mockImplementation(routed());

    render(<AdminBoundaryLive />);

    await waitFor(() => expect(screen.getByTestId("admin-member-private-u-linke")).toBeTruthy());
    expect(screen.getByTestId("admin-member-private-u-linke").textContent).toContain("34");
    // 条目数为 0 的人不列出来——「没有私有条目」不需要一行「0 条」。
    expect(screen.queryByTestId("admin-member-private-u-gaolin")).toBeNull();

    const summaryCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/identity/personal-layer/summary"));
    expect(summaryCalls).toHaveLength(2);   // 两名成员各一次
  });

  it("「访问过 N 个项目」按 projectId 去重算，不是写死的数字", async () => {
    fetchMock.mockImplementation(routed());

    render(<AdminBoundaryLive />);

    // 三条留痕、两个不同项目 ⇒ 2。写死的实现会显示 mock 里的那个数（3）。
    await waitFor(() => expect(screen.getByTestId("admin-members-project-access").textContent)
      .toContain("本月你访问过 2 个项目"));
  });

  it("留痕逐条渲染，且每条标着「对负责人可见」", async () => {
    fetchMock.mockImplementation(routed());

    render(<AdminBoundaryLive />);

    await waitFor(() => expect(screen.getByTestId("admin-access-log-log-1")).toBeTruthy());
    expect(screen.getByTestId("admin-access-log-log-3")).toBeTruthy();
    expect(screen.getAllByText("对负责人可见")).toHaveLength(3);
  });

  it("计数读失败：说失败，不回落到示例人名", async () => {
    fetchMock.mockImplementation(routed({ members: jsonResponse({ reasonCode: "FORBIDDEN" }, 403) }));

    render(<AdminBoundaryLive />);

    await waitFor(() => expect(screen.getByTestId("admin-boundary-counts-failed")).toBeTruthy());
    expect(screen.queryByText("林可")).toBeNull();
  });

  it("【反证】访问记录读失败不带走整块边界说明（那段说明是产品承诺，不是数据）", async () => {
    fetchMock.mockImplementation(routed({ logs: jsonResponse({ reasonCode: "AUTH_SERVICE_UNAVAILABLE" }, 503) }));

    render(<AdminBoundaryLive />);

    await waitFor(() => expect(screen.getByTestId("admin-boundary-logs-empty")).toBeTruthy());
    // 「个人层是唯一对管理员封闭的一层」这句必须还在——它不依赖任何一次请求成功。
    expect(screen.getByText(/唯一对管理员封闭的一层/)).toBeTruthy();
    expect(screen.getByTestId("admin-members-boundary")).toBeTruthy();
  });

  it("没有人写过个人层条目 ⇒ 空态，不是示例数字", async () => {
    fetchMock.mockImplementation(routed({
      summary: (userId) => jsonResponse({ userId, itemCount: 0, reasonCode: "PERSONAL_LAYER_CLOSED" }),
    }));

    render(<AdminBoundaryLive />);

    await waitFor(() => expect(screen.getByTestId("admin-boundary-counts-empty")).toBeTruthy());
  });
});
