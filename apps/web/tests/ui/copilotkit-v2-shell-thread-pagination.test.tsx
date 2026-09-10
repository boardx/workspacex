/**
 * issue #3356 —— 左栏对话列表分页，**组件这一侧**。
 *
 * ## 这里判什么、不判什么
 *
 * **不判「界面上只显示了 30 条」**——那个断言前端截断 + 后端全量返回也能过，
 * 而用户要解决的问题（一次全拉）原封不动。所以首屏那一条判的是
 * **发出去的请求参数**（`listPersonalThreads` 收到的 `limit`/`cursor`），
 * 服务端那一侧「响应里真的只有 30 条」的判据在
 * `apps/api/tests/chat/personal-thread-list-pagination.test.ts`（真栈 + PostgreSQL）。
 *
 * 四条：
 *   ① 首屏请求带 `limit: 30`、**不带** cursor；
 *   ② 点「加载更多」⇒ 带**上一页返回的那个** cursor 再要一页，两页拼起来、不重复；
 *   ③ 服务端说没有下一页（`nextCursor: null`）⇒ 入口**消失**；
 *   ④ 搜索是**另起一次服务端查询**（`q` 发出去、回到第一页），不是在已加载的
 *      30 条里过滤——后者会让用户以为"搜不到 = 没有"。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { push, replace, listPersonalThreads, getThread, listThreadArtifacts, listThreadAttachments, listCapabilities, createPersonalThread, sessionState } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  listPersonalThreads: vi.fn(),
  getThread: vi.fn(),
  listThreadArtifacts: vi.fn(),
  listThreadAttachments: vi.fn(),
  listCapabilities: vi.fn(),
  createPersonalThread: vi.fn(),
  sessionState: {
    sessionToken: "pager-bearer",
    currentOrgId: "org-current",
    userId: "user-current",
    orgIds: ["org-current"],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", session: sessionState, identity: null, error: null }),
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listPersonalThreads, getThread, listThreadArtifacts, listThreadAttachments, createPersonalThread,
}));
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities }));
vi.mock("@/components/chat/copilotkit-v2-panel", () => ({
  CopilotKitV2Panel: () => <div data-testid="stub-copilotkit-v2-panel" />,
}));
vi.mock("@/components/chat/chat-roster-panel", () => ({ RosterPanel: () => null }));
vi.mock("@/components/chat/chat-task-inspector", () => ({ ChatTaskInspector: () => null }));
vi.mock("@/components/chat/chat-artifact-preview-dialog", () => ({ ChatArtifactPreviewDialog: () => null }));

import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";
import { THREAD_PAGE_SIZE } from "@/lib/chat-workbench/thread-pages";

const card = (id: string, title = id) => ({
  id, title, subtitle: "", badges: [], status: "done" as const, artifactCount: 0,
  lastActivityAt: "2026-09-01T00:00:00.000Z", visibilityScope: "private" as const, pinned: false,
});

const page = (label: string, ids: string[], nextCursor: string | null) => ({
  groups: [{ label, cards: ids.map((id) => card(id)) }],
  capabilities: ["thread.mutate"],
  nextCursor,
});

const PAGE_1_IDS = Array.from({ length: THREAD_PAGE_SIZE }, (_, i) => `t-${String(i).padStart(2, "0")}`);
const PAGE_2_IDS = Array.from({ length: 5 }, (_, i) => `t-${String(i + THREAD_PAGE_SIZE).padStart(2, "0")}`);

/** 当次请求发出去的分页参数——判据落在这里，不在 DOM 计数上。 */
const pageArgOf = (callIndex: number) => listPersonalThreads.mock.calls[callIndex]?.[0];

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  listCapabilities.mockReset();
  listCapabilities.mockResolvedValue([]);
  listThreadArtifacts.mockReset();
  listThreadArtifacts.mockResolvedValue({ items: [] });
  listThreadAttachments.mockReset();
  listThreadAttachments.mockResolvedValue({ items: [] });
  getThread.mockReset();
  getThread.mockResolvedValue({
    thread: { id: "t-00", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-09-01T00:00:00.000Z", version: 0 },
    messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
  });
  createPersonalThread.mockReset();
  listPersonalThreads.mockReset();
  listPersonalThreads.mockResolvedValue(page("今天", PAGE_1_IDS, "cursor-after-page-1"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CopilotKitV2Shell — issue #3356 对话列表分页", () => {
  it("① 首屏只要一页：请求带 limit=30、不带 cursor（判请求参数，不判 DOM 条数）", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalled());
    const first = pageArgOf(0);
    expect(first.limit).toBe(THREAD_PAGE_SIZE);
    expect(first.cursor ?? null).toBeNull();
    // 会红的形状：有人把 limit 去掉「让服务端自己决定」——那样这一层就没有任何
    // 判据说得清首屏要了多少，服务端默认值一改，前端的行为跟着悄悄变。
    expect(first.limit).not.toBeUndefined();
  });

  it("② 点「加载更多」：带上一页的 cursor 再要一页，两页拼起来且不重复", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    expect(await screen.findByText("t-00")).toBeVisible();
    expect(screen.queryByText("t-30")).toBeNull(); // 第二页此刻还没来

    listPersonalThreads.mockResolvedValueOnce(page("今天", PAGE_2_IDS, null));
    fireEvent.click(await screen.findByTestId("chat-thread-list-load-more"));

    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalledTimes(2));
    // 关键：cursor 是**服务端上一页给的那个**，不是前端自己算的 offset。
    expect(pageArgOf(1).cursor).toBe("cursor-after-page-1");
    expect(pageArgOf(1).limit).toBe(THREAD_PAGE_SIZE);

    expect(await screen.findByText("t-30")).toBeVisible();
    // 不丢：第一页的第一条还在。不重复：每个 id 在 DOM 里只出现一次。
    expect(screen.getByText("t-00")).toBeVisible();
    for (const id of [...PAGE_1_IDS, ...PAGE_2_IDS]) {
      expect(screen.getAllByText(id)).toHaveLength(1);
    }
    // 组头也不重复（两页同属「今天」）。
    expect(screen.getAllByText("今天")).toHaveLength(1);
  });

  it("③ 服务端说没有下一页 ⇒ 入口消失，不是点了没反应", async () => {
    listPersonalThreads.mockResolvedValue(page("今天", PAGE_1_IDS, null));
    render(<CopilotKitV2Shell initialThreadId={null} />);
    expect(await screen.findByText("t-00")).toBeVisible();
    expect(screen.queryByTestId("chat-thread-list-load-more")).toBeNull();
  });

  it("③b 翻到最后一页之后，入口从有变成没有", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    const more = await screen.findByTestId("chat-thread-list-load-more");
    listPersonalThreads.mockResolvedValueOnce(page("今天", PAGE_2_IDS, null));
    fireEvent.click(more);
    await waitFor(() => expect(screen.queryByTestId("chat-thread-list-load-more")).toBeNull());
  });

  it("④ 搜索另起一次服务端查询（q 发出去 + 回到第一页），不是在已加载的 30 条里过滤", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    expect(await screen.findByText("t-00")).toBeVisible();

    // 搜一个**首屏里没有**的标题：如果搜索只在已加载的一页里过滤，这次永远搜不到。
    listPersonalThreads.mockResolvedValue(page("更早", ["t-99"], null));
    fireEvent.change(screen.getByTestId("chat-task-workbench-thread-search"), { target: { value: "预算复盘" } });

    await waitFor(() => expect(listPersonalThreads.mock.calls.some((c) => c[0]?.q === "预算复盘")).toBe(true), { timeout: 3000 });
    const searchCall = listPersonalThreads.mock.calls.find((c) => c[0]?.q === "预算复盘")![0];
    // 搜索从第一页重新开始——不能带着上一次浏览的游标去搜。
    expect(searchCall.cursor ?? null).toBeNull();
    expect(await screen.findByText("t-99")).toBeVisible();
  });

  it("④b 搜不到时说的是「全部对话里都没有」，不是「你还没有对话」", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    expect(await screen.findByText("t-00")).toBeVisible();

    listPersonalThreads.mockResolvedValue({ groups: [], capabilities: ["thread.mutate"], nextCursor: null });
    fireEvent.change(screen.getByTestId("chat-task-workbench-thread-search"), { target: { value: "查无此题" } });

    const empty = await screen.findByTestId("chat-task-workbench-thread-search-empty", {}, { timeout: 3000 });
    expect(empty.textContent).toContain("查无此题");
    // 会红的形状：空响应掉进「还没有对话，点上面『新建对话』」那一档——对一个
    // 有 187 条历史对话的用户说"你还没有对话"。
    expect(screen.queryByText(/还没有对话，点上面/)).toBeNull();
  });
});
