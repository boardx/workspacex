/**
 * #467（roster 半边）—— `lib/live-chat.ts` 的 `updateAgentRoster` 薄封装。
 *
 * ## 为什么这条封装此前不存在
 *
 * 后端 `POST /chat/threads/:threadId/agents` 从 F110 起就是真的（`PgChatRepository`
 * → `chat_thread_agents` + `chat_threads.roster_version`），但 `lib/live-chat.ts`
 * 头部把它列进「未封装」清单，前端零调用。本文件钉住封装的形状。
 *
 * ## 两条形状断言各防一种漂移
 *
 * · **路径从契约推导**，不手抄字符串——手抄的那份不会随契约改动一起变。
 * · **`projectId` 走 query、其余走 body**：控制器把 `projectId` 读作
 *   `@Query`（`apps/api/src/interface/controllers/chat.controller.ts:590`），
 *   而 body 过 `UPDATE_AGENT_ROSTER_SCHEMA`（同文件 :166）= 契约 `.strict()`。
 *   把 `projectId` 塞进 body 会被 strict 拒；漏掉 `threadId` 同样被拒。
 *   这条断言是「实测过的请求形状」，不是推测。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { chat } from "@repo/contracts";
import { updateAgentRoster } from "@/lib/live-chat";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROSTER_OK = {
  rosterVersion: 4,
  agents: [
    { id: "agent-a", abbr: "AA", name: "Agent A", duty: "研究", roleLabel: "研究员", presence: "off" as const },
  ],
  auditEventId: "prov-1",
};

describe("#467 updateAgentRoster 薄封装", () => {
  it("打契约推导出的真实端点，projectId 走 query、编制变更走 body", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: new URL(typeof input === "string" ? input : input.toString()), init });
      return Response.json(ROSTER_OK);
    }));

    const out = await updateAgentRoster(
      "thread-real",
      "project-real",
      { add: ["agent-a"], remove: [], expectedRosterVersion: 3 },
      "bearer-real",
    );

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.init.method).toBe("POST");
    expect(call!.url.pathname).toBe("/chat/threads/thread-real/agents");
    expect(call!.url.searchParams.get("projectId")).toBe("project-real");
    expect(new Headers(call!.init.headers).get("Authorization")).toBe("Bearer bearer-real");

    // body 必须逐字满足契约 `.strict()`——多一个键（例如 projectId）服务端就拒。
    const body: unknown = JSON.parse(String(call!.init.body));
    expect(body).toEqual({
      threadId: "thread-real",
      add: ["agent-a"],
      remove: [],
      expectedRosterVersion: 3,
    });
    const parsedIn = chat.operations.updateAgentRoster.in.safeParse(body);
    expect(parsedIn.success, JSON.stringify(parsedIn)).toBe(true);

    // 出参也过一次 strict：封装不得把服务端响应改形状再交给界面。
    const parsedOut = chat.operations.updateAgentRoster.out.safeParse(out);
    expect(parsedOut.success, JSON.stringify(parsedOut)).toBe(true);
    expect(out.rosterVersion).toBe(4);
  });

  it("线程 id 经过 encodeURIComponent，不手工拼接路径", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      seen.push(new URL(typeof input === "string" ? input : input.toString()).pathname);
      return Response.json(ROSTER_OK);
    }));

    await updateAgentRoster("thread/with slash", "p", { add: [], remove: ["x"], expectedRosterVersion: 0 });

    expect(seen[0]).toBe("/chat/threads/thread%2Fwith%20slash/agents");
  });
});
