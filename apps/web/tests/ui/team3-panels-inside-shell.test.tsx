/**
 * team3 的研判面板必须渲染在**对话列内部**，不是壳的兄弟节点。
 *
 * ## 这条测试为什么存在
 *
 * 2026-09-15 devapp 真机截图：阶段条与「添加材料」横在整个应用之上，
 * 侧边栏被挤到下半屏。根因是 `CopilotKitV2Shell` **自己就渲染整套布局**
 * （`<aside>` 侧边栏 + 对话列），它是"一整个屏"而不是一个内容块；
 * 把面板放成它的兄弟，就等于放到了应用外面。
 *
 * 此前 114 条前端测试全绿，**因为没有一条把面板和壳一起渲染过**——
 * 每个组件都单独测得好好的，拼起来是坏的。这正是组件级测试的盲区：
 * 它测部件，不测装配。
 *
 * 所以这里断言的是**装配关系**：面板必须是侧边栏的兄弟之后、对话列之内。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * 壳的真实实现依赖一整套 provider 与网络，单测里起不来。
 * 但本测试关心的**只有装配位置**，所以替身保留壳的真实骨架：
 * 侧边栏 + 对话列，且 `conversationHeader` 渲染在对话列里——
 * 与 `copilotkit-v2-shell.tsx` 里那段 JSX 同构。
 */
vi.mock("@/components/chat/copilotkit-v2-shell", () => ({
  CopilotKitV2Shell: ({ conversationHeader }: { conversationHeader?: React.ReactNode }) => (
    <div data-testid="shell-root">
      <aside data-testid="copilotkit-v2-thread-sidebar">侧边栏</aside>
      <div data-testid="shell-conversation-column">
        <div data-testid="copilotkit-v2-thread-topbar">标题条</div>
        {conversationHeader}
      </div>
    </div>
  ),
}));

/** 记录选择 provider 每次挂载时拿到的初值——这是本次修复的要害。 */
const selectionInitialAgentIds: (string | null | undefined)[] = [];
vi.mock("@/lib/copilotkit-v2-agent-selection", () => ({
  CopilotKitV2AgentSelectionProvider: ({
    children,
    initialAgentId,
  }: {
    children: React.ReactNode;
    initialAgentId?: string | null;
  }) => {
    selectionInitialAgentIds.push(initialAgentId);
    return <>{children}</>;
  },
}));
vi.mock("@/app/chat/copilotkit-v2/copilotkit-v2-providers", () => ({
  CopilotKitV2Providers: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-1" } }),
}));
vi.mock("@/lib/live-capabilities", () => ({
  listCapabilities: async () => [{ id: "a1", name: "前沿赛道技术路线研判", enabled: true }],
}));
vi.mock("@/lib/live-chat", async () => {
  // 只替换 team3 会用到的四个端口，其余原样透传——整块替换会让别处 import 的
  // 常量（如附件白名单）凭空消失，那是替身自己制造的故障，不是被测代码的。
  const actual = await vi.importActual<typeof import("@/lib/live-chat")>("@/lib/live-chat");
  return {
    ...actual,
    listPersonalThreads: async () => ({ groups: [{ cards: [{ id: "t1", title: "前沿赛道技术路线研判" }] }] }),
    createPersonalThread: async () => ({ threadId: "t1" }),
    getAgentPanel: async () => ({ rosterVersion: 1 }),
    updateAgentRoster: async () => undefined,
  };
});
vi.mock("@/lib/live-research-workflow", async () => {
  const actual = await vi.importActual<typeof import("@/lib/live-research-workflow")>(
    "@/lib/live-research-workflow",
  );
  return {
    ...actual,
    getResearchSession: async () => ({
      threadId: "t1",
      phase: "collecting",
      lineage: { materialBatchId: null, fieldSchemeVersion: 0, logicVersion: 0, publishedGraphVersion: 0 },
      materials: [],
      verifyDueAt: null,
      updatedAt: "2026-09-16T00:00:00.000Z",
    }),
    getResearchPredictions: async () => [],
    getResearchAudit: async () => [],
  };
});

const { Team3Chat, Team3ChatScreen } = await import("@/components/agent/team3-chat");

const RESOLVED = { threadId: "t1", agentId: "a1" } as const;

afterEach(cleanup);

describe("面板的装配位置", () => {
  it("面板在对话列内部，而不是壳的外面", async () => {
    render(<Team3Chat resolved={RESOLVED} />);
    const panels = await screen.findByTestId("team3-panels");

    const column = screen.getByTestId("shell-conversation-column");
    expect(column.contains(panels), "面板不在对话列里——它会横在整个应用之上").toBe(true);
  });

  it("面板不是侧边栏的祖先或兄弟之前（那正是真机上看到的错位）", async () => {
    render(<Team3Chat resolved={RESOLVED} />);
    const panels = await screen.findByTestId("team3-panels");
    const sidebar = screen.getByTestId("copilotkit-v2-thread-sidebar");

    expect(panels.contains(sidebar)).toBe(false);
    // 侧边栏必须在面板**之前**出现在文档里（同级左栏），不是被挤到面板下方
    expect(
      sidebar.compareDocumentPosition(panels) & Node.DOCUMENT_POSITION_FOLLOWING,
      "侧边栏没有排在面板之前——布局又回到了真机上那个错位",
    ).toBeTruthy();
  });

  it("阶段条确实在那组面板里（装配对了，内容也得在）", async () => {
    render(<Team3Chat resolved={RESOLVED} />);
    const panels = await screen.findByTestId("team3-panels");
    expect(panels.querySelector('[data-testid="research-phase-bar"]')).not.toBeNull();
  });
});

/**
 * 2026-09-15 第二个真机缺陷：Agent 被挂进线程 roster，却从没被**选中**。
 *
 * 「挂进 roster」决定的是"这条线程编制里有谁"，**不决定"这次请求用哪个 agent"**。
 * 不把 agentId 交给选择 provider，请求就不带 `COPILOTKIT_V2_SELECTED_AGENT_HEADER`，
 * 服务端落到 org 动态默认（通用助手）——本 Agent 的 instructions 一行都进不了
 * system prompt，用户问什么都由通用助手回答。
 *
 * 前 210 条前端测试全绿，因为没有一条断言过"这个 agent 真的被选中了"。
 */
describe("Agent 真的被选中", () => {
  it("解析出的 agentId 被交给选择 provider 作为初值", async () => {
    render(<Team3ChatScreen />);
    await screen.findByTestId("shell-root");
    expect(selectionInitialAgentIds.at(-1), "没把 agentId 交给选择 provider").toBe("a1");
  });

  it("解析完成之前不挂 provider（headers 有构造时定死的时序竞争，见 providers 头注）", () => {
    selectionInitialAgentIds.length = 0;
    render(<Team3ChatScreen />);
    // 首帧还在解析：加载态在、provider 尚未挂载
    expect(screen.getByTestId("team3-chat-loading")).toBeInTheDocument();
    expect(selectionInitialAgentIds).toEqual([]);
  });
});
