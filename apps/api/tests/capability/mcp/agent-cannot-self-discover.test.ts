import { describe, expect, it } from "vitest";
import { SecurityPolicy, AGENT_RUNTIME_FORBIDDEN_ROUTES } from "@repo/contracts/agent-runtime";
import { assertAgentCannotDiscover } from "../../../src/domain/mcp/agent-discovery-guard";
import { authorizeAgentMcpDiscovery } from "../../../src/application/mcp/authorize-agent-discovery";
import type { AgentDiscoveryInterceptPort } from "../../../src/application/mcp/ports";

/**
 * F54 (UC-21.2 R3 步骤 9-10 / R12 V8 / V9) -- 开关四：禁止 agent 自行发现新 MCP + 拦截计数。
 *
 * ⚠ 「客户 CRM 已拦截 7 次」**不是**本开关的证据（原型确认缺失，见 requirements 文件头的
 *   证据错配更正）——本文件不引用那条计数，只对"agent 尝试接入未登记服务器"这件事本身
 *   构造反证。
 */

function fakeIntercepts(): AgentDiscoveryInterceptPort & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async recordDenied(event) {
      events.push(event);
    },
  };
}

describe("F54 · 契约层：开关四没有打开入口，字段类型即锁", () => {
  it("SecurityPolicy.agentSelfDiscoversMcp 只能是 false——传 true 直接被 zod 拒绝", () => {
    const attempt = {
      isolateNewServers: true,
      logCustomerDataCalls: true,
      confidentialLocalOnly: true,
      agentSelfDiscoversMcp: true,
      provenanceRetentionDays: 180,
    };
    expect(SecurityPolicy.safeParse(attempt).success).toBe(false);
  });

  it("反证：其余三键各自的合法值仍能通过校验——不是整份 schema 恒拒", () => {
    const ok = {
      isolateNewServers: false,
      logCustomerDataCalls: false,
      confidentialLocalOnly: true,
      agentSelfDiscoversMcp: false,
      provenanceRetentionDays: 30,
    };
    expect(SecurityPolicy.safeParse(ok).success).toBe(true);
  });

  it("禁止路由清单里登记着 `POST /mcp-servers/discover-by-agent`——直调该路由无接口可打", () => {
    const found = AGENT_RUNTIME_FORBIDDEN_ROUTES.find(
      (r) => r.route === "POST /mcp-servers/discover-by-agent",
    );
    expect(found).toBeDefined();
  });
});

describe("F54 · assertAgentCannotDiscover -- 纯函数判定", () => {
  it("引用一个不在登记清单里的 serverId ⇒ 拒绝", () => {
    const r = assertAgentCannotDiscover({
      requestedServerId: "mcp-unregistered-vendor",
      requestedByAgentId: "a-scout",
      knownServerIds: ["mcp-crm", "mcp-eu-reg"],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("AGENT_CANNOT_DISCOVER_MCP");
  });

  it("反证：引用一个已登记的 serverId ⇒ 通过（这一层不管授权范围，只管「存不存在」）", () => {
    const r = assertAgentCannotDiscover({
      requestedServerId: "mcp-crm",
      requestedByAgentId: "a-scout",
      knownServerIds: ["mcp-crm", "mcp-eu-reg"],
    });
    expect(r.ok).toBe(true);
  });

  it("登记清单为空（组织尚未注册任何 MCP 服务器）⇒ 任何 serverId 都被拒", () => {
    const r = assertAgentCannotDiscover({
      requestedServerId: "mcp-anything",
      requestedByAgentId: "a-scout",
      knownServerIds: [],
    });
    expect(r.ok).toBe(false);
  });
});

describe("F54 · authorizeAgentMcpDiscovery -- 用例层：拒绝 + 计入拦截计数", () => {
  it("未登记服务器 ⇒ 拒绝且计数器收到恰好一条 AGENT_CANNOT_DISCOVER_MCP 事件", async () => {
    const intercepts = fakeIntercepts();
    const r = await authorizeAgentMcpDiscovery(
      { intercepts },
      {
        requestedServerId: "mcp-shadow-vendor",
        requestedByAgentId: "a-scout",
        knownServerIds: ["mcp-crm"],
      },
    );
    expect(r.allowed).toBe(false);
    expect(intercepts.events).toHaveLength(1);
    expect(intercepts.events[0]).toMatchObject({
      requestedServerId: "mcp-shadow-vendor",
      requestedByAgentId: "a-scout",
      reason: "AGENT_CANNOT_DISCOVER_MCP",
    });
  });

  it("反证：已登记服务器 ⇒ 通过，且不产生任何拦截计数", async () => {
    const intercepts = fakeIntercepts();
    const r = await authorizeAgentMcpDiscovery(
      { intercepts },
      { requestedServerId: "mcp-crm", requestedByAgentId: "a-scout", knownServerIds: ["mcp-crm"] },
    );
    expect(r.allowed).toBe(true);
    expect(intercepts.events).toHaveLength(0);
  });

  it("V9 叠加策略：即便调用方传入的策略把开关四标为「已打开」，判定依然与登记清单一致，不看那个布尔值", async () => {
    // 契约类型已把 agentSelfDiscoversMcp 焊死为 z.literal(false)，这里用 `as unknown` 强行
    // 构造一个"被篡改"的值，证明判定函数根本不读它——锁不靠一个可能失效的布尔单点。
    const tamperedPolicyFlag = true as unknown as false;
    void tamperedPolicyFlag; // 仅用于说明：下面的判定函数签名里压根没有这个参数位。
    const intercepts = fakeIntercepts();
    const r = await authorizeAgentMcpDiscovery(
      { intercepts },
      {
        requestedServerId: "mcp-newly-found-by-agent",
        requestedByAgentId: "a-scout",
        knownServerIds: ["mcp-crm"],
      },
    );
    expect(r.allowed).toBe(false);
  });
});
