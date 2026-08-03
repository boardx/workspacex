/**
 * F122 —— `/project/live` 端到端路径的组件测试：登录 → 列表 → 创建 → 刷新看到它。
 *
 * `global.fetch` 被替换成一个按 URL/method 分发的假实现，不连真实后端——
 * 那一半由 `apps/api/tests/project/list-projects-*.test.ts`（真实 Postgres）与
 * 手动走一遍浏览器共同覆盖（见 issue #103 的端到端验证记录）。本文件只钉住
 * **前端这一侧**：拿到登录响应后 token 确实被带上、列表确实按 member/managed
 * 两段渲染、创建成功后确实重新拉取并看到新项目——即「填表单 → 提交 → 刷新列表 →
 * 看到它」这条路径在组件层面成立，不依赖任何 mock 数据源。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ProjectLivePage from "@/app/project/live/page";

const ORG = "org-e2e-demo";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("F122 /project/live：登录 → 列表 → 创建 → 刷新看到它", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let projectsAfterCreate = false;

  beforeEach(() => {
    window.localStorage.clear();
    projectsAfterCreate = false;

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname === "/auth/login" && method === "POST") {
        return jsonResponse({
          sessionToken: "tok-e2e-123",
          userId: "u-e2e",
          orgs: [ORG],
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });
      }

      if (url.pathname === "/projects" && method === "GET") {
        expect(url.searchParams.get("orgId")).toBe(ORG);
        // 鉴权头确实被带上——这是「登录拿到的 token 真的被用于后续请求」的断言。
        expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer tok-e2e-123");
        if (!projectsAfterCreate) {
          return jsonResponse({
            member: [{ id: "p-mine", name: "我在里面的", kind: "workshop", status: "active", readOnlyReason: null }],
            managed: [],
          });
        }
        return jsonResponse({
          member: [{ id: "p-mine", name: "我在里面的", kind: "workshop", status: "active", readOnlyReason: null }],
          managed: [
            { id: "p-new", name: "刚创建的项目", kind: "workshop", status: "active", readOnlyReason: null },
          ],
        });
      }

      if (url.pathname === "/projects" && method === "POST") {
        projectsAfterCreate = true;
        return jsonResponse({ id: "p-new", kind: "workshop", status: "active" }, 201);
      }

      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("登录后自动拉取列表，创建新项目后刷新能看到它出现在 managed 段", async () => {
    render(<ProjectLivePage />);

    fireEvent.change(screen.getByTestId("live-login-email"), { target: { value: "lead@example.com" } });
    fireEvent.change(screen.getByTestId("live-login-password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByTestId("live-login-submit"));

    // 登录成功后立刻按第一个组织自动刷新一次列表。
    const memberList = await screen.findByTestId("live-member-list");
    expect(within(memberList).getByTestId("live-project-item-p-mine")).toHaveTextContent("我在里面的");

    // managed 段此时是空列表——反证「不生成伪数据」：没有 p-new 之前它不该出现。
    expect(screen.getByTestId("live-managed-list-empty")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("live-create-name"), { target: { value: "刚创建的项目" } });
    fireEvent.click(screen.getByTestId("live-create-submit"));

    // 创建 → 自动刷新 → managed 段出现新项目。这就是「填表单 → 提交 → 刷新列表 → 看到它」。
    await waitFor(() => {
      const managedList = screen.getByTestId("live-managed-list");
      expect(within(managedList).getByTestId("live-project-item-p-new")).toHaveTextContent("刚创建的项目");
    });

    // member 段的既有项目没有因为一次新的创建而消失或重复。
    const memberListAfter = screen.getByTestId("live-member-list");
    expect(within(memberListAfter).getAllByTestId("live-project-item-p-mine")).toHaveLength(1);
  });

  it("列表接口失败时显示错误，不把失败呈现成空列表", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ sessionToken: "tok-x", userId: "u-x", orgs: [ORG], expiresAt: new Date().toISOString() }),
    );
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ error: "service_unavailable", reasonCode: "AUTH_SERVICE_UNAVAILABLE", traceId: "trace-list" }, 503),
    );

    render(<ProjectLivePage />);
    fireEvent.change(screen.getByTestId("live-login-email"), { target: { value: "lead@example.com" } });
    fireEvent.change(screen.getByTestId("live-login-password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByTestId("live-login-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("live-list-error")).toHaveTextContent("AUTH_SERVICE_UNAVAILABLE");
    });
    // ⚠ 失败态下不能同时渲染一个「看起来正常」的空列表——两者必须可区分。
    expect(screen.queryByTestId("live-member-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("live-member-list-empty")).not.toBeInTheDocument();
  });
});
