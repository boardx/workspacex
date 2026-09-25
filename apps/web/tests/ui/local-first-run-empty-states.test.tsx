/**
 * 空状态要分清「你还没有」和「筛掉了」（#3872 R1）。
 *
 * 实测安装版时，项目页第一眼是两个字：「空列表」。它同时被用在两种处境上，
 * 而这两种处境下用户该做的事完全相反：一个要去建，一个要去清筛选。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));

const listProjects = vi.fn();
vi.mock("@/lib/live-projects", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-projects")>()),
  listProjects: (...a: unknown[]) => listProjects(...a),
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-1" } }),
  useOptionalSession: () => ({ session: { currentOrgId: "org-1" } }),
}));

import { ProjectsScreen } from "@/components/projects/projects-screen";

afterEach(() => { cleanup(); listProjects.mockReset(); });

const proj = (name: string, tags: string[] = []) => ({
  id: `p-${name}`, name, tags, updatedAt: "2026-09-23T00:00:00Z", stage: null, summary: null,
});

describe("项目页空状态", () => {
  it("一个项目都没有时，说的是产品的话并给出下一步——不是「空列表」", async () => {
    listProjects.mockResolvedValue([]);
    render(<ProjectsScreen />);
    const box = await screen.findByTestId("projects-list-empty");
    expect(box.textContent).not.toContain("空列表");
    expect(box.textContent).toContain("还没有项目");
    expect(box.textContent).toMatch(/对话/);          // 给一条不建项目也能走的路
    expect(screen.queryByTestId("projects-empty-clear-filters")).toBeNull();
  });

  it("有项目但被搜索筛光时，说的是另一句话，并给「清除筛选条件」", async () => {
    listProjects.mockResolvedValue([proj("阿尔法"), proj("贝塔")]);
    render(<ProjectsScreen />);
    await screen.findByTestId("projects-list");
    fireEvent.change(screen.getByTestId("projects-search"), { target: { value: "不存在的名字" } });
    const box = await screen.findByTestId("projects-list-empty");
    expect(box.textContent).toContain("筛选");
    expect(box.textContent).toContain("2 个项目");     // 告诉他东西还在
    expect(screen.getByTestId("projects-empty-clear-filters")).toBeTruthy();
  });

  it("点「清除筛选条件」真的把列表放回来", async () => {
    listProjects.mockResolvedValue([proj("阿尔法")]);
    render(<ProjectsScreen />);
    await screen.findByTestId("projects-list");
    fireEvent.change(screen.getByTestId("projects-search"), { target: { value: "zzz" } });
    fireEvent.click(await screen.findByTestId("projects-empty-clear-filters"));
    await waitFor(() => expect(screen.getByTestId("projects-list")).toBeTruthy());
  });
});
