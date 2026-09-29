/**
 * AG04（R8）—— 管理详情页「角色」区块的组件测试。review 指出：此前 admin 详情页
 * 只挂了 `AgentCapabilityGraph`，`getAgentRoleAdmin`/`updateAgentRoleDraft` 两个
 * AG01 就已存在的契约操作在 `apps/web` 里没有任何真实调用方。
 *
 * `AgentRoleAdminSection` 注入 `lib/agent-role-admin.ts`（mock 掉，不经真实网络）；
 * 断言：加载态 → 渲染头像/分类/白名单/能力就绪；官方 Agent 锁定编辑控件；
 * 编辑触发 `updateAgentRoleDraft` 并用返回视图刷新；401/403 → 无权占位。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AgentRoleAdminSection } from "@/components/admin/agent-role-admin-section";
import { ApiError } from "@/lib/api-client";
import type { AgentRoleAdminView } from "@/lib/agent-role-admin";

// jsdom 没有 ResizeObserver，Radix Popper（Select 底层）展开时会调——同
// `overlay-primitives-select-tooltip.test.tsx` 的同一处最小桩。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

const getAgentRoleAdmin = vi.fn();
const updateAgentRoleDraft = vi.fn();
vi.mock("@/lib/agent-role-admin", () => ({
  getAgentRoleAdmin: (...args: unknown[]) => getAgentRoleAdmin(...args),
  updateAgentRoleDraft: (...args: unknown[]) => updateAgentRoleDraft(...args),
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function view(overrides: Partial<AgentRoleAdminView> = {}): AgentRoleAdminView {
  return {
    agentId: "agent-1",
    draft: {
      avatar: null, roleCategory: "research", catalogSource: "org",
      workflowAllowlist: ["W001"],
      delegationPolicy: { allowedTargets: [], maxDepth: 0, requireApproval: true },
      escalationPolicy: { rules: [] },
      kpi: [],
    },
    published: null,
    editable: true,
    toolPolicy: ["knowledge.search"],
    capabilityReadiness: [{ category: "knowledge.search", status: "unknown", grantedToolNames: [], isWrite: false }],
    version: 0,
    ...overrides,
  };
}

describe("AgentRoleAdminSection（AG04 管理详情角色区块）", () => {
  it("加载后渲染分类/白名单/能力就绪", async () => {
    getAgentRoleAdmin.mockResolvedValue(view());
    render(<AgentRoleAdminSection agentId="agent-1" />);
    expect(screen.getByTestId("agent-role-admin-loading")).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId("agent-role-admin-section")).not.toBeNull());
    expect(within(screen.getByTestId("agent-role-admin-workflow-allowlist")).getByText("W001")).not.toBeNull();
    expect(screen.getByTestId("agent-role-admin-readiness-knowledge.search")).not.toBeNull();
    expect(getAgentRoleAdmin).toHaveBeenCalledWith("agent-1");
  });

  it("官方 Agent：editable=false → 锁定徽标 + 分类下拉禁用", async () => {
    getAgentRoleAdmin.mockResolvedValue(view({
      editable: false,
      draft: { ...view().draft, catalogSource: "official" },
    }));
    render(<AgentRoleAdminSection agentId="agent-1" />);
    await waitFor(() => expect(screen.getByTestId("agent-role-admin-locked")).not.toBeNull());
    expect(screen.getByTestId("agent-role-admin-category-select")).toHaveAttribute("disabled");
    // 官方目录锁定：没有输入框可以新增白名单
    expect(screen.queryByTestId("agent-role-admin-workflow-input")).toBeNull();
  });

  it("改分类 → 调用 updateAgentRoleDraft 并用返回视图刷新", async () => {
    getAgentRoleAdmin.mockResolvedValue(view());
    updateAgentRoleDraft.mockResolvedValue(view({ draft: { ...view().draft, roleCategory: "sales" }, version: 1 }));
    render(<AgentRoleAdminSection agentId="agent-1" />);
    await waitFor(() => expect(screen.getByTestId("agent-role-admin-section")).not.toBeNull());

    fireEvent.pointerDown(screen.getByTestId("agent-role-admin-category-select"), { button: 0 });
    fireEvent.click(await screen.findByText("销售"));

    await waitFor(() => expect(updateAgentRoleDraft).toHaveBeenCalledWith({
      agentId: "agent-1", expectedVersion: 0, patch: { roleCategory: "sales" },
    }));
  });

  it("新增白名单条目：格式校验 + 调用 patch", async () => {
    getAgentRoleAdmin.mockResolvedValue(view());
    updateAgentRoleDraft.mockResolvedValue(view({ draft: { ...view().draft, workflowAllowlist: ["W001", "W002"] } }));
    render(<AgentRoleAdminSection agentId="agent-1" />);
    await waitFor(() => expect(screen.getByTestId("agent-role-admin-section")).not.toBeNull());

    const input = screen.getByTestId("agent-role-admin-workflow-input");
    const addButton = screen.getByText("添加");
    expect(addButton).toHaveAttribute("disabled"); // 空输入禁用

    fireEvent.change(input, { target: { value: "W002" } });
    fireEvent.click(addButton);
    await waitFor(() => expect(updateAgentRoleDraft).toHaveBeenCalledWith({
      agentId: "agent-1", expectedVersion: 0, patch: { workflowAllowlist: ["W001", "W002"] },
    }));
  });

  it("401/403 → 无权占位，不渲染表单", async () => {
    getAgentRoleAdmin.mockRejectedValue(new ApiError(403, "ROLE_INSUFFICIENT", {}));
    render(<AgentRoleAdminSection agentId="agent-1" />);
    await waitFor(() => expect(screen.getByTestId("agent-role-admin-denied")).not.toBeNull());
    expect(screen.queryByTestId("agent-role-admin-section")).toBeNull();
  });

  it("其他错误 → 错误态 + 可重试", async () => {
    getAgentRoleAdmin.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(view());
    render(<AgentRoleAdminSection agentId="agent-1" />);
    await waitFor(() => expect(screen.getByTestId("agent-role-admin-error")).not.toBeNull());
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => expect(screen.getByTestId("agent-role-admin-section")).not.toBeNull());
  });
});
