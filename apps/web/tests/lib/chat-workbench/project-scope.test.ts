import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/live-chat", () => ({ createPersonalThread: vi.fn(), createThread: vi.fn(), listPersonalThreads: vi.fn(), listThreads: vi.fn() }));
import { createPersonalThread, createThread, listThreads } from "@/lib/live-chat";
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
    listWorkbenchThreads("p", "token", signal);
    expect(listThreads).toHaveBeenCalledWith("p", {}, "token", signal);
  });
});
