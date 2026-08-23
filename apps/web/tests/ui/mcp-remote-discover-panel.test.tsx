/**
 * issue #1849 —— MCP 后台第一条真实链路的前端接线：填端点 → 提交 → 真实展示工具列表 /
 * 如实展示服务端拒绝理由。`fetch` 被替身，验证的是"这个组件调用了正确的真实 API 路径
 * 并正确渲染结果/错误"，不是重复测服务端逻辑（那边已经有 393 个 mcp 测试）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { McpRemoteDiscoverPanel } from "@/components/admin/mcp-remote-discover-panel";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("McpRemoteDiscoverPanel：真实链路", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-mcp-remote");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("成功：调用 discoverRemoteMcpTools 且展示真实工具列表（不是 mock 数据）", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("/mcp-servers/discover-remote");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ serverId: "crm", endpoint: "https://mcp.example.com/sse", credential: null });
      return json({
        tools: [
          {
            fullName: "mcp:crm.query_contact",
            serverId: "crm",
            signature: "query_contact(company?) -> unknown",
            schemaFingerprint: "abc123",
            sideEffect: "只读",
            authScope: "未开放",
          },
        ],
        added: ["mcp:crm.query_contact"],
        removed: [],
        signatureChanged: [],
        tightenedByCapRecheck: [],
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<McpRemoteDiscoverPanel />);

    fireEvent.change(screen.getByTestId("admin-mcp-remote-server-id"), { target: { value: "crm" } });
    fireEvent.change(screen.getByTestId("admin-mcp-remote-endpoint"), {
      target: { value: "https://mcp.example.com/sse" },
    });
    fireEvent.click(screen.getByTestId("admin-mcp-remote-discover-submit"));

    await waitFor(() => expect(screen.getByTestId("admin-mcp-remote-discover-tools")).toBeInTheDocument());
    expect(screen.getByText("mcp:crm.query_contact")).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("失败：如实展示服务端 reasonCode（不翻译成一句「连接失败」）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: "mcp endpoint refused", reasonCode: "MCP_ENDPOINT_HOST_NOT_PUBLIC" }, 422),
      ),
    );

    render(<McpRemoteDiscoverPanel />);
    fireEvent.change(screen.getByTestId("admin-mcp-remote-server-id"), { target: { value: "internal" } });
    fireEvent.change(screen.getByTestId("admin-mcp-remote-endpoint"), {
      target: { value: "https://127.0.0.1/mcp" },
    });
    fireEvent.click(screen.getByTestId("admin-mcp-remote-discover-submit"));

    await waitFor(() => expect(screen.getByTestId("admin-mcp-remote-discover-error")).toBeInTheDocument());
    // ApiError 的 message 也回退成同一个 reasonCode（见 api-client.ts），所以它会出现两次
    // （错误码本身 + 附带说明行）——这里断言至少出现一次，不纠结具体次数。
    expect(screen.getAllByText("MCP_ENDPOINT_HOST_NOT_PUBLIC").length).toBeGreaterThan(0);
  });

  it("凭据可选：不填 token 时请求体的 credential 为 null", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.credential).toBeNull();
      return json({ tools: [], added: [], removed: [], signatureChanged: [], tightenedByCapRecheck: [] });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<McpRemoteDiscoverPanel />);
    fireEvent.change(screen.getByTestId("admin-mcp-remote-server-id"), { target: { value: "s1" } });
    fireEvent.change(screen.getByTestId("admin-mcp-remote-endpoint"), {
      target: { value: "https://mcp.example.com/sse" },
    });
    fireEvent.click(screen.getByTestId("admin-mcp-remote-discover-submit"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it("填了 token 时请求体带上 credential", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.credential).toBe("secret-abc");
      return json({ tools: [], added: [], removed: [], signatureChanged: [], tightenedByCapRecheck: [] });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<McpRemoteDiscoverPanel />);
    fireEvent.change(screen.getByTestId("admin-mcp-remote-server-id"), { target: { value: "s1" } });
    fireEvent.change(screen.getByTestId("admin-mcp-remote-endpoint"), {
      target: { value: "https://mcp.example.com/sse" },
    });
    fireEvent.change(screen.getByTestId("admin-mcp-remote-auth-token"), { target: { value: "secret-abc" } });
    fireEvent.click(screen.getByTestId("admin-mcp-remote-discover-submit"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });
});
