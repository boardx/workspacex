import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

/**
 * #467（roster 半边）—— 正式 `/chat` 的「在这个会话里加 / 去掉一个 agent」接线。
 *
 * ## 范围诚实
 *
 * 本文件验的是**编制关系**（`chat_thread_agents` 的增删），**不是** agent 真的执行
 * 并产生回复（那是 #414 + #413）。`capability-catalog-screen.tsx` 那句自陈
 * 「出现在目录中不代表已经具备可执行的 AgentRun 或 Skill 运行时」在本文件全绿之后
 * **依然成立**。
 *
 * ## 三条纪律，与 #460 同一套
 *
 * ① **不做乐观更新**：`updateAgentRoster` 返回后**重新调 `getAgentPanel` 读服务端**，
 *   界面反映数据库里真实发生的事。乐观更新会在服务端拒绝时先给一个假的成功画面。
 * ② **写入口只认服务端下发的能力标记**，不在前端按角色重算。
 * ③ 服务端拒绝时**不吞错**：把 reasonCode 如实显示出来。
 *
 * ## ⚠ 两个已知契约缺口（**报上来了，没有自己发明**）
 *
 * · **没有 `roster.mutate` 这个能力**。`CHAT_WRITE_CAPABILITIES`
 *   （`apps/api/src/domain/chat/thread-visibility.ts:276`）里只有六个，没有编制那一档。
 *   服务端对编制的判定是 `role !== null && role !== "observer"`
 *   （`application/chat/update-agent-roster.ts` 的 `NO_WRITE_ROLE` 分支），
 *   与 `thread.mutate` **同一个谓词**，所以这里用 `thread.mutate` 当渲染依据。
 *   它是**同源代理**，不是前端新造的判断；服务端仍是权威（API 测试断言 403）。
 * · **没有任何读端口下发 `rosterVersion`**。`getAgentPanel.out`（契约 :477）里没有它，
 *   全契约只有 `updateAgentRoster.out` 有（`packages/contracts/src/chat.ts:509`）。
 *   ⇒ 前端只能从 `chat_threads.roster_version` 的 DDL 默认值 0 起步、再用每次响应
 *   返回的版本号推进。并发冲突（409）**如实报错，不静默重试**——静默重试正是
 *   「部分成功即整体拒绝」要防的东西。
 */

const {
  replace, listThreads, getThread, getAgentPanel, listMessages, createMessage,
  createThread, renameThread, deleteThread, updateAgentRoster, sessionState,
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
  updateAgentRoster: vi.fn(),
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
vi.mock("@/lib/live-chat", () => ({
  listThreads, getThread, getAgentPanel, listMessages, createMessage,
  createThread, renameThread, deleteThread, updateAgentRoster,
}));

import { ChatReadScreen } from "@/components/chat/chat-read-screen";

const WRITER = ["thread.read", "composer.send", "thread.mutate"];
const OBSERVER = ["thread.read", "artifact.readonly"];

function card(id: string, title: string) {
  return {
    id, title, subtitle: "", badges: [], agentSummary: "agent-real",
    lastActivityAt: "2026-08-04T00:00:00.000Z", visibilityScope: "plenary",
  };
}

function list(capabilities: string[]) {
  return { groups: [{ label: "今天", cards: [card("thread-a", "线程 A")] }], capabilities };
}

function detail(capabilities: string[]) {
  return {
    thread: {
      id: "thread-a", projectId: "project-real", groupId: null, visibilityScope: "plenary",
      phase: "research", archived: false, createdBy: "user-real",
      lastActivityAt: "2026-08-04T00:00:00.000Z", version: 3,
    },
    messages: [],
    rightTabs: [],
    capabilities,
  };
}

function panel(agentIds: string[]) {
  return {
    agents: agentIds.map((id) => ({
      id, abbr: id.slice(0, 2).toUpperCase(), name: `名字 ${id}`, duty: "职责", presence: "off" as const,
    })),
    presentCount: 0,
    rosterCount: agentIds.length,
    marketEntry: null,
  };
}

function renderScreen() {
  return render(<ChatReadScreen projectId="project-real" initialThreadId="thread-a" />);
}

describe("#467 会话内 agent 编制的增删接线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.sessionToken = "provider-bearer";
    listThreads.mockResolvedValue(list(WRITER));
    getThread.mockResolvedValue(detail(WRITER));
    getAgentPanel.mockResolvedValue(panel([]));
    listMessages.mockResolvedValue({ messages: [], nextCursor: null });
    updateAgentRoster.mockResolvedValue({ rosterVersion: 1, agents: [], auditEventId: "prov-1" });
  });

  it("加一个 agent：打真实端口，并在返回后重读服务端编制（不做乐观更新）", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-add-input");
    await waitFor(() => expect(getAgentPanel).toHaveBeenCalledTimes(1));

    // 加完之后服务端会回一份含该 agent 的编制——界面必须显示**重读到的**那份。
    getAgentPanel.mockResolvedValue(panel(["agent-new"]));

    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "agent-new" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    await waitFor(() => expect(updateAgentRoster).toHaveBeenCalledTimes(1));
    expect(updateAgentRoster).toHaveBeenCalledWith(
      "thread-a",
      "project-real",
      { add: ["agent-new"], remove: [], expectedRosterVersion: 0 },
      "provider-bearer",
    );

    // ① 的落点：重读发生过，且界面上的行来自重读的响应。
    await waitFor(() => expect(getAgentPanel).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("chat-roster-agent-agent-new")).toBeTruthy();
  });

  it("去掉一个 agent：remove 里是它，add 为空，并重读服务端", async () => {
    getAgentPanel.mockResolvedValue(panel(["agent-old"]));
    renderScreen();
    await screen.findByTestId("chat-roster-remove-agent-old");

    getAgentPanel.mockResolvedValue(panel([]));
    fireEvent.click(screen.getByTestId("chat-roster-remove-agent-old"));

    await waitFor(() => expect(updateAgentRoster).toHaveBeenCalledTimes(1));
    expect(updateAgentRoster).toHaveBeenCalledWith(
      "thread-a",
      "project-real",
      { add: [], remove: ["agent-old"], expectedRosterVersion: 0 },
      "provider-bearer",
    );
    await waitFor(() => expect(screen.queryByTestId("chat-roster-agent-agent-old")).toBeNull());
  });

  it("连续两次改动：第二次带上服务端返回的新版本号，不是又发一次 0", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-add-input");

    updateAgentRoster.mockResolvedValue({ rosterVersion: 7, agents: [], auditEventId: "p1" });
    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "a1" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));
    await waitFor(() => expect(updateAgentRoster).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "a2" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));
    await waitFor(() => expect(updateAgentRoster).toHaveBeenCalledTimes(2));

    expect(updateAgentRoster.mock.calls[1]![2]).toEqual({
      add: ["a2"], remove: [], expectedRosterVersion: 7,
    });
  });

  it("服务端没下发 thread.mutate：编制写入口整块不渲染，只读那份仍在", async () => {
    listThreads.mockResolvedValue(list(OBSERVER));
    getThread.mockResolvedValue(detail(OBSERVER));
    getAgentPanel.mockResolvedValue(panel(["agent-old"]));
    renderScreen();

    await screen.findByTestId("chat-roster-agent-agent-old");
    expect(screen.queryByTestId("chat-roster-add-input")).toBeNull();
    expect(screen.queryByTestId("chat-roster-add-submit")).toBeNull();
    expect(screen.queryByTestId("chat-roster-remove-agent-old")).toBeNull();
  });

  // 反空转：坏实现「有 composer.send 就给写入口」在这条下必须红。
  it("有 composer.send 但没有 thread.mutate：编制写入口仍然不渲染", async () => {
    const caps = ["thread.read", "composer.send"];
    listThreads.mockResolvedValue(list(caps));
    getThread.mockResolvedValue(detail(caps));
    renderScreen();

    await waitFor(() => expect(listThreads).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-roster-add-input")).toBeNull();
  });

  it("服务端拒绝时如实显示 reasonCode，且不把 agent 画进编制里", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-add-input");

    updateAgentRoster.mockRejectedValue(new ApiError(422, "AGENT_OUT_OF_SCOPE", null));
    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "agent-alien" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    expect(await screen.findByTestId("chat-roster-mutate-error")).toHaveTextContent("AGENT_OUT_OF_SCOPE");
    expect(screen.queryByTestId("chat-roster-agent-agent-alien")).toBeNull();
  });

  it("并发冲突（409 VERSION_CHANGED）如实报错，不静默重试", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-add-input");

    updateAgentRoster.mockRejectedValue(new ApiError(409, "VERSION_CHANGED", null));
    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "agent-x" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    expect(await screen.findByTestId("chat-roster-mutate-error")).toHaveTextContent("VERSION_CHANGED");
    // 「不静默重试」的落点：只发了一次，没有偷偷换个版本号再来一遍。
    expect(updateAgentRoster).toHaveBeenCalledTimes(1);
  });

  it("空输入不发请求", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-add-input");

    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    await waitFor(() => expect(getAgentPanel).toHaveBeenCalled());
    expect(updateAgentRoster).not.toHaveBeenCalled();
  });
});
