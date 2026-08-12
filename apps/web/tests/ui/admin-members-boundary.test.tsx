/**
 * F06 / D-18 — 「你作为管理员看不到什么」这块屏（`/admin/members` 的
 * `admin-members-boundary`），四条 user_visible_behavior 断言在界面上的样子。
 *
 * ## ⚠ F163 改写：同样四条主张，但断言对象从 mock 换成了真接线
 *
 * 这个文件原来断言的是 `lib/mock/admin.MEMBERS.privateEntries` /
 * `ADMIN_ACCESS_LOGS` / `ADMIN_PROJECT_ACCESS_COUNT` 三份写死数据渲染到了屏上。
 * F163 把这块屏接到了 F06 早就 passing 的两条真端点
 * （`GET /identity/personal-layer/summary` + `GET /admin-access-log/mine`），
 * 那三份 mock 不再驱动界面——继续断言它们，就是在断言一组不再被渲染的常量。
 *
 * 所以本文件**保留 F06 的四条主张不变**，只把它们重新钉在真接线上：
 *   ① 个人层只见计数，不见内容；
 *   ② 项目层可读但必留痕、对负责人可见，且访问计数在屏上；
 *   ③ 访问记录逐条可见，每条标着「对负责人可见」；
 *      （原来的第三条讲「常驻列表与抽屉是同一批数据」——F163 之后没有抽屉了，
 *       列表常驻，那个「两处可能对不上」的风险由构造消失，不再需要断言。）
 *   ④ 管理员不因身份自动获得内容读取权——这句声明必须在屏上，不只在需求文档里。
 *
 * 逐字段的接线行为（逐人一次请求、计数失败态、去重计数）在
 * `admin-members-boundary-live.test.tsx`，本文件不重复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-f06" }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: { org: { id: sessionState.currentOrgId, name: "真实组织" }, orgRole: "admin" },
  }),
}));

import { AdminBoundaryLive } from "@/components/admin/admin-boundary-live";

/** 一条私有条目的**正文**。它绝不该出现在任何响应里，更不该出现在屏上。 */
const SECRET = "林可对这家客户的半成品判断";

const MEMBERS = {
  members: [
    { userId: "u-linke", displayName: "林可", email: "l@x.test", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
  ],
};

const LOGS = {
  entries: [
    { logId: "al-1", adminId: "u-admin", projectId: "proj-energy", objectRef: "artifact:1", readAt: "2026-08-01T10:00:00Z" },
    { logId: "al-2", adminId: "u-admin", projectId: "proj-supply", objectRef: "artifact:2", readAt: "2026-08-02T10:00:00Z" },
  ],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("/identity/personal-layer/summary")) {
      // 契约的 `out` 里结构上就没有内容字段——这里连一个可以泄漏的字段都构造不出来。
      return Promise.resolve(jsonResponse({ userId: "u-linke", itemCount: 34, reasonCode: "PERSONAL_LAYER_CLOSED" }));
    }
    if (u.includes("/admin-access-log/mine")) return Promise.resolve(jsonResponse(LOGS));
    return Promise.resolve(jsonResponse(MEMBERS));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("管理员权力边界：个人层只见计数", () => {
  it("① 每个有私有条目的人只显示计数与「内容不可见」徽标，不显示任何内容文本", async () => {
    render(<AdminBoundaryLive />);

    const boundary = await waitFor(() => screen.getByTestId("admin-members-private-counts"));
    const row = within(boundary).getByTestId("admin-member-private-u-linke");
    expect(row.textContent).toContain("林可");
    expect(row.textContent).toContain("34");
    expect(row.textContent).toContain("内容不可见");
    // 阳性对照 + 反证：屏上不含任何条目正文。它不在屏上，是因为它根本没被送到前端。
    expect(boundary.textContent).not.toContain(SECRET);
  });
});

describe("管理员权力边界：项目层可读但必留痕、对负责人可见", () => {
  it("② 说明区讲清「每次访问都会写入审计日志，并对项目负责人可见」，并给出访问计数", async () => {
    render(<AdminBoundaryLive />);

    const area = await waitFor(() => screen.getByTestId("admin-members-project-access"));
    expect(area.textContent).toContain("每次访问都会写入审计日志");
    expect(area.textContent).toContain("对项目负责人可见");
    // 两条留痕、两个不同项目 ⇒ 2，从真数据算出来的。
    await waitFor(() => expect(area.textContent).toContain("本月你访问过 2 个项目"));
  });

  it("③ 每一条访问记录都标着「对负责人可见」，条数与响应一致", async () => {
    render(<AdminBoundaryLive />);

    await waitFor(() => expect(screen.getByTestId("admin-access-log-al-1")).toBeTruthy());
    expect(screen.getByTestId("admin-access-log-al-2")).toBeTruthy();
    expect(screen.getAllByText("对负责人可见")).toHaveLength(LOGS.entries.length);
  });
});

describe("管理员不因身份自动获得内容读取权", () => {
  it("④ 「唯一路径是升到项目层、不存在旁路」这句声明真的在屏上", async () => {
    render(<AdminBoundaryLive />);

    const boundary = await waitFor(() => screen.getByTestId("admin-members-boundary"));
    expect(boundary.textContent).toContain("唯一对管理员封闭的一层");
    expect(boundary.textContent).toContain("不存在申请、提权、临时授权等旁路");
  });
});
