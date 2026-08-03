import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentPanel, getThread, listThreads } from "@/lib/live-chat";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Wave 1 chat read API", () => {
  it("uses the selected project and the provider bearer for every read", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      calls.push({ url, init });
      if (url.pathname.endsWith("/threads")) {
        return Response.json({ groups: [] });
      }
      if (url.pathname.endsWith("/agents")) {
        return Response.json({ agents: [], presentCount: 0, rosterCount: 0, marketEntry: null });
      }
      return Response.json({
        thread: {
          id: "thread-real",
          projectId: "project-real",
          groupId: null,
          visibilityScope: "plenary",
          phase: "research",
          archived: false,
          createdBy: "user-real",
          lastActivityAt: "2026-08-04T00:00:00.000Z",
          version: 1,
        },
        messages: [],
        rightTabs: [],
        capabilities: [],
      });
    }));

    await listThreads("project-real", {}, "bearer-real");
    await getThread("thread-real", "project-real", "bearer-real");
    await getAgentPanel("thread-real", "project-real", "bearer-real");

    expect(calls.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
      "/chat/projects/project-real/threads",
      "/chat/threads/thread-real?projectId=project-real",
      "/chat/threads/thread-real/agents?projectId=project-real",
    ]);
    expect(calls.every(({ init }) => (
      init.headers as Record<string, string>
    ).Authorization === "Bearer bearer-real")).toBe(true);
  });
});
