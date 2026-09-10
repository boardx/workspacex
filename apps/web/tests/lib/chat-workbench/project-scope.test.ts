import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/live-chat", () => ({ createPersonalThread: vi.fn(), createThread: vi.fn(), listPersonalThreads: vi.fn(), listThreads: vi.fn() }));
import { createPersonalThread, createThread, listPersonalThreads, listThreads } from "@/lib/live-chat";
import { createWorkbenchThread, listWorkbenchThreads, workbenchThreadPath } from "@/lib/chat-workbench/project-scope";
describe("workbench project scope", () => {
  it("retains project on new and existing thread navigation", () => {
    expect(workbenchThreadPath("a/b", "project x")).toBe("/chat/a%2Fb?projectId=project%20x");
    expect(workbenchThreadPath(null, "p")).toBe("/chat?projectId=p");
    expect(workbenchThreadPath("a", null)).toBe("/chat/a");
  });
  it("creates private project threads and uses the project list with cancellation", () => {
    createWorkbenchThread("p");
    expect(createThread).toHaveBeenCalledWith({ projectId: "p", groupId: null, title: "新对话", visibilityScope: "private" });
    createWorkbenchThread(null);
    expect(createPersonalThread).toHaveBeenCalledWith(null);
    const signal = new AbortController().signal;
    vi.mocked(listThreads).mockResolvedValue({ groups: [], capabilities: [] } as never);
    listWorkbenchThreads("p", "token", signal);
    expect(listThreads).toHaveBeenCalledWith("p", {}, "token", signal);
  });

  /**
   * issue #3356 —— 分页参数只走个人对话那条链路，且**调用方只有一种形状**要处理。
   */
  it("个人对话：limit/cursor/q 原样透传给 listPersonalThreads", () => {
    vi.mocked(listPersonalThreads).mockResolvedValue({ groups: [], capabilities: [], nextCursor: null } as never);
    listWorkbenchThreads(null, "token", undefined, { limit: 30, cursor: "c1", q: "预算" });
    expect(listPersonalThreads).toHaveBeenCalledWith({ limit: 30, cursor: "c1", q: "预算" }, "token", undefined);
  });

  /**
   * 项目对话这条链路**没有**分页（`listThreads` 契约里没有 cursor）。它的返回被补上
   * `nextCursor: null`——「没有下一页」，于是「加载更多」按钮天然不渲染。
   * ⚠ 这一条会红的场景：有人图省事把 `nextCursor` 补成 `undefined` 或者干脆不补。
   *   `hasMorePages` 判的是"是不是一个非空字符串"，`undefined` 同样不渲染按钮，
   *   但那是靠下游宽容，不是靠这里说清楚——契约上的"没有下一页"就是 `null`。
   */
  it("项目对话：出参补 nextCursor:null，调用方不需要 if (projectId) 特例", async () => {
    vi.mocked(listThreads).mockResolvedValue({ groups: [], capabilities: ["thread.mutate"] } as never);
    const out = await listWorkbenchThreads("p", "token", undefined, { limit: 30, cursor: "c1" });
    expect(out.nextCursor).toBeNull();
    // 分页参数**不**发给项目端口（契约里没有这几个参数）。
    expect(listThreads).toHaveBeenLastCalledWith("p", {}, "token", undefined);
  });
});
