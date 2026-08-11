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
 * ## ✅ #513 已补上读侧版本号（本文件随之改）
 *
 * `getAgentPanel.out` 现在下发 `rosterVersion`（🟡 该契约面**待人类补签**，见
 * `packages/contracts/src/chat.ts` 里 `getAgentPanel` 的文件头）。⇒ 前端**不再**维护
 * 本地版本号：`expectedRosterVersion` 直接取自最近一次 `getAgentPanel` 的响应，
 * 每次改动后重读服务端，版本号跟着推进。**只有一个事实源。**
 *
 * ⛔ 读不到版本号（面板还没回来 / 读失败）时**不提交** —— 不传 0、不传 -1、不省略。
 *   下面「面板还没读回来时不提交」那条钉的就是它：兜底等于把乐观锁摘了。
 *
 * ## ⚠ 一个仍然存在的已知契约缺口（**报上来了，没有自己发明**）
 *
 * · **没有 `roster.mutate` 这个能力**。`CHAT_WRITE_CAPABILITIES`
 *   （`apps/api/src/domain/chat/thread-visibility.ts:276`）里只有六个，没有编制那一档。
 *   服务端对编制的判定是 `role !== null && role !== "observer"`
 *   （`application/chat/update-agent-roster.ts` 的 `NO_WRITE_ROLE` 分支），
 *   与 `thread.mutate` **同一个谓词**，所以这里用 `thread.mutate` 当渲染依据。
 *   它是**同源代理**，不是前端新造的判断；服务端仍是权威（API 测试断言 403）。
 *
 * 并发冲突（409）**如实报错，不静默重试**——静默重试正是「部分成功即整体拒绝」
 * 要防的东西。#513 修的是「读不到版本号」，不是「让写永远成功」。
 */

const {
  replace, listThreads, getThread, getAgentPanel, listMessages, createMessage,
  createThread, renameThread, deleteThread, updateAgentRoster, listCapabilities,
  listThreadArtifacts, landAsArtifact, sessionState,
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
  listCapabilities: vi.fn(),
  // 十项 UX 缺口第 4/5 项（#708）——本文件不测这两个端口，只需要它们有默认解析值，
  // 不然 `chat-read-screen.tsx` 顶层的 `Promise.allSettled` 会产生未处理的 rejection。
  listThreadArtifacts: vi.fn(),
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
vi.mock("@/lib/live-chat", () => ({
  listThreads, getThread, getAgentPanel, listMessages, createMessage,
  createThread, renameThread, deleteThread, updateAgentRoster,
  listThreadArtifacts, landAsArtifact,
}));
// #619：加入表单的候选来自这个真实读端口（`GET /capabilities?kind=agent`），
// 不再是自由文本框——每条用例要选的 id 必须先出现在这份候选列表里，
// 否则 `<select>` 里根本没有那个 `<option>`，同真实浏览器行为一致。
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities }));

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

/**
 * #513：读端口现在下发 `rosterVersion`，所以 fixture 也要带它。
 * 默认给一个**非 0** 的值——若给 0，一个「读不到就用 0 兜底」的坏实现会跟着变绿，
 * 这条 fixture 本身就是反空转的一部分。
 */
function panel(agentIds: string[], rosterVersion = 5) {
  return {
    agents: agentIds.map((id) => ({
      id, abbr: id.slice(0, 2).toUpperCase(), name: `名字 ${id}`, duty: "职责", presence: "off" as const,
    })),
    presentCount: 0,
    rosterCount: agentIds.length,
    marketEntry: null,
    rosterVersion,
  };
}

/**
 * 打开编制编辑器。
 *
 * #728 D2 起「加入 agent」的输入框收在左栏编制栏头的「编辑」后面（照原型：编制区常态
 * 只显示谁在场，编辑是一个显式动作）。此前它常驻在右栏，等于永远挂着一个裸 agent id
 * 输入框 —— 正是 #594 人类要求消灭的形态。
 *
 * ⚠ 这个 helper**不放宽任何断言**：写入口该不该渲染仍由 `thread.mutate` 决定，
 *   没有写权时「编辑」按钮本身就不存在，getByTestId 会如实红。
 */
function openRosterEditor() {
  fireEvent.click(screen.getByTestId("chat-roster-edit"));
}

/**
 * #619：`GET /capabilities?kind=agent` 的候选 fixture。真实 `CapabilityListing`
 * 形状（`packages/contracts/src/identity.ts`），每条用例要选的 id 必须先在这里。
 *
 * ⚠ 与 #728 D2 叠加而不是二选一：编制编辑器**打开之后**里面那个字段才是选择器。
 *   「藏在编辑动作后面」（#728）与「不是裸文本框」（#619）是两件事，都要成立。
 */
function agentListing(id: string) {
  return {
    id, orgId: "org-current", kind: "agent" as const, name: `目录 ${id}`, scope: "org-wide" as const,
    enabled: true, endpoint: null, abbr: id.slice(0, 2).toUpperCase(), duty: "目录职责", disabledReason: null,
  };
}

const ALL_TEST_CANDIDATES = [
  "agent-new", "a1", "a2", "agent-x", "agent-alien",
].map(agentListing);

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
    listThreadArtifacts.mockResolvedValue({ items: [] });
    updateAgentRoster.mockResolvedValue({ rosterVersion: 1, agents: [], auditEventId: "prov-1" });
    listCapabilities.mockResolvedValue(ALL_TEST_CANDIDATES);
  });

  it("加一个 agent：打真实端口，并在返回后重读服务端编制（不做乐观更新）", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-edit");
    openRosterEditor();
    await waitFor(() => expect(getAgentPanel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("chat-roster-add-input")).toContainHTML("agent-new"));

    // 加完之后服务端会回一份含该 agent 的编制——界面必须显示**重读到的**那份。
    getAgentPanel.mockResolvedValue(panel(["agent-new"]));

    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "agent-new" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    await waitFor(() => expect(updateAgentRoster).toHaveBeenCalledTimes(1));
    // #513：版本号取自读端口那份响应（fixture 里是 5），**不是**本地 0 起步。
    expect(updateAgentRoster).toHaveBeenCalledWith(
      "thread-a",
      "project-real",
      { add: ["agent-new"], remove: [], expectedRosterVersion: 5 },
      "provider-bearer",
    );

    // ① 的落点：重读发生过，且界面上的行来自重读的响应。
    await waitFor(() => expect(getAgentPanel).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("chat-roster-agent-agent-new")).toBeTruthy();
  });

  it("#787 —— 编制写入口展示诚实提示：候选来自目录，不代表一定可执行", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-edit");
    openRosterEditor();
    const hint = await screen.findByTestId("chat-roster-add-hint");
    expect(hint.textContent).toContain("不代表该 agent 已具备可执行的运行时");
  });

  it("去掉一个 agent：remove 里是它，add 为空，并重读服务端", async () => {
    getAgentPanel.mockResolvedValue(panel(["agent-old"], 5));
    renderScreen();
    await screen.findByTestId("chat-roster-remove-agent-old");

    getAgentPanel.mockResolvedValue(panel([], 6));
    fireEvent.click(screen.getByTestId("chat-roster-remove-agent-old"));

    await waitFor(() => expect(updateAgentRoster).toHaveBeenCalledTimes(1));
    expect(updateAgentRoster).toHaveBeenCalledWith(
      "thread-a",
      "project-real",
      { add: [], remove: ["agent-old"], expectedRosterVersion: 5 },
      "provider-bearer",
    );
    await waitFor(() => expect(screen.queryByTestId("chat-roster-agent-agent-old")).toBeNull());
  });

  /**
   * #513：版本号只有**一个**事实源 = 读端口。这条用两个**不同**的数字把它钉死：
   * 写端口回一个诱饵 `999`，重读回来的是 `6`。第二次提交必须带 `6`。
   * 带 `999` ⇒ 实现在信写端口的回声；带 `5` ⇒ 实现没重读；带 `0` ⇒ 实现在兜底。
   * 三种坏法各自对应一个不同的数字，绿了才说明走的是那条对的路。
   */
  it("连续两次改动：第二次带上**重读到**的版本号，不是写端口的回声、也不是 0", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-edit");
    openRosterEditor();
    await waitFor(() => expect(getAgentPanel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("chat-roster-add-input")).toContainHTML("a1"));

    updateAgentRoster.mockResolvedValue({ rosterVersion: 999, agents: [], auditEventId: "p1" });
    getAgentPanel.mockResolvedValue(panel([], 6));

    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "a1" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));
    await waitFor(() => expect(updateAgentRoster).toHaveBeenCalledTimes(1));
    expect(updateAgentRoster.mock.calls[0]![2]).toEqual({
      add: ["a1"], remove: [], expectedRosterVersion: 5,
    });
    // 重读发生过——没有它，下面那条断言测的就不是「重读到的版本号」。
    await waitFor(() => expect(getAgentPanel).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "a2" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));
    await waitFor(() => expect(updateAgentRoster).toHaveBeenCalledTimes(2));

    expect(updateAgentRoster.mock.calls[1]![2]).toEqual({
      add: ["a2"], remove: [], expectedRosterVersion: 6,
    });
  });

  /**
   * ⛔ 兜底禁令的落点：面板读失败 ⇒ 版本号未知 ⇒ **一个请求都不发**。
   * 「读不到就传 0」的实现在这条下会红（它会发出去一次）。
   */
  it("面板读失败（版本号未知）：不提交编制变更，不用 0 兜底", async () => {
    getAgentPanel.mockRejectedValue(new ApiError(503, "AGENT_REGISTRY_UNAVAILABLE", null));
    renderScreen();

    await waitFor(() => expect(getAgentPanel).toHaveBeenCalled());
    await screen.findByTestId("chat-roster-edit");
    openRosterEditor();
    await waitFor(() => expect(screen.getByTestId("chat-roster-add-input")).toContainHTML("agent-x"));

    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "agent-x" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    await waitFor(() => expect(getAgentPanel).toHaveBeenCalled());
    expect(updateAgentRoster).not.toHaveBeenCalled();
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
    await screen.findByTestId("chat-roster-edit");
    openRosterEditor();
    await waitFor(() => expect(screen.getByTestId("chat-roster-add-input")).toContainHTML("agent-alien"));

    updateAgentRoster.mockRejectedValue(new ApiError(422, "AGENT_OUT_OF_SCOPE", null));
    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "agent-alien" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    expect(await screen.findByTestId("chat-roster-mutate-error")).toHaveTextContent("AGENT_OUT_OF_SCOPE");
    expect(screen.queryByTestId("chat-roster-agent-agent-alien")).toBeNull();
  });

  it("并发冲突（409 VERSION_CHANGED）如实报错，不静默重试", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-edit");
    openRosterEditor();
    await waitFor(() => expect(screen.getByTestId("chat-roster-add-input")).toContainHTML("agent-x"));

    updateAgentRoster.mockRejectedValue(new ApiError(409, "VERSION_CHANGED", null));
    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "agent-x" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    expect(await screen.findByTestId("chat-roster-mutate-error")).toHaveTextContent("VERSION_CHANGED");
    // 「不静默重试」的落点：只发了一次，没有偷偷换个版本号再来一遍。
    expect(updateAgentRoster).toHaveBeenCalledTimes(1);
  });

  // #619：选择器把「空输入」变成「没选中任何候选（占位选项）」——提交按钮本身
  // 也因此禁用（`draft === ""`），这条钉的是「没选就点提交也不发请求」这个兜底，
  // 不再是「打了空白字符串」（select 天然不存在这种状态）。
  it("没选中任何候选就提交：不发请求", async () => {
    renderScreen();
    await screen.findByTestId("chat-roster-edit");
    openRosterEditor();

    fireEvent.change(screen.getByTestId("chat-roster-add-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("chat-roster-add-submit"));

    await waitFor(() => expect(getAgentPanel).toHaveBeenCalled());
    expect(updateAgentRoster).not.toHaveBeenCalled();
  });

  it("目录读取失败：候选区显示错误，写入口仍在但没有候选可选", async () => {
    listCapabilities.mockRejectedValue(new ApiError(503, "CAPABILITY_CATALOG_UNAVAILABLE", null));
    renderScreen();
    // #728 D2：写入口折在「编辑」后面，先点开才有候选区可看。
    // ⚠ 这条断言的重点没变：目录读失败时**写入口仍在**（只是没有候选可选），
    //   而不是整个编制编辑器消失——所以这里断言的是 add-input 存在 + 错误文案出现。
    await screen.findByTestId("chat-roster-edit");
    openRosterEditor();
    await screen.findByTestId("chat-roster-add-input");

    expect(await screen.findByTestId("chat-roster-candidates-error")).toHaveTextContent(
      "CAPABILITY_CATALOG_UNAVAILABLE",
    );
    expect(updateAgentRoster).not.toHaveBeenCalled();
  });
});
