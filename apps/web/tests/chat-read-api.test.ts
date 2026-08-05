import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessage, getAgentPanel, getThread, listMessages, listThreads } from "@/lib/live-chat";

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
      if (url.pathname.endsWith("/messages") && init.method === "POST") {
        return Response.json({
          message: {
            id: "message-new",
            authorKind: "human",
            authorId: "user-real",
            agentId: null,
            text: "persist this",
            clientMessageId: "00000000-0000-4000-8000-000000000001",
            agentRunId: null,
            replyToMessageId: null,
            createdAt: "2026-08-04T00:00:00.000Z",
          },
          agentRunId: "run-new",
          runStatus: "queued",
        }, { status: 202 });
      }
      if (url.pathname.endsWith("/messages")) {
        return Response.json({ messages: [], nextCursor: "cursor-next" });
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
    await listMessages("thread-real", { cursor: "cursor-current", limit: 50 }, "bearer-real");
    await createMessage("thread-real", {
      clientMessageId: "00000000-0000-4000-8000-000000000001",
      text: "persist this",
      agentId: "agent-published",
    }, "bearer-real");

    expect(calls.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
      "/chat/projects/project-real/threads",
      "/chat/threads/thread-real?projectId=project-real",
      "/chat/threads/thread-real/agents?projectId=project-real",
      "/chat/threads/thread-real/messages?cursor=cursor-current&limit=50",
      "/chat/threads/thread-real/messages",
    ]);
    expect(calls.every(({ init }) => (
      init.headers as Record<string, string>
    ).Authorization === "Bearer bearer-real")).toBe(true);
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({
      clientMessageId: "00000000-0000-4000-8000-000000000001",
      text: "persist this",
      agentId: "agent-published",
    });
  });
});
