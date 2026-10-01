/**
 * 首页数据 hook（Refs #4698）：不对「我没有项目角色」的项目发必然 403 的请求。
 * 这是 fullstack-smoke（project-create-smoke 逐条核对所有 403）在 CI 里抓到的回归。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({
  listPersonalThreads: vi.fn(), listProjects: vi.fn(), getHomeProjectPreviews: vi.fn(),
  listGuidedResearchSessions: vi.fn(), listMyDigitalInterviews: vi.fn(), surveyRequest: vi.fn(), getMyToday: vi.fn(),
}));
vi.mock("@/lib/live-chat", () => ({ listPersonalThreads: m.listPersonalThreads }));
vi.mock("@/lib/live-projects", () => ({ listProjects: m.listProjects }));
vi.mock("@/lib/live-home-project-previews", () => ({ getHomeProjectPreviews: m.getHomeProjectPreviews }));
vi.mock("@/lib/live-guided-research-api", () => ({ listGuidedResearchSessions: m.listGuidedResearchSessions }));
vi.mock("@/lib/live-interviews", () => ({ listMyDigitalInterviews: m.listMyDigitalInterviews }));
vi.mock("@/lib/survey/runtime-client", () => ({ surveyRequest: m.surveyRequest }));
vi.mock("@/lib/live-tasks", () => ({ getMyToday: m.getMyToday }));
// 若实现里还去撞成员接口，这两个会被调用——本文件断言它们从未被调用。
const memberProbe = vi.hoisted(() => ({ listProjectMembers: vi.fn(), listNonWorkshopMembers: vi.fn() }));
vi.mock("@/lib/live-project-members", () => ({ listProjectMembers: memberProbe.listProjectMembers }));
vi.mock("@/lib/live-project-collaborators", () => ({ listNonWorkshopMembers: memberProbe.listNonWorkshopMembers }));

import { useHomeTasks, useHomeWork } from "@/components/home/use-home-work";

const P = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `项目${id}`, kind: "workshop", status: "active", readOnlyReason: null, tags: [], ...over });
const today = { sections: { awaiting_my_judgment: [{ id: "k1", title: "确认提纲", dueAt: null }], my_push_today: [], ai_running_for_me: [], waiting_on_others: [] }, summary: {} };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  memberProbe.listProjectMembers.mockReset();
  memberProbe.listNonWorkshopMembers.mockReset();
  m.listPersonalThreads.mockResolvedValue({ groups: [] });
  m.listGuidedResearchSessions.mockResolvedValue({ items: [] });
  m.listMyDigitalInterviews.mockResolvedValue({ items: [] });
  m.surveyRequest.mockResolvedValue([]);
  m.getMyToday.mockResolvedValue(today);
});

function run(enabled = true) {
  return renderHook(() => {
    const work = useHomeWork("o1", enabled);
    const tasks = useHomeTasks(work.projects, enabled);
    return { work, tasks };
  });
}

describe("首页数据不撞必然的 403", () => {
  it("协作者来自聚合接口；从不逐个项目调成员接口", async () => {
    m.listProjects.mockResolvedValue([P("p1"), P("p2", { kind: "general" })]);
    m.getHomeProjectPreviews.mockResolvedValue({ items: [{ projectId: "p2", members: [{ userId: "u1", displayName: "张伟" }] }] });
    const { result } = run();
    await waitFor(() => expect(result.current.work.projects.status).toBe("ready"));
    const items = (result.current.work.projects as { items: Array<{ id: string; collaborators: unknown }> }).items;
    expect(items.find((p) => p.id === "p1")!.collaborators).toBeNull();
    expect(items.find((p) => p.id === "p2")!.collaborators).toEqual([{ userId: "u1", displayName: "张伟" }]);
    expect(memberProbe.listProjectMembers).not.toHaveBeenCalled();
    expect(memberProbe.listNonWorkshopMembers).not.toHaveBeenCalled();
  });

  it("任务锚点取「我是成员」的第一个项目，而不是列表第一项（那可能只是我管理的）", async () => {
    m.listProjects.mockResolvedValue([P("managed-only"), P("mine")]);
    m.getHomeProjectPreviews.mockResolvedValue({ items: [{ projectId: "mine", members: [] }] });
    const { result } = run();
    await waitFor(() => expect(result.current.tasks.status).toBe("ready"));
    expect(m.getMyToday).toHaveBeenCalledTimes(1);
    expect(m.getMyToday).toHaveBeenCalledWith("mine");
    expect((result.current.tasks as unknown as { items: { mine: unknown[] } }).items.mine).toHaveLength(1);
  });

  it("我不是任何项目的成员：不请求任务（否则必然 403），如实为空", async () => {
    m.listProjects.mockResolvedValue([P("a"), P("b")]);
    m.getHomeProjectPreviews.mockResolvedValue({ items: [] });
    const { result } = run();
    await waitFor(() => expect(result.current.tasks.status).toBe("ready"));
    expect(m.getMyToday).not.toHaveBeenCalled();
    expect((result.current.tasks as { items: unknown }).items).toBeNull();
  });

  it("聚合接口失败：项目卡照常显示（无协作者），不把项目整组标成错误；也不去请求任务", async () => {
    m.listProjects.mockResolvedValue([P("a")]);
    m.getHomeProjectPreviews.mockRejectedValue(new Error("boom"));
    const { result } = run();
    await waitFor(() => expect(result.current.work.projects.status).toBe("ready"));
    expect((result.current.work.projects as { items: Array<{ collaborators: unknown }> }).items[0]!.collaborators).toBeNull();
    await waitFor(() => expect(result.current.tasks.status).toBe("ready"));
    expect(m.getMyToday).not.toHaveBeenCalled();
  });

  it("两个板块都关：什么都不请求", async () => {
    run(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(m.listProjects).not.toHaveBeenCalled();
    expect(m.getHomeProjectPreviews).not.toHaveBeenCalled();
    expect(m.getMyToday).not.toHaveBeenCalled();
  });
});
