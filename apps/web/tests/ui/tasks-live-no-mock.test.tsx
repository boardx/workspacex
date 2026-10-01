/**
 * 生产 `/tasks` 不许出现 mock，也不许把裸 HTTP 状态码端上屏。
 *
 * 实测（真实栈、dev-mode lead 登录）：`/tasks` 在真实空态旁边同时画出 mock 顶栏人物
 * 「林 · 远洋新能源 顾问」、mock 运行中心与「高 签字确认」卡片，外加一行「HTTP 403」。
 * 根因两条：① 页面用 `mockIdentity` 画壳层、用 `lib/mock/tasks` 画左右栏；
 * ② 「我的今天」取 `listProjects()[0]` 当角色锚点——lead 的列表含「管理但未加入」的项目
 * 与 `general` 容器，看板角色判定只认工作坊成员身份，于是稳定 403 `NO_PROJECT_ROLE`。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
  redirect: vi.fn(),
}));

const listProjects = vi.fn();
const getMyToday = vi.fn();
vi.mock("@/lib/live-projects", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-projects")>()),
  listProjects: (...a: unknown[]) => listProjects(...a),
}));
vi.mock("@/lib/live-tasks", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-tasks")>()),
  getMyToday: (...a: unknown[]) => getMyToday(...a),
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", session: { currentOrgId: "org-1", userId: "u-1" } }),
  useOptionalSession: () => ({ status: "authenticated", session: { currentOrgId: "org-1", userId: "u-1" } }),
}));
/** 壳层自身另有测试；这里只关心页面交给壳层的东西——尤其是不能再交一个 mock 身份。 */
const shellProps = vi.fn();
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: (props: { identity?: unknown; left?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) => {
    shellProps(props);
    return <div data-testid="shell">{props.left}{props.children}{props.right}</div>;
  },
}));

import TasksPage from "@/app/tasks/page";
import { TodayBoardLive } from "@/components/tasks/today-board-live";

afterEach(() => { cleanup(); listProjects.mockReset(); getMyToday.mockReset(); shellProps.mockReset(); });

const EMPTY_TODAY = {
  sections: { awaiting_my_judgment: [], my_push_today: [], ai_running_for_me: [], waiting_on_others: [] },
  summary: { sampleSufficient: false, aiCompletedCount: 0, label: "样本不足", waitingAuthzCount: 0, waitingAuthzKnown: false },
} as const;

const MOCK_MARKERS = [/林/, /远洋新能源/, /签字确认/, /顾问/, /运行中心/, /本周清单/];

function expectNoMockOrRawHttp(text: string) {
  for (const m of MOCK_MARKERS) expect(text).not.toMatch(m);
  expect(text).not.toMatch(/HTTP\s*\d{3}/i);
  expect(text).not.toMatch(/http_\d{3}/i);
  expect(text).not.toMatch(/NO_PROJECT_ROLE|OBSERVER_CANNOT_VIEW_BOARD/);
}

describe("生产 /tasks：只有真实数据", () => {
  it("实时数据为空时，页面不渲染任何 mock 人物/运行/卡片，也不给壳层传 mock 身份", async () => {
    listProjects.mockResolvedValue([{ id: "p-1", name: "项目一", kind: "workshop", tags: [] }]);
    getMyToday.mockResolvedValue(EMPTY_TODAY);
    render(<TasksPage searchParams={{}} />);
    await screen.findByTestId("tasks-live-section-empty-awaiting_my_judgment");
    const props = shellProps.mock.calls.at(-1)?.[0] as { identity?: unknown; left?: unknown; right?: unknown };
    expect(props.identity).toBeUndefined();
    expect(props.left).toBeUndefined();
    expect(props.right).toBeUndefined();
    expect(screen.queryByTestId("tasks-run-center")).toBeNull();
    expect(screen.queryByTestId("tasks-week-list")).toBeNull();
    expectNoMockOrRawHttp(document.body.textContent ?? "");
  });

  it("跳过没有看板角色的项目（403）与 general 容器，落到第一个能读的工作坊项目", async () => {
    listProjects.mockResolvedValue([
      { id: "g-1", name: "通用", kind: "general", tags: [] },
      { id: "w-managed", name: "管理但未加入", kind: "workshop", tags: [] },
      { id: "w-member", name: "我加入的", kind: "workshop", tags: [] },
    ]);
    getMyToday.mockImplementation(async (pid: string) => {
      if (pid === "w-member") return EMPTY_TODAY;
      throw new ApiError(403, "NO_PROJECT_ROLE", { reasonCode: "NO_PROJECT_ROLE" });
    });
    render(<TodayBoardLive />);
    await screen.findByTestId("tasks-live-section-empty-awaiting_my_judgment");
    expect(getMyToday.mock.calls.map((c) => c[0])).toEqual(["w-managed", "w-member"]);
    expect(screen.queryByTestId("tasks-live-error")).toBeNull();
    expectNoMockOrRawHttp(document.body.textContent ?? "");
  });

  it("一个看板都进不去时给空态说明，不给报错行，也不出现裸 403", async () => {
    listProjects.mockResolvedValue([{ id: "w-managed", name: "管理但未加入", kind: "workshop", tags: [] }]);
    getMyToday.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", { reasonCode: "NO_PROJECT_ROLE" }));
    render(<TodayBoardLive />);
    const title = await screen.findByTestId("tasks-live-no-project-title");
    expect(title.textContent).toContain("还没有可用的工作坊任务看板");
    expect(screen.queryByTestId("tasks-live-error")).toBeNull();
    expectNoMockOrRawHttp(document.body.textContent ?? "");
  });

  it("其它失败说人话，不端出 HTTP 状态码或内部码", async () => {
    listProjects.mockResolvedValue([{ id: "w-1", name: "项目", kind: "workshop", tags: [] }]);
    getMyToday.mockRejectedValue(new ApiError(500, null, undefined));
    render(<TodayBoardLive />);
    const err = await screen.findByTestId("tasks-live-error");
    expect(err.textContent?.trim().length).toBeGreaterThan(0);
    expectNoMockOrRawHttp(document.body.textContent ?? "");
  });
});

describe("/studio/research 不再对真实用户渲染 mock", () => {
  it("重定向到现行研究 Studio /research", async () => {
    const nav = await import("next/navigation");
    const { default: Page } = await import("@/app/studio/research/page");
    Page();
    await waitFor(() => expect(nav.redirect).toHaveBeenCalledWith("/research"));
  });
});
