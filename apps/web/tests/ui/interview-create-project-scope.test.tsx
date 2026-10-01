/**
 * 项目中枢 B2-S2 —— Studio 从项目页带 `?projectId=` 进来时，新建的资源归到该项目。
 * 以访谈 Studio 为证：`/itv?create=1&projectId=p1` ⇒ 顶部有「返回项目」面包屑链回项目的用户洞察子页；
 * 新建弹窗显示「本项目访谈」；提交时 `POST /interviews/digital` 的 scope 是 `{kind:"project", projectId}`
 * （访谈表自带 project_id，不走链接表）；创建后进入 Markdown intake 页仍带 `?projectId=`。只 mock 网络边界与路由。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/itv" }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-1" } }),
  useOptionalSession: () => ({ session: { currentOrgId: "org-1", sessionToken: "tok" } }),
}));

import { InterviewStudioHome } from "@/components/itv/interview-studio-home";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("B2-S2 访谈 Studio 带 ?projectId= 新建 ⇒ 访谈归到项目", () => {
  beforeEach(() => {
    push.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === "/interviews/digital" && (init?.method ?? "GET") === "GET") return json({ items: [] });
      if (url.pathname === "/interviews/digital" && init?.method === "POST") return json({ interviewId: "itv-new" });
      throw new Error(`unexpected fetch ${url.pathname}`);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("面包屑回项目、scope 是 project、创建后 intake 页续上 projectId", async () => {
    render(<InterviewStudioHome initialCreateOpen projectId="p1" />);
    expect(screen.getByTestId("project-breadcrumb-back")).toHaveAttribute("href", "/projects/p1?tab=research&sub=itv");
    expect(await screen.findByTestId("itv-create-scope")).toHaveTextContent("本项目访谈");
    fireEvent.change(screen.getByTestId("itv-create-name"), { target: { value: "并网周期访谈" } });
    fireEvent.click(screen.getByTestId("itv-create-submit"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/itv/itv-new/intake?projectId=p1"));
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
    const body = JSON.parse(String(post[1]!.body));
    expect(body.scope).toEqual({ kind: "project", projectId: "p1", researchProjectId: null });
    expect(body.name).toBe("并网周期访谈");
  });

  it("没有 projectId ⇒ 仍是独立访谈，没有面包屑", async () => {
    render(<InterviewStudioHome initialCreateOpen />);
    expect(screen.queryByTestId("project-breadcrumb")).toBeNull();
    expect(await screen.findByTestId("itv-create-scope")).toHaveTextContent("独立访谈");
  });
});
