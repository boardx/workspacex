import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AgentDirectory } from "@/components/agent/agent-directory";
import { AgentDirectoryWorkspace } from "@/components/agent/agent-directory-workspace";
import AgentDirectoryPage from "@/app/agent/page";
import { agentTaskExamples, directoryWorkflowStatus } from "@/lib/agent-directory-tasks";
import type { AgentDirectoryCard } from "@/lib/agent-directory";

const mocks = vi.hoisted(() => ({
  org: "org-a", user: "user-a", token: "token-a", role: "admin",
  list: vi.fn(), offer: vi.fn(), enable: vi.fn(), upgrade: vi.fn(), push: vi.fn(),
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    status: "authenticated",
    session: { currentOrgId: mocks.org, userId: mocks.user, sessionToken: mocks.token },
    identity: { orgRole: mocks.role },
  }),
}));
vi.mock("@/lib/agent-directory", async (original) => ({
  ...await original<typeof import("@/lib/agent-directory")>(),
  listAgentDirectory: mocks.list,
  getOfficialRolePackOffer: mocks.offer,
  enableOfficialRolePack: mocks.enable,
  upgradeOfficialRoleSelections: mocks.upgrade,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function role(agentId = "product-a", name = "产品经理"): AgentDirectoryCard {
  return {
    agentId, versionId: agentId + "-v1", name, initials: name[0]!, roleLabel: "Product Manager",
    avatar: { kind: "illustration", key: "dh-03-product-manager", alt: name },
    roleCategory: "product", tags: ["产品"], catalogSource: "official",
    workflows: [{ stableId: "W029", name: "Problem to PRD" }], readiness: "ready",
  };
}
function offer(canEnable = true) {
  return {
    packId: "official-role-pack", packVersion: "1.7.0", canEnable, requiredSkillPacks: [],
    pending: [{
      roleRef: "D003", name: "Product Manager", roleLabel: "产品经理",
      avatar: { kind: "illustration", key: "dh-03-product-manager", alt: "产品经理" },
      roleCategory: "product", tags: ["产品"], workflowAllowlist: ["W029"],
    }],
    upgrades: [],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.org = "org-a"; mocks.user = "user-a"; mocks.token = "token-a"; mocks.role = "admin";
  mocks.list.mockReset().mockResolvedValue([role()]);
  mocks.offer.mockReset().mockResolvedValue(offer());
  mocks.enable.mockReset().mockResolvedValue(undefined);
  mocks.upgrade.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe("selected role-card directory", () => {
  it("separates conversation from unconfirmed workflow evidence, retaining actual avatar and flow names", async () => {
    render(<AgentDirectory fetchDirectory={mocks.list} onStartChat={vi.fn()} />);
    const card = await screen.findByTestId("agent-card-product-a");
    expect(within(card).getByTestId("agent-card-conversation-status")).toHaveTextContent("对话可用");
    expect(within(card).getByTestId("agent-card-readiness")).toHaveTextContent("流程待确认");
    expect(within(card).getByTestId("agent-card-workflows")).toHaveTextContent("关联流程：问题定义到 PRD");
    expect(within(card).getByTestId("agent-card-avatar")).toHaveAttribute("data-avatar-key", "dh-03-product-manager");
    expect(card.textContent).not.toContain("已验收");
  });

  it("task chip reaches the existing prefill route for the exact agent without importing or sending", async () => {
    const agentId = "product%literal&question?";
    mocks.list.mockResolvedValue([role(agentId)]);
    render(<AgentDirectoryPage />);
    const card = await screen.findByTestId("agent-card-" + agentId);
    fireEvent.click(within(card).getByRole("button", { name: "起草产品需求" }));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    const url = new URL(mocks.push.mock.calls[0]![0], "https://example.test");
    expect(url.pathname).toBe("/chat");
    expect(url.searchParams.get("agent")).toBe(agentId);
    expect(url.searchParams.get("prefill")).toBe(agentTaskExamples(role())[0]!.prompt);
    expect(mocks.enable).not.toHaveBeenCalled();
    expect(mocks.upgrade).not.toHaveBeenCalled();
  });

  it("reads official roles only on demand, then explicit administrator activation refreshes the real directory", async () => {
    mocks.list.mockResolvedValue([]);
    mocks.enable.mockImplementation(async () => { mocks.list.mockResolvedValue([role()]); });
    const onStartChat = vi.fn();
    render(<AgentDirectoryWorkspace onStartChat={onStartChat} />);
    await screen.findByTestId("agent-directory-empty");
    expect(mocks.offer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("agent-directory-enable-official"));
    await screen.findByTestId("official-role-card-D003");
    expect(screen.getByTestId("official-role-card-grid").className).toContain("xl:grid-cols-3");
    expect(mocks.enable).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "启用官方数字人" }));
    await screen.findByTestId("agent-card-product-a");
    expect(mocks.enable).toHaveBeenCalledTimes(1);
    expect(mocks.enable).toHaveBeenCalledWith(
      expect.objectContaining({ packId: "official-role-pack" }), expect.any(Function),
      expect.objectContaining({ orgId: "org-a", sessionToken: "token-a", signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("数字人配置已更新");
    expect(onStartChat).not.toHaveBeenCalled();
  });

  it("a member can inspect pending official roles but cannot activate them", async () => {
    mocks.role = "member"; mocks.offer.mockResolvedValue(offer(false));
    render(<AgentDirectoryWorkspace onStartChat={vi.fn()} />);
    await screen.findByTestId("agent-card-product-a");
    expect(screen.queryByTestId("agent-directory-enable-official")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "官方角色" }));
    await screen.findByText("请联系组织管理员启用。");
    expect(screen.queryByRole("button", { name: "启用官方数字人" })).toBeNull();
    expect(mocks.enable).not.toHaveBeenCalled();
  });

  it("a late directory response from the previous organization cannot replace the new organization's cards", async () => {
    let finish!: (cards: AgentDirectoryCard[]) => void;
    mocks.list.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = render(<AgentDirectoryWorkspace onStartChat={vi.fn()} />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    mocks.org = "org-b"; mocks.list.mockResolvedValue([role("product-b")]);
    view.rerender(<AgentDirectoryWorkspace onStartChat={vi.fn()} />);
    await screen.findByTestId("agent-card-product-b");
    await act(async () => finish([role("product-a")]));
    expect(screen.queryByTestId("agent-card-product-a")).toBeNull();
    expect(screen.getByTestId("agent-card-product-b")).toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(/token-a|token-b/);
  });

  it("changing the organization aborts an old activation and its completion does not refresh the new scope", async () => {
    let finish!: () => void;
    mocks.enable.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<AgentDirectoryWorkspace onStartChat={vi.fn()} />);
    await screen.findByTestId("agent-card-product-a");
    fireEvent.click(screen.getByTestId("agent-directory-enable-official"));
    await screen.findByTestId("official-role-card-D003");
    fireEvent.click(screen.getByRole("button", { name: "启用官方数字人" }));
    await waitFor(() => expect(mocks.enable).toHaveBeenCalledTimes(1));
    const scope = mocks.enable.mock.calls[0]![2];
    mocks.org = "org-b"; mocks.list.mockResolvedValue([role("product-b")]);
    view.rerender(<AgentDirectoryWorkspace onStartChat={vi.fn()} />);
    await screen.findByTestId("agent-card-product-b");
    expect(scope.signal.aborted).toBe(true);
    expect(scope.isCurrent()).toBe(false);
    const reads = mocks.list.mock.calls.length;
    await act(async () => finish());
    expect(mocks.list).toHaveBeenCalledTimes(reads);
    expect(screen.queryByText(/数字人配置已更新/)).toBeNull();
  });

  it("replacement credentials for the same org/account also close and abort the previous activation", async () => {
    let finish!: () => void;
    mocks.enable.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<AgentDirectoryWorkspace onStartChat={vi.fn()} />);
    await screen.findByTestId("agent-card-product-a");
    fireEvent.click(screen.getByTestId("agent-directory-enable-official"));
    await screen.findByTestId("official-role-card-D003");
    fireEvent.click(screen.getByRole("button", { name: "启用官方数字人" }));
    await waitFor(() => expect(mocks.enable).toHaveBeenCalledTimes(1));
    const scope = mocks.enable.mock.calls[0]![2];
    mocks.token = "token-replacement";
    view.rerender(<AgentDirectoryWorkspace onStartChat={vi.fn()} />);
    await waitFor(() => expect(scope.signal.aborted).toBe(true));
    expect(screen.queryByTestId("official-role-card-D003")).toBeNull();
    await act(async () => finish());
    expect(screen.queryByText(/数字人配置已更新/)).toBeNull();
  });

  it("unknown capability readiness is not silently promoted to business acceptance", () => {
    expect(directoryWorkflowStatus({ ...role(), readiness: "unknown" }).label).toBe("部分能力待开通");
    expect(directoryWorkflowStatus({ ...role(), workflows: [] }).label).toBe("对话模式");
    expect(directoryWorkflowStatus(role()).description).toContain("不包含业务验收结果");
  });
});
