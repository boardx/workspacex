/**
 * F353 —— `/projects` 列表页从 mock 切到真实 `GET /projects` 的组件测试。
 *
 * 与 `tests/ui/project-live-page.test.tsx`（F122）同一模式：假 `fetch`，不连真实后端。
 * 钉住三件事：① 未登录时看到登录表单，不是 mock 卡片；② 登录 + 填组织 id 后按
 * member/managed 两段渲染，字段只有契约给的那五个（没有 readiness/schedule 这些编出来的东西）；
 * ③ 空列表就是空列表，不生成伪数据。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectsScreen } from "@/components/projects/projects-screen";

const ORG = "org-e2e-demo";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("F353 /projects：登录 → 真实列表（无编造字段）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname === "/auth/login" && method === "POST") {
        return jsonResponse({
          sessionToken: "tok-e2e-353",
          userId: "u-e2e",
          orgs: [ORG],
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
      }

      if (url.pathname === "/projects" && method === "GET") {
        expect(url.searchParams.get("orgId")).toBe(ORG);
        expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer tok-e2e-353");
        return jsonResponse({
          member: [{ id: "p-real-1", name: "真实项目一号", kind: "workshop", status: "active", readOnlyReason: null }],
          managed: [],
        });
      }

      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未登录时显示登录表单，不是 mock 项目卡片", () => {
    render(<ProjectsScreen initialOrgId="" />);
    expect(screen.getByTestId("projects-login-card")).toBeInTheDocument();
    expect(screen.queryByTestId("projects-member-list")).not.toBeInTheDocument();
    // mock 数据里的项目名不应该出现
    expect(screen.queryByText("欧洲储能进入策略")).not.toBeInTheDocument();
  });

  it("登录后按组织 id 拉取真实列表，只渲染契约有的字段", async () => {
    render(<ProjectsScreen initialOrgId="" />);

    fireEvent.change(screen.getByTestId("projects-login-email"), { target: { value: "lead@example.com" } });
    fireEvent.change(screen.getByTestId("projects-login-password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByTestId("projects-login-submit"));

    fireEvent.change(await screen.findByTestId("projects-org-id"), { target: { value: ORG } });
    fireEvent.click(screen.getByTestId("projects-refresh"));

    const memberList = await screen.findByTestId("projects-member-list");
    expect(within(memberList).getByTestId("projects-card-p-real-1-name")).toHaveTextContent("真实项目一号");
    expect(within(memberList).getByTestId("projects-card-p-real-1-status")).toHaveTextContent("进行中");

    // managed 段是正常空态，不是伪数据
    expect(screen.getByTestId("projects-managed-list-empty")).toBeInTheDocument();

    // 「进入项目」链接必须带上 org id，overview 才查得到真实数据
    const enterLink = within(memberList).getByTestId("projects-card-p-real-1-enter");
    expect(enterLink).toHaveAttribute("href", `/projects/p-real-1?org=${ORG}`);
  });

  it("搜索框按名称过滤真实列表", async () => {
    render(<ProjectsScreen initialOrgId={ORG} />);

    fireEvent.change(screen.getByTestId("projects-login-email"), { target: { value: "lead@example.com" } });
    fireEvent.change(screen.getByTestId("projects-login-password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByTestId("projects-login-submit"));

    await waitFor(() => screen.getByTestId("projects-member-list"));

    fireEvent.change(screen.getByTestId("projects-search"), { target: { value: "不存在的名字" } });
    expect(screen.getByTestId("projects-member-list-empty")).toBeInTheDocument();
  });
});
