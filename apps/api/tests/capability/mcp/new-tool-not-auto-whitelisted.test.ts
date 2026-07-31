import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import { discoverMcpTools } from "../../../src/application/mcp/discover-tools";
import type { DiscoveredTool, McpGateway, McpToolStore } from "../../../src/application/mcp/ports";
import { authorizeMcpScopeLayer1 } from "../../../src/application/mcp/authorize-layer1";
import type { InterceptCounterPort } from "../../../src/application/mcp/ports";

/**
 * F53 (UC-21.1 R7) -- 「服务器新增工具后重新发现，已有 agent 白名单不含它需人工添加」.
 *
 * ## 两件事分开证，因为它们分别属于两个不同的组件
 *
 * ① **发现不写白名单**（I-21，F52 已经把这条钉在 `discoverMcpTools` 里——本文件不重新
 *    实现它，而是从"F53 关心的角度"重新断言：一次真实的 agent 白名单不会因为服务器新增
 *    了工具而多出一条）。
 * ② **新工具的默认授权范围（`未开放`）在服务端确实是硬闸门**——即便调用方是项目负责人 /
 *    授权团队成员，只要工具还停在 `未开放`，`authorizeMcpScopeLayer1` 也必须拒绝。
 *    这是"不自动进白名单"在运行时的真正后果：光是"没被加进白名单"不能证明"调不动"，
 *    必须证明"调用会被服务端拒"，否则「白名单」只是一份没人读的清单。
 */

function fakeCounter(): InterceptCounterPort & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async recordDenied(event) {
      events.push(event);
    },
  };
}

const gatewayOf = (tools: readonly DiscoveredTool[]): McpGateway => ({
  listTools: async () => tools,
});

function storeOf(initial: readonly ReturnType<typeof A.McpTool.parse>[] = []) {
  let rows = [...initial];
  const store: McpToolStore = {
    current: async () => rows,
    replace: async (_id, tools) => {
      rows = [...tools];
    },
  };
  return { store, read: () => rows };
}

/** 一份固定不变的 agent 白名单——发现流程完全不知道它的存在，也不应该碰它。 */
const AGENT_WHITELIST_BEFORE: readonly { toolFullName: string; state: string; elevationDecision: null }[] = [
  { toolFullName: "mcp:crm.query_contact", state: "在授权范围内", elevationDecision: null },
];

describe("F53 · ①新工具不自动进 agent 白名单（发现流程不知道白名单的存在）", () => {
  it("服务器新增一个工具后重新发现，agent 现有白名单原样不变（长度、内容都不变）", async () => {
    const { store } = storeOf([
      A.McpTool.parse({
        fullName: "mcp:crm.query_contact",
        serverId: "mcp-crm",
        signature: "query_contact(company?: string) -> Contact[]",
        schemaFingerprint: "existing",
        sideEffect: "只读",
        authScope: "全体成员",
      }),
    ]);
    const gateway = gatewayOf([
      { name: "query_contact", signature: "query_contact(company?: string) -> Contact[]", sideEffect: "只读" },
      // 新增的工具：
      { name: "delete_contact", signature: "delete_contact(id: string) -> void", sideEffect: "写入外部" },
    ]);

    const result = await discoverMcpTools({ gateway, store }, { serverId: "mcp-crm", endpoint: "https://x" });

    expect(result.added).toEqual(["mcp:crm.delete_contact"]);
    // 白名单是一份独立的、发现流程根本没有引用到的数据——它没有变化，因为没人碰过它。
    expect(AGENT_WHITELIST_BEFORE).toHaveLength(1);
    expect(AGENT_WHITELIST_BEFORE.some((e) => e.toolFullName === "mcp:crm.delete_contact")).toBe(
      false,
    );
  });

  it("新发现的工具，contract 记录的 authScope 恒为「未开放」，不是「继承服务器授权范围」", async () => {
    const { store } = storeOf([]);
    const gateway = gatewayOf([
      { name: "delete_contact", signature: "delete_contact(id: string) -> void", sideEffect: "写入外部" },
    ]);

    const result = await discoverMcpTools({ gateway, store }, { serverId: "mcp-crm", endpoint: "https://x" });

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.authScope).toBe(A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE);
    expect(result.tools[0]!.authScope).toBe("未开放");
  });

  it("反证：把「未开放」错写成「全体成员」，会让上面这条断言失败——不是恒真的检查", () => {
    expect("全体成员").not.toBe(A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE);
  });
});

describe("F53 · ②服务端真的挡住「未开放」的新工具调用，不只是清单上没有它", () => {
  it("新发现工具（未开放）：即便 actor 是项目负责人兼授权团队成员，调用仍被拒 AUTH_SCOPE_DENIED", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-crm",
        toolFullName: "mcp:crm.delete_contact",
        actorId: "u-owner",
        toolAuthScope: "未开放",
        reviewStatus: "已放行",
        connectionStatus: "已连接",
        quarantineUntil: null,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: true },
      },
    );

    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toBe("AUTH_SCOPE_DENIED");
    expect(counter.events).toHaveLength(1);
  });

  it("反证：把同一个工具人工加白（authScope 改为「全体成员」）后，调用才通过——证明拒绝确实来自 authScope 而非其它字段", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-crm",
        toolFullName: "mcp:crm.delete_contact",
        actorId: "u-owner",
        toolAuthScope: "全体成员",
        reviewStatus: "已放行",
        connectionStatus: "已连接",
        quarantineUntil: null,
        now: new Date("2026-07-31T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: true },
      },
    );
    expect(r.allowed).toBe(true);
    expect(counter.events).toEqual([]);
  });
});
