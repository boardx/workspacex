/**
 * F353 —— `/projects` 列表页从 mock 切到真实 `GET /projects` 的组件测试。
 *
 * 与 `tests/ui/project-live-page.test.tsx`（F122）同一模式：假 `fetch`，不连真实后端。
 * SessionProvider 已在壳层完成登录与 current-org 解析。本组件测试钉住：① 自动使用
 * provider 的 currentOrgId；② member/managed 两段只渲染契约字段；③ 不生成伪数据。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-e2e-demo" } }),
}));

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
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-353");

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

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

  it("按 provider 的 current-org 自动拉取真实列表，只渲染契约有的字段", async () => {
    render(<ProjectsScreen />);

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
    render(<ProjectsScreen />);

    await waitFor(() => screen.getByTestId("projects-member-list"));

    fireEvent.change(screen.getByTestId("projects-search"), { target: { value: "不存在的名字" } });
    expect(screen.getByTestId("projects-member-list-empty")).toBeInTheDocument();
  });
});
