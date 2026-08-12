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

/**
 * F164 —— `⋯` 菜单接真 archive / unarchive。
 *
 * 这里钉的是「**真的发了那个 POST**」而不是「菜单画出来了」：真栈卡片此前完全没有
 * `⋯` 菜单，而仓库里那个孤儿原型组件的归档动作是 `window.alert("演示")`——
 * 一个只画菜单不发请求的实现看起来和真的一模一样，所以每条断言都落在 fetch 上。
 */
describe("F164 /projects：⋯ 菜单接真 archiveProject / unarchiveProject", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let listCalls: number;
  let archiveCalls: { path: string; method: string; auth?: string }[];
  /** 归档后第二次 listProjects 返回的形状——由每个用例自己设定 */
  let afterArchive: unknown = null;
  /** 归档端点的响应；用例可换成失败 */
  let archiveResponder: () => Response = () =>
    jsonResponse({ projectId: "p-real-1", status: "archived", provenanceEventId: "ev-1" });

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-164");
    listCalls = 0;
    archiveCalls = [];
    afterArchive = null;
    archiveResponder = () => jsonResponse({ projectId: "p-real-1", status: "archived", provenanceEventId: "ev-1" });

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname === "/projects" && method === "GET") {
        listCalls += 1;
        if (listCalls > 1 && afterArchive !== null) return jsonResponse(afterArchive);
        return jsonResponse({
          member: [{ id: "p-real-1", name: "真实项目一号", kind: "workshop", status: "active", readOnlyReason: null }],
          managed: [],
        });
      }

      if (/^\/projects\/[^/]+\/(archive|unarchive)$/.test(url.pathname) && method === "POST") {
        archiveCalls.push({
          path: url.pathname,
          method,
          auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
        });
        return archiveResponder();
      }

      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openMenu() {
    render(<ProjectsScreen />);
    await screen.findByTestId("projects-member-list");
    fireEvent.click(screen.getByTestId("projects-card-p-real-1-more"));
    return screen.getByTestId("projects-more-menu-p-real-1");
  }

  it("菜单四项且无删除项；未实现的三项禁用并如实说明", async () => {
    const menu = await openMenu();

    expect(within(menu).getByTestId("projects-more-p-real-1-edit")).toBeDisabled();
    expect(within(menu).getByTestId("projects-more-p-real-1-bigscreen")).toBeDisabled();
    expect(within(menu).getByTestId("projects-more-p-real-1-copy-invite")).toBeDisabled();
    expect(within(menu).getByTestId("projects-more-p-real-1-unavailable-note")).toBeInTheDocument();

    // 归档项可点；**没有删除这个菜单项**（Q-9 裁不提供删除项目）
    expect(within(menu).getByTestId("projects-more-p-real-1-archive")).toBeEnabled();
    // 注意断的是「菜单项」而不是「页面上不出现『删除项目』四个字」——
    // Q-9 的说明文案本身就要提到它，按文本断会把说明也判成违规。
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(4);                              // 编辑/看大屏/复制邀请/归档
    expect(items.some((el) => /删除/.test(el.textContent ?? ""))).toBe(false);
  });

  it("归档要二次确认：确认前不发任何请求，取消也不发", async () => {
    const menu = await openMenu();

    fireEvent.click(within(menu).getByTestId("projects-more-p-real-1-archive"));
    expect(screen.getByTestId("projects-archive-confirm-p-real-1")).toBeInTheDocument();
    expect(archiveCalls).toHaveLength(0);            // 只是打开确认，还没发

    fireEvent.click(screen.getByTestId("projects-archive-cancel-p-real-1"));
    expect(archiveCalls).toHaveLength(0);            // 取消 = 不发
    expect(screen.queryByTestId("projects-more-menu-p-real-1")).not.toBeInTheDocument();
  });

  it("确认后发出真实 POST /projects/:id/archive（带鉴权头），成功后列表刷新并出现只读徽标", async () => {
    afterArchive = {
      member: [{ id: "p-real-1", name: "真实项目一号", kind: "workshop", status: "archived", readOnlyReason: "archived" }],
      managed: [],
    };

    const menu = await openMenu();
    fireEvent.click(within(menu).getByTestId("projects-more-p-real-1-archive"));
    fireEvent.click(screen.getByTestId("projects-archive-submit-p-real-1"));

    await waitFor(() => expect(archiveCalls).toHaveLength(1));
    expect(archiveCalls[0]).toMatchObject({
      path: "/projects/p-real-1/archive",
      method: "POST",
      auth: "Bearer tok-e2e-164",
    });

    // 刷新后的状态由后端说了算：只读徽标与「已归档」状态徽标自动出现
    await waitFor(() => {
      expect(screen.getByTestId("projects-card-p-real-1-readonly")).toHaveTextContent("已归档");
    });
    expect(screen.getByTestId("projects-card-p-real-1-status")).toHaveTextContent("已归档");
  });

  it("已归档项目的菜单提供恢复，走 unarchive 端点", async () => {
    render(<ProjectsScreen />);
    await screen.findByTestId("projects-member-list");
    // 第一次就是归档态：改用一个已归档的列表重新渲染
    afterArchive = null;

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      if (url.pathname === "/projects" && method === "GET") {
        return jsonResponse({
          member: [{ id: "p-real-1", name: "真实项目一号", kind: "workshop", status: "archived", readOnlyReason: "archived" }],
          managed: [],
        });
      }
      if (url.pathname === "/projects/p-real-1/unarchive" && method === "POST") {
        archiveCalls.push({ path: url.pathname, method });
        return jsonResponse({ projectId: "p-real-1", status: "active", provenanceEventId: "ev-2" });
      }
      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });

    fireEvent.click(screen.getByTestId("projects-refresh"));
    await waitFor(() => expect(screen.getByTestId("projects-card-p-real-1-status")).toHaveTextContent("已归档"));

    fireEvent.click(screen.getByTestId("projects-card-p-real-1-more"));
    const archiveItem = screen.getByTestId("projects-more-p-real-1-archive");
    expect(archiveItem).toHaveTextContent("恢复项目");

    fireEvent.click(archiveItem);
    fireEvent.click(screen.getByTestId("projects-archive-submit-p-real-1"));

    await waitFor(() => expect(archiveCalls.some((c) => c.path === "/projects/p-real-1/unarchive")).toBe(true));
  });

  it("有 reasonCode 的失败就地显示该码", async () => {
    archiveResponder = () => jsonResponse({ reasonCode: "ORG_ROLE_INSUFFICIENT" }, 403);

    const menu = await openMenu();
    fireEvent.click(within(menu).getByTestId("projects-more-p-real-1-archive"));
    fireEvent.click(screen.getByTestId("projects-archive-submit-p-real-1"));

    await waitFor(() => {
      expect(screen.getByTestId("projects-archive-error-p-real-1")).toHaveTextContent("ORG_ROLE_INSUFFICIENT");
    });
  });

  /**
   * P7 反证（KNOWN_CONTRACT_GAPS.P7 / issue #999）：「有进行中环节时拒绝归档」后端
   * 抛的是**裸 400、没有 reasonCode**。此时前端**只许说「操作失败」，不许编原因**。
   * 这条断言就是钉住「不编」——如果哪天有人顺手写上「因为有环节正在进行」，它会红。
   */
  it("无错误码的裸 400：只说操作失败，绝不编造原因", async () => {
    archiveResponder = () => jsonResponse({}, 400);

    const menu = await openMenu();
    fireEvent.click(within(menu).getByTestId("projects-more-p-real-1-archive"));
    fireEvent.click(screen.getByTestId("projects-archive-submit-p-real-1"));

    const err = await screen.findByTestId("projects-archive-error-p-real-1");
    expect(err).toHaveTextContent("操作失败");
    expect(err).toHaveTextContent("400");
    // 反证：不得出现任何「猜出来的原因」
    expect(err.textContent ?? "").not.toMatch(/环节|进行中|正在|收尾/);
  });
});
