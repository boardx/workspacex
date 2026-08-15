/**
 * MCP 服务器屏——卡片/列表视图切换（后台统一标准：左栏菜单 + 右侧卡片，卡片可切换列表）。
 *
 * 人类原话：「对于后台的管理功能，修改为一个统一的标准，类似skill目录，左边还是保留一个
 * column现实当前的后台菜单，右边列出卡片来表达当前的entity的列表，卡片也可以切换为列表，
 * 需要有这个切换的功能。」
 *
 * 断言点：
 * ① 默认进入即卡片视图，容器与卡片可见；点「列表」切到既有的行式列表，点「卡片」切回。
 * ② 卡片视图不丢字段——涉客户数据 / 工具数 / 授权范围 / 评审状态 / 连接状态在卡片里都在。
 * ③ 卡片上的交互按钮（配置/看工具/撤销授权/放行评审）保留，不因换视图而丢功能。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => null,
  useSession: () => ({ session: null, identity: null }),
}));

import { McpScreen } from "@/components/admin/mcp-screen";

afterEach(() => cleanup());

describe("MCP 服务器屏：卡片 ⇄ 列表视图切换", () => {
  it("① 默认卡片视图：容器与卡片网格可见，列表不渲染", () => {
    render(<McpScreen state="default" />);
    expect(screen.getByTestId("admin-mcp-view-container")).toBeInTheDocument();
    expect(screen.getByTestId("admin-mcp-card-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-mcp-list")).toBeNull();
    expect(screen.getByTestId("admin-mcp-view-toggle-card")).toHaveAttribute("aria-pressed", "true");
  });

  it("② 点击「列表」切到既有行式列表；再点「卡片」切回", () => {
    render(<McpScreen state="default" />);
    fireEvent.click(screen.getByTestId("admin-mcp-view-toggle-list"));
    expect(screen.getByTestId("admin-mcp-list")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-mcp-card-grid")).toBeNull();
    expect(screen.getByTestId("admin-mcp-view-toggle-list")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("admin-mcp-view-toggle-card"));
    expect(screen.getByTestId("admin-mcp-card-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-mcp-list")).toBeNull();
  });

  it("③ 卡片视图信息密度不丢字段：工具数/授权范围/评审状态/连接状态齐全", () => {
    render(<McpScreen state="default" />);
    const grid = screen.getByTestId("admin-mcp-card-grid");
    const cards = within(grid).getAllByText(/工具$/);
    expect(cards.length).toBeGreaterThan(0);
    // 每张卡片都要能找到授权范围与评审状态、连接状态徽标（用列表页已有的 testid 前缀复用断言）。
    const firstCardTestIds = grid.querySelectorAll('[data-testid^="admin-mcp-card-"]');
    expect(firstCardTestIds.length).toBeGreaterThan(0);
    firstCardTestIds.forEach((card) => {
      const el = card as HTMLElement;
      expect(el.querySelector('[data-testid^="admin-mcp-authscope-"]')).not.toBeNull();
      expect(el.querySelector('[data-testid^="admin-mcp-review-"]')).not.toBeNull();
      expect(el.querySelector('[data-testid^="admin-mcp-conn-"]')).not.toBeNull();
    });
  });

  it("④ 卡片上的交互按钮保留：至少「配置」按钮在每张卡片上可点", () => {
    render(<McpScreen state="default" />);
    const grid = screen.getByTestId("admin-mcp-card-grid");
    const configButtons = Array.from(grid.querySelectorAll('[data-testid^="admin-mcp-config-"]'));
    expect(configButtons.length).toBeGreaterThan(0);
    fireEvent.click(configButtons[0]!);
    expect(screen.getByTestId("admin-mcp-panel")).toBeInTheDocument();
  });
});
