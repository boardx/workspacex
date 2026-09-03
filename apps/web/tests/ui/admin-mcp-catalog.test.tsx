/**
 * MCP 服务器屏简化后的形态（2026-09-02，人类原话：「简化…MCP…参考画布模板的首页，简化为
 * 一个卡片的列表，通过一个侧边面板来展示当前的实体的内容，可以增加删除修改，并通过 tag
 * 来过滤和搜索」）。
 *
 * 断言点：
 *   ① 列表**只**来自真实 `listMcpServers`——六台示例服务器、「静态演示数据」黄条、
 *      默认隔离开关、放行评审这些零后端的东西都不在了；
 *   ② 内网/外网、授权范围、评审状态、连接状态都是可筛的标签；
 *   ③ 「连接服务器」打开抽屉里的真实 `McpRemoteDiscoverPanel`；
 *   ④ 点卡片打开面板：字段来自列表行；「重新连接」用同一个 serverId 再跑一次
 *      `discoverRemoteMcpTools`——这是这条契约上唯一真实的「修改」路径；
 *   ⑤ 面板如实写明契约里没有注销操作，不画假删除按钮。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { listMcpServers, discoverRemoteMcpTools } = vi.hoisted(() => ({
  listMcpServers: vi.fn(),
  discoverRemoteMcpTools: vi.fn(),
}));

vi.mock("@/lib/live-mcp-admin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/live-mcp-admin")>("@/lib/live-mcp-admin");
  return { ...actual, listMcpServers, discoverRemoteMcpTools };
});

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => null,
  useSession: () => ({ session: null, identity: null }),
}));

import { McpScreen } from "@/components/admin/mcp-screen";

afterEach(() => cleanup());

const CRM = {
  serverId: "crm",
  name: "客户 CRM",
  description: "Salesforce 桥接",
  endpointHint: "内网",
  authScope: "全体成员",
  reviewStatus: "待安全评审",
  connectionStatus: "已隔离",
  quarantineUntil: null,
  involvesCustomerData: true,
  isEgress: false,
  toolCount: 3,
  lastDiscoveredAt: "2026-08-23T22:57:21.861Z",
} as const;

const DEEPWIKI = {
  serverId: "deepwiki",
  name: "deepwiki",
  description: "公开知识库",
  endpointHint: "外网",
  authScope: "未开放",
  reviewStatus: "待安全评审",
  connectionStatus: "已连接",
  quarantineUntil: null,
  involvesCustomerData: false,
  isEgress: true,
  toolCount: 5,
  lastDiscoveredAt: null,
} as const;

describe("MCP 服务器屏：真实数据的卡片目录 + 面板", () => {
  beforeEach(() => {
    listMcpServers.mockReset();
    discoverRemoteMcpTools.mockReset();
    listMcpServers.mockResolvedValue([CRM, DEEPWIKI]);
  });

  it("① 列表只来自 listMcpServers；示例服务器、演示黄条、默认隔离开关都不在", async () => {
    render(<McpScreen state="default" />);
    const list = await screen.findByTestId("admin-mcp-list");
    expect(list.className).toContain("grid");
    expect(within(list).getByTestId("admin-mcp-card-crm")).toHaveTextContent("客户 CRM");
    expect(within(list).getByTestId("admin-mcp-card-deepwiki")).toHaveTextContent("5 工具");
    expect(list.querySelectorAll('[data-testid^="admin-mcp-card-"]')).toHaveLength(2);

    expect(screen.queryByTestId("admin-mcp-mock-registry-notice")).toBeNull();
    expect(screen.queryByTestId("admin-mcp-policy-toggle")).toBeNull();
    expect(screen.queryByTestId("admin-mcp-view-toggle-list")).toBeNull();
    expect(screen.queryByText(/静态演示数据/)).toBeNull();
    expect(listMcpServers).toHaveBeenCalledTimes(1);
  });

  it("② 内网/外网、授权范围、评审、连接状态、涉客户数据都是可筛的标签；搜索按标识/名称/描述", async () => {
    render(<McpScreen state="default" />);
    await screen.findByTestId("admin-mcp-list");
    const filters = screen.getByTestId("admin-mcp-tag-filters");
    expect(within(filters).getByTestId("admin-mcp-tag-filter-intranet").textContent).toContain("内网 1");
    expect(within(filters).getByTestId("admin-mcp-tag-filter-pending-security-review").textContent).toContain("待安全评审 2");
    expect(within(filters).getByTestId("admin-mcp-tag-filter-connected").textContent).toContain("已连接 1");
    expect(within(filters).getByTestId("admin-mcp-tag-filter-customer-data").textContent).toContain("涉客户数据 1");

    fireEvent.click(screen.getByTestId("admin-mcp-tag-filter-internet"));
    expect(screen.queryByTestId("admin-mcp-card-crm")).toBeNull();
    expect(screen.getByTestId("admin-mcp-card-deepwiki")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-mcp-tag-filter-all"));
    fireEvent.change(screen.getByTestId("admin-mcp-search"), { target: { value: "salesforce" } });
    expect(screen.getByTestId("admin-mcp-card-crm")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-mcp-card-deepwiki")).toBeNull();
  });

  it("③ 「连接服务器」打开抽屉里的真实发现面板", async () => {
    render(<McpScreen state="default" />);
    await screen.findByTestId("admin-mcp-list");
    expect(screen.queryByTestId("admin-mcp-remote-discover-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("admin-mcp-add"));
    const drawer = screen.getByTestId("admin-mcp-panel");
    expect(within(drawer).getByTestId("admin-mcp-remote-discover-panel")).toBeInTheDocument();
    expect(within(drawer).getByTestId("admin-mcp-remote-discover-submit")).toBeInTheDocument();
  });

  it("④ 面板：字段来自列表行；「重新连接」用同一个 serverId 再跑 discoverRemoteMcpTools 并刷新列表", async () => {
    discoverRemoteMcpTools.mockResolvedValue({
      serverId: "crm",
      tools: [
        { fullName: "mcp:crm.search", signature: "search(q)", sideEffect: "只读", authScope: "全体成员" },
      ],
      added: [],
      removed: [],
    });
    render(<McpScreen state="default" />);
    await screen.findByTestId("admin-mcp-list");
    fireEvent.click(screen.getByTestId("admin-mcp-card-crm"));
    const drawer = screen.getByTestId("admin-mcp-detail");
    expect(drawer).toHaveTextContent("Salesforce 桥接");
    expect(drawer).toHaveTextContent("待安全评审");
    expect(drawer).toHaveTextContent("3 个");
    expect(drawer).toHaveTextContent("2026-08-23T22:57:21.861Z");

    expect(within(drawer).getByTestId("admin-mcp-detail-crm-submit")).toBeDisabled();
    fireEvent.change(within(drawer).getByTestId("admin-mcp-detail-crm-endpoint"), {
      target: { value: "https://crm.example.com/sse" },
    });
    fireEvent.change(within(drawer).getByTestId("admin-mcp-detail-crm-auth-token"), {
      target: { value: "secret-abc" },
    });
    fireEvent.click(within(drawer).getByTestId("admin-mcp-detail-crm-submit"));

    await waitFor(() => expect(discoverRemoteMcpTools).toHaveBeenCalledTimes(1));
    expect(discoverRemoteMcpTools).toHaveBeenCalledWith({
      serverId: "crm",
      endpoint: "https://crm.example.com/sse",
      authToken: "secret-abc",
    });
    await waitFor(() => expect(within(screen.getByTestId("admin-mcp-detail")).getByTestId("admin-mcp-detail-crm-tools")).toHaveTextContent("mcp:crm.search"));
    // 成功后重读列表——不把本地状态当成落库结果。
    await waitFor(() => expect(listMcpServers).toHaveBeenCalledTimes(2));
  });

  it("④′ 重新连接失败：原样显示 reasonCode，不翻译成「请重试」", async () => {
    const { ApiError } = await import("@/lib/api-client");
    discoverRemoteMcpTools.mockRejectedValue(new ApiError(422, "MCP_ENDPOINT_HOST_NOT_PUBLIC", "host not public"));
    render(<McpScreen state="default" />);
    await screen.findByTestId("admin-mcp-list");
    fireEvent.click(screen.getByTestId("admin-mcp-card-crm"));
    const drawer = screen.getByTestId("admin-mcp-detail");
    fireEvent.change(within(drawer).getByTestId("admin-mcp-detail-crm-endpoint"), { target: { value: "https://10.0.0.5/sse" } });
    fireEvent.click(within(drawer).getByTestId("admin-mcp-detail-crm-submit"));
    expect(await within(drawer).findByTestId("admin-mcp-detail-crm-error")).toHaveTextContent("MCP_ENDPOINT_HOST_NOT_PUBLIC");
  });

  it("⑤ 面板如实写明契约里没有注销操作；没有假的删除按钮", async () => {
    render(<McpScreen state="default" />);
    await screen.findByTestId("admin-mcp-list");
    fireEvent.click(screen.getByTestId("admin-mcp-card-deepwiki"));
    const drawer = screen.getByTestId("admin-mcp-detail");
    expect(drawer).toHaveTextContent("没有注销服务器的操作");
    expect(within(drawer).queryByRole("button", { name: /删除|注销/ })).toBeNull();
  });

  it("读取失败：显示错误与重试，不是空态", async () => {
    listMcpServers.mockRejectedValueOnce(new Error("gateway down"));
    render(<McpScreen state="default" />);
    expect(await screen.findByTestId("admin-mcp-error")).toHaveTextContent("gateway down");
    expect(screen.queryByTestId("admin-mcp-empty")).toBeNull();
    fireEvent.click(screen.getByTestId("admin-mcp-retry"));
    await screen.findByTestId("admin-mcp-list");
  });
});
