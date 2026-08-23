import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

/**
 * #460 —— 正式 `/chat` 的会话新建 / 改名 / 删除接线。
 *
 * 三条纪律，每条都对应一句验收：
 *   ① 写入口的渲染依据只有服务端下发的 `thread.mutate`，不是前端按角色重算，
 *     也不是拿 `composer.send` 推断（契约要求「按钮不渲染 **且** 接口拒绝」两侧都验收）。
 *   ② 不做乐观更新：调用返回后**重新从服务端读列表**，界面反映数据库里真实发生的事。
 *   ③ 删除后的选中态从**服务端返回的列表**里解析，不沿用路由上那个已被删掉的 thread。
 */

const {
  replace, listThreads, getThread, getAgentPanel, listMessages, createMessage,
  createThread, renameThread, deleteThread, listThreadArtifacts, listThreadAttachments, landAsArtifact, sessionState,
} = vi.hoisted(() => ({
  replace: vi.fn(),
  listThreads: vi.fn(),
  getThread: vi.fn(),
  getAgentPanel: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  createThread: vi.fn(),
  renameThread: vi.fn(),
  deleteThread: vi.fn(),
  // 十项 UX 缺口第 4/5 项（#708）——本文件不测这两个端口，只需要默认解析值。
  listThreadArtifacts: vi.fn(),
  // issue #728 D9（人类 2026-08-21 裁决）——右栏「材料」，本文件同样不测，只需默认解析值。
  listThreadAttachments: vi.fn(),
  landAsArtifact: vi.fn(),
  sessionState: {
    sessionToken: "provider-bearer",
    currentOrgId: "org-current",
    userId: "user-current",
    orgIds: ["org-current"],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", session: sessionState, identity: null, error: null }),
}));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ left, right, children }: {
    left?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
  }) => <div><aside>{left}</aside><main>{children}</main><aside>{right}</aside></div>,
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()), // 保留 ATTACHMENT_* 常量 + uploadAttachment（#946 composer 附件）
  listThreads, getThread, getAgentPanel, listMessages, createMessage,
  createThread, renameThread, deleteThread, listThreadArtifacts, listThreadAttachments, landAsArtifact,
}));

import { ChatReadScreen } from "@/components/chat/chat-read-screen";

function card(id: string, title: string) {
  return {
    id, title, subtitle: "", badges: [], agentSummary: "agent-real",
    lastActivityAt: "2026-08-04T00:00:00.000Z", visibilityScope: "plenary",
  };
}

/**
 * #489：写权改由 **`listThreads.capabilities`**（项目级）下发，不再取自 `getThread`。
 * `list()` 默认带写权；要观察者视角就用 `listAs(OBSERVER, …)`。
 */
function list(...cards: ReturnType<typeof card>[]) {
  return listAs(WRITER, ...cards);
}

function listAs(capabilities: string[], ...cards: ReturnType<typeof card>[]) {
  return { groups: cards.length > 0 ? [{ label: "今天", cards }] : [], capabilities };
}

function detail(threadId: string, version: number, capabilities: string[]) {
  return {
    thread: {
      id: threadId, projectId: "project-real", groupId: null, visibilityScope: "plenary",
      phase: "research", archived: false, createdBy: "user-real",
      lastActivityAt: "2026-08-04T00:00:00.000Z", version,
    },
    messages: [],
    rightTabs: [
      { tab: "transcript", count: 0, failed: false },
      { tab: "execution", count: 0, failed: false },
      { tab: "insight", count: 0, failed: false },
      { tab: "artifact", count: 0, failed: false },
      { tab: "material", count: 0, failed: false },
    ],
    capabilities,
  };
}

const WRITER = ["thread.read", "composer.send", "thread.mutate"];
// 观察者：读能力齐全，写能力一个都没有。注意它连 composer.send 也没有——
// 正因为如此，「拿 composer.send 当写权代理」的坏实现今天也能通过，所以下面
// 还有一条专门把 composer.send 留下、只摘掉 thread.mutate 的用例。
const OBSERVER = ["thread.read", "artifact.readonly"];

function renderScreen(initialThreadId: string | null = "thread-a") {
  return render(<ChatReadScreen projectId="project-real" initialThreadId={initialThreadId} />);
}

describe("#460 会话增删改接入正式 /chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.sessionToken = "provider-bearer";
    listThreads.mockResolvedValue(list(card("thread-a", "线程 A"), card("thread-b", "线程 B")));
    getThread.mockResolvedValue(detail("thread-a", 3, WRITER));
    getAgentPanel.mockResolvedValue({ presentCount: 0, rosterCount: 0, agents: [] });
    listMessages.mockResolvedValue({ messages: [], nextCursor: null });
    listThreadArtifacts.mockResolvedValue({ items: [] });
    listThreadAttachments.mockResolvedValue({ items: [] });
  });

  it("服务端没下发 thread.mutate 时，写入口整块不渲染", async () => {
    listThreads.mockResolvedValue(listAs(OBSERVER, card("thread-a", "线程 A")));
    renderScreen();
    await screen.findByTestId("chat-read-thread-list");
    await waitFor(() => expect(getThread).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-thread-actions")).toBeNull();
    expect(screen.queryByTestId("chat-thread-create")).toBeNull();
  });

  // 反证保护：坏实现「有 composer.send 就给写入口」在这条用例下必须红。
  it("有 composer.send 但没有 thread.mutate 时，写入口仍然不渲染", async () => {
    listThreads.mockResolvedValue(listAs(["thread.read", "composer.send"], card("thread-a", "线程 A")));
    renderScreen();
    await waitFor(() => expect(listThreads).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-thread-actions")).toBeNull();
  });

  /* ── #489：这条是那条真实死路的回归护栏 ──────────────────────────────────
   * 症状：新注册的管理员进到一个**零会话**的项目，`getThread` 永远不会被调用，
   * 于是（在 #489 之前）前端拿不到任何写权依据，「新建」按钮不渲染，
   * 「注册 → 登录 → Chat 新增」死在第三步。
   * 断言必须落在「零会话」这个前提上——有会话时旧实现也能过。 */
  it("零会话的项目里仍然渲染「新建」，并且 getThread 一次都没被调用（#489）", async () => {
    listThreads.mockResolvedValue(listAs(WRITER));   // groups: []
    renderScreen(null);

    await screen.findByTestId("chat-thread-create");
    expect(screen.getByTestId("chat-thread-actions")).toBeTruthy();
    // 前提证明：这条路径上详情端口根本没被调用过，所以写权不可能来自它。
    expect(getThread).not.toHaveBeenCalled();
    // 空态是真实空态，不许凭空造示例会话。
    expect(screen.getByTestId("chat-thread-list-empty")).toBeTruthy();
  });

  it("零会话 + 观察者：写入口仍然不渲染（否则上一条会退化成「零会话就放行」）", async () => {
    listThreads.mockResolvedValue(listAs(OBSERVER));
    renderScreen(null);

    await screen.findByTestId("chat-thread-list-empty");
    expect(screen.queryByTestId("chat-thread-actions")).toBeNull();
    expect(screen.queryByTestId("chat-thread-create")).toBeNull();
  });

  it("新建走真实 API，并从服务端重读的列表里选中新会话", async () => {
    createThread.mockResolvedValue({ threadId: "thread-new", version: 0, auditEventId: "ae-1", impactScope: null });
    listThreads
      .mockResolvedValueOnce(list(card("thread-a", "线程 A")))
      .mockResolvedValueOnce(list(card("thread-a", "线程 A"), card("thread-new", "新会话")));

    renderScreen();
    fireEvent.click(await screen.findByTestId("chat-thread-create"));
    fireEvent.change(screen.getByTestId("chat-thread-title-input"), { target: { value: "新会话" } });
    fireEvent.click(screen.getByTestId("chat-thread-title-submit"));

    await waitFor(() => expect(createThread).toHaveBeenCalledWith({
      projectId: "project-real", groupId: null, title: "新会话", visibilityScope: "plenary",
    }));
    // 列表状态跟随后端返回，不是本地塞一条乐观数据。
    await screen.findByTestId("chat-thread-thread-new");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat?projectId=project-real&thread=thread-new"));
  });

  it("改名带上 getThread 给的 expectedVersion（并发靠它，不静默覆盖）", async () => {
    getThread.mockResolvedValue(detail("thread-a", 7, WRITER));
    renameThread.mockResolvedValue({ threadId: "thread-a", version: 8, auditEventId: "ae-2", impactScope: null });

    renderScreen();
    // 2026-08-14 重做：改名/删除现在挂在选中卡片自己的 hover「…」菜单里。
    fireEvent.pointerDown(await screen.findByTestId("chat-thread-card-menu-trigger"), { button: 0 });
    fireEvent.click(screen.getByTestId("chat-thread-rename"));
    fireEvent.change(screen.getByTestId("chat-thread-title-input"), { target: { value: "改过的名字" } });
    fireEvent.click(screen.getByTestId("chat-thread-title-submit"));

    // ⚠ 第二个实参是 `projectId`。#541 之前这里是 `null`，而后端 `mutateExisting`
    //   把 `projectId === null` 映射成**裸 404**（I-3：不可见与不存在同一个出口）——
    //   于是改名与删除在界面上从来没成功过，而这条测试当时是绿的：
    //   **它钉住的是那个坏调用形状本身**。断言里写死 "project-real" 就是为了
    //   让「又退回 null」这件事在这里当场变红。
    await waitFor(() =>
      expect(renameThread).toHaveBeenCalledWith("thread-a", "project-real", "改过的名字", 7));
  });

  it("删除要二次确认与原因，删完选中态回退到服务端剩下的第一条", async () => {
    deleteThread.mockResolvedValue({ threadId: "thread-a", version: 4, auditEventId: "ae-3", impactScope: "thread" });
    listThreads
      .mockResolvedValueOnce(list(card("thread-a", "线程 A"), card("thread-b", "线程 B")))
      .mockResolvedValueOnce(list(card("thread-b", "线程 B")));

    // 路由参数仍指向被删掉的 thread-a——不许据此把已删会话重新选回来。
    renderScreen("thread-a");
    fireEvent.pointerDown(await screen.findByTestId("chat-thread-card-menu-trigger"), { button: 0 });
    fireEvent.click(screen.getByTestId("chat-thread-delete"));
    expect(deleteThread).not.toHaveBeenCalled();      // 只点[删除]不算确认

    fireEvent.change(screen.getByTestId("chat-thread-delete-reason"), { target: { value: "重复会话" } });
    fireEvent.click(screen.getByTestId("chat-thread-delete-submit"));

    await waitFor(() =>
      expect(deleteThread).toHaveBeenCalledWith("thread-a", "project-real", 3, "重复会话"));
    await waitFor(() => expect(screen.queryByTestId("chat-thread-thread-a")).toBeNull());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat?projectId=project-real&thread=thread-b"));
  });

  it("服务端拒绝时回显真实 reasonCode，且不伪造成功", async () => {
    createThread.mockRejectedValue(new ApiError(403, "NO_WRITE_ROLE", "forbidden"));

    renderScreen();
    fireEvent.click(await screen.findByTestId("chat-thread-create"));
    fireEvent.change(screen.getByTestId("chat-thread-title-input"), { target: { value: "会被拒绝" } });
    fireEvent.click(screen.getByTestId("chat-thread-title-submit"));

    const error = await screen.findByTestId("chat-thread-mutate-error");
    expect(error.textContent).toContain("NO_WRITE_ROLE");
    // 被拒绝的标题绝不能出现在列表里。
    expect(screen.queryByText("会被拒绝")).toBeNull();
  });
});
