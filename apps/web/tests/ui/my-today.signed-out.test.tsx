import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * F06 -- `TodayBoardLive` signed-out branch, isolated in its own file so its
 * `session-provider` mock does not collide with `my-today.render.test.tsx`'s
 * authenticated one (vitest hoists `vi.mock` per file, not per test).
 */
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "anonymous", session: null }),
}));
vi.mock("@/lib/live-projects", () => ({ listProjects: vi.fn() }));
vi.mock("@/lib/live-tasks", () => ({ getMyToday: vi.fn(), listTasks: vi.fn(), changeTaskStatus: vi.fn(), createTask: vi.fn() }));

import { TodayBoardLive } from "@/components/tasks/today-board-live";

afterEach(() => cleanup());

describe("F06 我的今天：未登录不渲染真实数据面板", () => {
  it("显示登录提示，不渲染任何分区或编造的数据", () => {
    render(<TodayBoardLive />);
    expect(screen.getByTestId("tasks-live-signed-out")).toBeInTheDocument();
    expect(screen.queryByTestId("tasks-live-board")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tasks-today-summary")).not.toBeInTheDocument();
  });
});
