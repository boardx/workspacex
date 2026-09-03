import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * F06 —— `/tasks` 我的今天，真实数据路径（`TodayBoardLive`）。
 *
 * 断言：`tasks-today-summary` / `tasks-risk-badge` / `tasks-owner-line` /
 * `tasks-executor-badge` / `tasks-waiting-on` / `tasks-summary-low-sample-demo` /
 * `tasks-summary-coefficient-note` 这七个 F06 notes 点名的 testid 在真实渲染
 * （mock 掉网络请求，但组件本身真实渲染，不是读 mock 数据文件）的 DOM 上都能找到；
 * 四个分区（含空分区）都渲染；样本不足时不显示编造的折算值。
 */

const { getMyToday, listProjects, changeTaskStatus, createTask } = vi.hoisted(() => ({
  getMyToday: vi.fn(),
  listProjects: vi.fn().mockResolvedValue([{ id: "p-1", name: "项目一", kind: "workshop", status: "active", readOnlyReason: null, tags: [] }]),
  changeTaskStatus: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    status: "authenticated",
    session: { sessionToken: "tok", userId: "u-me", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  }),
}));

vi.mock("@/lib/live-projects", () => ({ listProjects }));
vi.mock("@/lib/live-tasks", () => ({ getMyToday, listTasks: vi.fn(), changeTaskStatus, createTask }));

import { TodayBoardLive } from "@/components/tasks/today-board-live";

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1", title: "验证德国工商储电价机制核查报告", status: "review", sourceKind: "手工创建",
    ownerUserId: "u-me", executor: null, dueAt: null, riskLevel: "R2", waitingOn: null,
    syncStatus: "synced", projectId: "p-1",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listProjects.mockResolvedValue([{ id: "p-1", name: "项目一", kind: "workshop", status: "active", readOnlyReason: null, tags: [] }]);
});

describe("F06 我的今天真实数据路径：四分区骨架 + 关键 testid", () => {
  it("四个分区都渲染，含空分区；关键 testid 齐全（风险徽标/owner/executor/waiting-on/底注）", async () => {
    getMyToday.mockResolvedValue({
      sections: {
        awaiting_my_judgment: [card()],
        my_push_today: [],
        ai_running_for_me: [card({ id: "c-2", status: "in_progress", executor: { kind: "agent", id: "agent:scout" }, riskLevel: null })],
        waiting_on_others: [card({ id: "c-3", status: "done", waitingOn: "周宁", riskLevel: null })],
      },
      summary: { sampleSufficient: false, aiCompletedCount: 0, label: "样本不足", waitingAuthzCount: 0, waitingAuthzKnown: false },
    });

    render(<TodayBoardLive />);

    await waitFor(() => expect(screen.getByTestId("tasks-live-board")).toBeInTheDocument());

    // 四个分区骨架，即使某一区是空的也要渲染（D-29 硬约束）。
    expect(screen.getByTestId("tasks-live-section-awaiting_my_judgment")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-live-section-my_push_today")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-live-section-empty-my_push_today")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-live-section-ai_running_for_me")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-live-section-waiting_on_others")).toBeInTheDocument();

    // F06 notes 点名的关键 testid。
    expect(screen.getAllByTestId("tasks-risk-badge").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("tasks-owner-line").length).toBeGreaterThan(0);
    expect(screen.getByTestId("tasks-executor-badge")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-waiting-on")).toHaveTextContent("周宁");
    expect(screen.getByTestId("tasks-today-summary")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-summary-low-sample-demo")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-summary-coefficient-note")).toBeInTheDocument();
  });

  it("样本不足时不显示编造的折算值 —— 只显示『样本不足』，没有 personHours 数字", async () => {
    getMyToday.mockResolvedValue({
      sections: { awaiting_my_judgment: [], my_push_today: [], ai_running_for_me: [], waiting_on_others: [] },
      summary: { sampleSufficient: false, aiCompletedCount: 2, label: "样本不足", waitingAuthzCount: 0, waitingAuthzKnown: false },
    });

    render(<TodayBoardLive />);
    await waitFor(() => expect(screen.getByTestId("tasks-today-summary")).toBeInTheDocument());

    const lowSample = screen.getByTestId("tasks-summary-low-sample-demo");
    expect(lowSample).toHaveTextContent("样本不足");
    // The label may honestly SAY "not converting" ("暂不折算人时") -- what must never appear
    // is an actual converted NUMBER (e.g. "折算 6.5 人时"), which is what `tasks-summary-value`
    // (the sampleSufficient:true branch) would render instead.
    expect(lowSample.textContent).not.toMatch(/折算\s*[\d.]+\s*人时/);
    expect(screen.queryByTestId("tasks-summary-value")).not.toBeInTheDocument();
  });

  it("全部四区皆空时仍渲染四个分区骨架（整屏不因为没数据就消失）", async () => {
    getMyToday.mockResolvedValue({
      sections: { awaiting_my_judgment: [], my_push_today: [], ai_running_for_me: [], waiting_on_others: [] },
      summary: { sampleSufficient: false, aiCompletedCount: 0, label: "样本不足", waitingAuthzCount: 0, waitingAuthzKnown: false },
    });

    render(<TodayBoardLive />);
    await waitFor(() => expect(screen.getByTestId("tasks-live-board")).toBeInTheDocument());

    for (const key of ["awaiting_my_judgment", "my_push_today", "ai_running_for_me", "waiting_on_others"]) {
      expect(screen.getByTestId(`tasks-live-section-${key}`)).toBeInTheDocument();
      expect(screen.getByTestId(`tasks-live-section-empty-${key}`)).toBeInTheDocument();
    }
  });

});
