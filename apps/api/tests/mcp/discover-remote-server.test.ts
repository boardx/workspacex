/**
 * issue #1852 —— `discoverRemoteMcpTools` 用例：admin 门 + SSRF 字面量门都在网关调用**之前**，
 * 且成功路径原样委托给既有的 `discoverMcpTools`（不重新发明变更集逻辑）。
 */
import { describe, expect, it } from "vitest";
import {
  discoverRemoteMcpTools,
  DiscoverRemoteMcpToolsError,
} from "../../src/application/mcp/discover-remote-server";
import { McpEndpointRefusedError } from "../../src/domain/mcp/remote-endpoint-guard";
import type { DiscoveredTool, McpGateway, McpToolStore } from "../../src/application/mcp/ports";
import type { IdentityRepository } from "../../src/application/identity/ports";

const READ_TOOL: DiscoveredTool = {
  name: "query_contact",
  signature: "query_contact(company?: string) -> unknown",
  sideEffect: "只读",
};

function identitiesOf(role: "admin" | "member" | null): IdentityRepository {
  return {
    findOrganization: async () => ({ orgId: "org-1", kind: "standard" }) as never,
    findOrgMembership: async () => (role === null ? null : ({ orgRole: role } as never)),
  } as unknown as IdentityRepository;
}

function storeOf(): McpToolStore {
  let rows: readonly never[] = [];
  return {
    current: async () => rows,
    replace: async (_id, tools) => {
      rows = tools as never;
    },
  };
}

function gatewayOf(spy: { calls: number }): McpGateway {
  return {
    listTools: async () => {
      spy.calls += 1;
      return [READ_TOOL];
    },
  };
}

describe("discoverRemoteMcpTools：admin 门在网关调用之前", () => {
  it("非管理员 ⇒ 拒绝，且网关从未被调用（不能让非管理员触发出站请求）", async () => {
    const spy = { calls: 0 };
    await expect(
      discoverRemoteMcpTools(
        { identities: identitiesOf("member"), gateway: gatewayOf(spy), store: storeOf(), localOnlyOrg: false },
        { orgId: "org-1", actorId: "u1", serverId: "s1", endpoint: "https://mcp.example.com/sse" },
      ),
    ).rejects.toBeInstanceOf(DiscoverRemoteMcpToolsError);
    expect(spy.calls).toBe(0);
  });

  it("组织查不到（membership 为 null）⇒ 同样拒绝，网关未被调用", async () => {
    const spy = { calls: 0 };
    await expect(
      discoverRemoteMcpTools(
        { identities: identitiesOf(null), gateway: gatewayOf(spy), store: storeOf(), localOnlyOrg: false },
        { orgId: "org-1", actorId: "u1", serverId: "s1", endpoint: "https://mcp.example.com/sse" },
      ),
    ).rejects.toBeInstanceOf(DiscoverRemoteMcpToolsError);
    expect(spy.calls).toBe(0);
  });
});

describe("discoverRemoteMcpTools：SSRF 字面量门在网关调用之前", () => {
  it("管理员但端点不合法（http 明文）⇒ 拒绝，网关未被调用", async () => {
    const spy = { calls: 0 };
    await expect(
      discoverRemoteMcpTools(
        { identities: identitiesOf("admin"), gateway: gatewayOf(spy), store: storeOf(), localOnlyOrg: false },
        { orgId: "org-1", actorId: "u1", serverId: "s1", endpoint: "http://mcp.example.com/sse" },
      ),
    ).rejects.toBeInstanceOf(McpEndpointRefusedError);
    expect(spy.calls).toBe(0);
  });

  it("管理员但端点是私网字面量 ⇒ 拒绝，网关未被调用", async () => {
    const spy = { calls: 0 };
    await expect(
      discoverRemoteMcpTools(
        { identities: identitiesOf("admin"), gateway: gatewayOf(spy), store: storeOf(), localOnlyOrg: false },
        { orgId: "org-1", actorId: "u1", serverId: "s1", endpoint: "https://127.0.0.1/sse" },
      ),
    ).rejects.toBeInstanceOf(McpEndpointRefusedError);
    expect(spy.calls).toBe(0);
  });
});

describe("discoverRemoteMcpTools：成功路径委托给既有 discoverMcpTools", () => {
  it("管理员 + 合法端点 ⇒ 网关被调用一次，结果形状与 discoverMcpTools 一致（added 命中新工具）", async () => {
    const spy = { calls: 0 };
    const result = await discoverRemoteMcpTools(
      { identities: identitiesOf("admin"), gateway: gatewayOf(spy), store: storeOf(), localOnlyOrg: false },
      { orgId: "org-1", actorId: "u1", serverId: "s1", endpoint: "https://mcp.example.com/sse" },
    );
    expect(spy.calls).toBe(1);
    // 命名空间来自 `serverId`（契约的构造入口），不是端点的 host——见 `discover-tools.ts`。
    expect(result.added).toEqual(["mcp:s1.query_contact"]);
  });
});
