/**
 * 「我的今天」在没有项目时不能是一片空白（#3872 R10）。
 *
 * 实测真实安装版：这一屏只有标题、一句页面说明和一个「新建任务」按钮——
 * 既不是加载中，也不是报错，就是什么都没有，看起来像加载失败了。
 * 根因是 `pid === null` 时 `setData(null); return;` 静默返回。
 *
 * **而本地版的新用户必然是零项目**（装完就没有项目），所以这一屏是每个新用户
 * 都会撞上的第一印象。这是十大缺陷里第 3 条「永远在加载/空白」的变体。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
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
  // 组件读的是 `useSession()` 的 `{ status, session }`——两个字段都要给。
  useSession: () => ({ status: "authenticated", session: { currentOrgId: "org-1", userId: "u-1" } }),
  useOptionalSession: () => ({ status: "authenticated", session: { currentOrgId: "org-1", userId: "u-1" } }),
}));

import { TodayBoardLive } from "@/components/tasks/today-board-live";

afterEach(() => { cleanup(); listProjects.mockReset(); getMyToday.mockReset(); });

/** 分区键名取自组件里的 `SECTION_META`，不是我编的——编错了会抛「not iterable」。 */
const EMPTY_SECTIONS = {
  awaiting_my_judgment: [], my_push_today: [], ai_running_for_me: [], waiting_on_others: [],
} as const;

/** `summary` 是页脚无条件读的（`data.summary.sampleSufficient`），少给会抛 undefined。 */
const EMPTY_TODAY = {
  sections: EMPTY_SECTIONS,
  summary: { sampleSufficient: false, aiCompletedCount: 0, label: "样本不足", waitingAuthzCount: 0, waitingAuthzKnown: false },
} as const;

describe("我的今天：一个项目都没有时", () => {
  it("说清为什么这里是空的，而不是留一片空白", async () => {
    listProjects.mockResolvedValue([]);
    render(<TodayBoardLive />);
    const box = await screen.findByTestId("tasks-live-no-project");
    expect(box.textContent).toContain("还没有项目");
    expect(box.textContent).toMatch(/汇总/);          // 解释这一屏的内容从哪来
  });

  it("给两条出路，其中一条不需要先建项目", async () => {
    listProjects.mockResolvedValue([]);
    render(<TodayBoardLive />);
    await screen.findByTestId("tasks-live-no-project");
    expect(screen.getByTestId("tasks-live-no-project-projects").closest("a")?.getAttribute("href")).toBe("/projects");
    expect(screen.getByTestId("tasks-live-no-project-chat").closest("a")?.getAttribute("href")).toBe("/chat");
  });

  it("有项目时不画这一段——那时候该看到的是分区", async () => {
    listProjects.mockResolvedValue([{ id: "p-1", name: "项目一", tags: [] }]);
    getMyToday.mockResolvedValue(EMPTY_TODAY);
    render(<TodayBoardLive />);
    await waitFor(() => expect(getMyToday).toHaveBeenCalled());
    expect(screen.queryByTestId("tasks-live-no-project")).toBeNull();
  });

  it("**「没有项目」与「有项目但没任务」要分开说**", async () => {
    listProjects.mockResolvedValue([{ id: "p-1", name: "项目一", tags: [] }]);
    getMyToday.mockResolvedValue(EMPTY_TODAY);
    render(<TodayBoardLive />);
    // 有项目没任务时走的是分区自己的「没有等你的事」——两种空态说的不是一件事，
    // 所以这里要求后者**在场**，而不只是前者不在场（只断不在场的判据，在
    // `noProject` 条件被删掉时仍然能过，反证 B 实测）。
    await screen.findByTestId("tasks-live-section-empty-awaiting_my_judgment");
    expect(screen.queryByTestId("tasks-live-no-project")).toBeNull();
  });
});
