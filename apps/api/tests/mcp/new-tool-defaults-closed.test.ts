import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";
import { discoverMcpTools, toContractTool } from "../../src/application/mcp/discover-tools";
import type { DiscoveredTool, McpGateway, McpToolStore } from "../../src/application/mcp/ports";
import { authorizeMcpScopeLayer1 } from "../../src/application/mcp/authorize-layer1";
import type { InterceptCounterPort } from "../../src/application/mcp/ports";

/**
 * F129 (domain I-29′ / 原型 `16,684,300` 逐字 `默认全关`) -- 刚探测到的新工具一律是
 * `未开放`，且这个默认值是**闭集里最严的那一格**，不是恰好等于某个字符串。
 *
 * ## 与 F53 `new-tool-not-auto-whitelisted.test.ts` 的分工
 *
 * 那份文件证的是"新工具不会因为发现流程而进白名单，且当它停在未开放时调用被拒"——
 * 关注点是**白名单**（第②层）。这份文件关注点是**F129 的闭集本身**：
 * 默认值必须是 `ToolAuthScope` 全序里 rank 最低的那个成员（而不是巧合地等于同一个
 * 字面量），且这一点在服务器级授权范围**无论设成什么**都不改变默认值——因为
 * "新工具默认未开放"不是"继承服务器设置"，是一条独立的、恒定的默认。
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

describe("F129 · 新工具默认授权范围是闭集里 rank 最低的成员", () => {
  it("`NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE` 的 rank 严格小于闭集里其余全部四个成员", () => {
    const defaultRank = A.TOOL_AUTH_SCOPE_RANK[A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE];
    for (const scope of A.ToolAuthScope.options) {
      if (scope === A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE) continue;
      expect(
        defaultRank,
        `默认值 ${A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE} 的 rank 应严格小于 ${scope}`,
      ).toBeLessThan(A.TOOL_AUTH_SCOPE_RANK[scope]);
    }
    expect(defaultRank).toBe(0);
  });

  it("反证：如果把默认值误改成任意其它成员，上面那条『严格最小』的断言会失败——不是恒真检查", () => {
    const otherScopeRank = A.TOOL_AUTH_SCOPE_RANK["全体成员"];
    const defaultRank = A.TOOL_AUTH_SCOPE_RANK[A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE];
    expect(otherScopeRank).toBeGreaterThan(defaultRank);
  });

  it("`toContractTool` 对一个从未见过的工具（无 previousScope 参数）落 authScope 为默认值", () => {
    const tool = toContractTool("mcp-crm", {
      name: "delete_contact",
      signature: "delete_contact(id: string) -> void",
      sideEffect: "写入外部",
    });
    expect(tool.authScope).toBe(A.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE);
  });

  it("`toContractTool` 对一个只读新工具同样落默认值——只读并不豁免『新工具默认未开放』", () => {
    const tool = toContractTool("mcp-crm", {
      name: "search_regulation",
      signature: "search_regulation(q: string) -> Regulation[]",
      sideEffect: "只读",
    });
    expect(tool.authScope).toBe("未开放");
  });
});

describe("F129 · discoverMcpTools 端到端：新增工具落库时 authScope 恒为未开放", () => {
  it("首次发现（store 为空）：全部工具的 authScope 都是「未开放」，不因 sideEffect 不同而不同", async () => {
    const { store, read } = storeOf([]);
    const gateway = gatewayOf([
      { name: "search_regulation", signature: "search_regulation(q: string) -> Regulation[]", sideEffect: "只读" },
      { name: "submit_inquiry", signature: "submit_inquiry(q: string) -> Ticket", sideEffect: "对外发送" },
      { name: "upload_document", signature: "upload_document(f: File) -> void", sideEffect: "写入外部" },
    ]);

    const result = await discoverMcpTools({ gateway, store }, { serverId: "mcp-reg", endpoint: "https://x" });

    expect(result.added).toEqual([
      "mcp:reg.search_regulation",
      "mcp:reg.submit_inquiry",
      "mcp:reg.upload_document",
    ]);
    for (const t of read()) {
      expect(t.authScope, t.fullName).toBe("未开放");
    }
  });

  it("已存在的工具重新发现时不重置为未开放——默认值只适用于『新』工具，已授权的工具保留其授权（未越出封顶）", async () => {
    const { store } = storeOf([
      A.McpTool.parse({
        fullName: "mcp:reg.search_regulation",
        serverId: "mcp-reg",
        signature: "search_regulation(q: string) -> Regulation[]",
        schemaFingerprint: "old",
        sideEffect: "只读",
        authScope: "全体成员",
      }),
    ]);
    const gateway = gatewayOf([
      { name: "search_regulation", signature: "search_regulation(q: string) -> Regulation[]", sideEffect: "只读" },
    ]);

    const result = await discoverMcpTools({ gateway, store }, { serverId: "mcp-reg", endpoint: "https://x" });

    expect(result.added).toEqual([]);
    expect(result.tools[0]!.authScope).toBe("全体成员");
  });
});

describe("F129 · 硬闸门：服务端确实拒绝『未开放』的调用（不只是清单默认值好看）", () => {
  it("新发现工具（未开放）：即便 actor 兼具项目负责人与平台组身份，服务端仍拒绝并计入拦截", async () => {
    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-reg",
        toolFullName: "mcp:reg.upload_document",
        actorId: "u-owner",
        toolAuthScope: "未开放",
        reviewStatus: "已放行",
        connectionStatus: "已连接",
        quarantineUntil: null,
        now: new Date("2026-08-01T00:00:00Z"),
        actor: { isProjectOwner: true, isInAuthorizedTeam: true, isPlatformGroup: true },
      },
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toBe("AUTH_SCOPE_DENIED");
    expect(counter.events).toHaveLength(1);
  });

  it("这条拒绝与服务器级授权范围无关：服务器本身放到最宽的『全体成员』，工具级仍是『未开放』时照样拒", async () => {
    // 走两道门：I-29′ 的服务器上限门 + 第①层的 evaluateMcpAuthScope。这里只钉后者，
    // 前者的双向穷举在 tool-scope-narrower-than-server.test.ts。
    const withinServer = A.checkToolScopeWithinServer({ serverScope: "全体成员", toolScope: "未开放" });
    expect(withinServer.ok).toBe(true); // 收紧允许

    const counter = fakeCounter();
    const r = await authorizeMcpScopeLayer1(
      { intercepts: counter },
      {
        serverId: "mcp-reg",
        toolFullName: "mcp:reg.upload_document",
        actorId: "u-anyone",
        toolAuthScope: "未开放",
        reviewStatus: "已放行",
        connectionStatus: "已连接",
        quarantineUntil: null,
        now: new Date("2026-08-01T00:00:00Z"),
        actor: { isProjectOwner: false, isInAuthorizedTeam: false, isPlatformGroup: false },
      },
    );
    expect(r.allowed).toBe(false);
  });
});
