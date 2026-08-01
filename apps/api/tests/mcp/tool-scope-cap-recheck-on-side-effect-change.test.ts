/**
 * F130 ⑶ · I-28′ -- `sideEffect` changing on re-discovery must re-run `checkToolScopeCap`
 * ON THE SPOT and tighten `authScope`, not wait for someone to revisit "设置授权范围".
 *
 * ⚠ Validating the cap only in `setToolAuthScope`'s write path (⑵) leaves exactly this
 * bypass open: walk a tool in from the read-only side (`只读` × `全体成员`, both legal),
 * then have it start writing on the next probe. If nothing re-checks at discovery time, the
 * tool keeps `全体成员` after it starts writing -- the cap held at the moment it was set and
 * silently stopped holding.
 *
 * This is the change-path cell of the four-cell requirement (⑷); the other three cells
 * (reject / compliant / boundary) live in `tool-scope-cap-pure-fn.test.ts` and
 * `tool-scope-cap-server-enforced.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import {
  discoverMcpTools,
  toContractTool,
} from "../../src/application/mcp/discover-tools";
import type { DiscoveredTool, McpGateway, McpToolStore } from "../../src/application/mcp/ports";

type Tool = ReturnType<typeof toContractTool>;

const gatewayOf = (tools: readonly DiscoveredTool[]): McpGateway => ({
  listTools: async () => tools,
});

function storeOf(initial: readonly Tool[] = []) {
  let rows = [...initial];
  const store: McpToolStore = {
    current: async () => rows,
    replace: async (_id, tools) => {
      rows = [...tools];
    },
  };
  return { store, read: () => rows };
}

const READ_TOOL: DiscoveredTool = {
  name: "query_contact",
  signature: "query_contact(company?: string) -> Contact[]",
  sideEffect: "只读",
};

describe("F130 ⑶ · sideEffect 变化 ⇒ 重新发现当场收紧 authScope", () => {
  it("变更路径：只读 + 全体成员 的工具，重新探测后 sideEffect 变为 对外发送 ⇒ authScope 被收紧", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL, "全体成员")];
    expect(prior[0]!.authScope, "前置：合规，只读 × 全体成员 本就通过").toBe("全体成员");
    expect(AR.checkToolScopeCap({ sideEffect: "只读", authScope: "全体成员" }).ok).toBe(true);

    const nowEgress: DiscoveredTool = { ...READ_TOOL, sideEffect: "对外发送" };
    const { store } = storeOf(prior);
    const r = await discoverMcpTools(
      { gateway: gatewayOf([nowEgress]), store },
      { serverId: "mcp-crm", endpoint: "e" },
    );

    expect(r.tools[0]!.authScope, "收紧后必须落在封顶允许的档位").not.toBe("全体成员");
    expect(AR.checkToolScopeCap({ sideEffect: "对外发送", authScope: r.tools[0]!.authScope }).ok).toBe(
      true,
    );
    expect(r.tightenedByCapRecheck).toEqual([
      {
        toolFullName: "mcp:crm.query_contact",
        fromAuthScope: "全体成员",
        toAuthScope: "需人工确认每次",
        newSideEffect: "对外发送",
      },
    ]);
  });

  it("反证：只在『设置授权范围』一个入口校验会漏掉这条 -- 收紧前的旧范围本身在新 sideEffect 下已经越界", async () => {
    const staleScope = "全体成员" as const;
    const newSideEffect = "对外发送" as const;
    // The state a "validate-on-set-only" implementation would leave behind:
    expect(AR.checkToolScopeCap({ sideEffect: newSideEffect, authScope: staleScope }).ok).toBe(false);

    // The actual re-discovery path does not leave that state:
    const prior = [toContractTool("mcp-crm", READ_TOOL, staleScope)];
    const { store } = storeOf(prior);
    const r = await discoverMcpTools(
      { gateway: gatewayOf([{ ...READ_TOOL, sideEffect: newSideEffect }]), store },
      { serverId: "mcp-crm", endpoint: "e" },
    );
    expect(AR.checkToolScopeCap({ sideEffect: newSideEffect, authScope: r.tools[0]!.authScope }).ok).toBe(
      true,
    );
  });

  it("没有 sideEffect 变化 ⇒ 不收紧、不虚报（仍是只读 × 全体成员）", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL, "全体成员")];
    const { store } = storeOf(prior);
    const r = await discoverMcpTools(
      { gateway: gatewayOf([READ_TOOL]), store },
      { serverId: "mcp-crm", endpoint: "e" },
    );
    expect(r.tightenedByCapRecheck).toEqual([]);
    expect(r.tools[0]!.authScope).toBe("全体成员");
  });

  it("sideEffect 变化但原范围本就合规（未开放）⇒ 范围不变、不产生收紧记录", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL, "未开放")];
    const { store } = storeOf(prior);
    const r = await discoverMcpTools(
      { gateway: gatewayOf([{ ...READ_TOOL, sideEffect: "写入外部" }]), store },
      { serverId: "mcp-crm", endpoint: "e" },
    );
    expect(r.tightenedByCapRecheck).toEqual([]);
    expect(r.tools[0]!.authScope).toBe("未开放");
  });
});
