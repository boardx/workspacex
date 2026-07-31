/**
 * F52 backend: tool discovery, and the three-orthogonal-fields invariant on the WRITE side.
 *
 * ⚠ 三正交字段的**写入侧**断言（探测结果绝不写成「已隔离」、拒绝时说得出是哪一维）
 * 已搬到 `tests/capability/mcp/three-orthogonal-fields.test.ts` —— 那是 F52 的验收命令
 * 指向的文件。**不在两处各留一份**：同一条断言声明在两处，与同一个事实声明在两处同性质。
 * 本文件只留发现机制本身（变更集 / 命名空间 / F130 ⑶ / 失败路径）。
 *
 * Every group carries a counter-proof -- an input that must fail. Without them a suite like
 * this is green against a stub that does nothing, which this project has hit nine times.
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import {
  clampScopeToSideEffect,
  discoverMcpTools,
  fingerprint,
  serverSlugOf,
  toContractTool,
} from "../../src/application/mcp/discover-tools";
import type { DiscoveredTool, McpGateway, McpToolStore } from "../../src/application/mcp/ports";
import {
  McpDiscoveryTimeoutError,
  McpServerUnreachableError,
} from "../../src/application/mcp/ports";

type Tool = ReturnType<typeof toContractTool>;

/* ── fakes ─────────────────────────────────────────────────────── */

const gatewayOf = (tools: readonly DiscoveredTool[]): McpGateway => ({ listTools: async () => tools });

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
const WRITE_TOOL: DiscoveredTool = {
  name: "create_task",
  signature: "create_task(title: string) -> TaskId",
  sideEffect: "写入外部",
};

/* ── probe -> connection status ────────────────────────────────── */

/* ── discovery ─────────────────────────────────────────────────── */

describe("工具发现：命名空间由我们决定", () => {
  it("全名由契约的构造入口生成，不来自网关", async () => {
    const { store } = storeOf();
    const r = await discoverMcpTools(
      { gateway: gatewayOf([READ_TOOL, WRITE_TOOL]), store },
      { serverId: "mcp-crm", endpoint: "mcp://crm.internal:7301" },
    );
    expect(r.tools.map((t) => t.fullName)).toEqual(["mcp:crm.query_contact", "mcp:crm.create_task"]);
    for (const t of r.tools) expect(AR.isMcpToolFullName(t.fullName)).toBe(true);
    expect(serverSlugOf("mcp-crm")).toBe("crm");
  });

  it("网关报一个保留命名空间的名字 ⇒ 构造被拒，不产生冲突记录", () => {
    expect(() => toContractTool("mcp-crm", { ...READ_TOOL, name: "graph.search" })).toThrow();
    // 反证：合法名不抛
    expect(() => toContractTool("mcp-crm", READ_TOOL)).not.toThrow();
  });

  it("网关不可达 / 超时 ⇒ 明确失败，且**不写入半截记录**", async () => {
    const { store, read } = storeOf();
    const unreachable: McpGateway = {
      listTools: async () => {
        throw new McpServerUnreachableError("mcp-eureg");
      },
    };
    await expect(
      discoverMcpTools({ gateway: unreachable, store }, { serverId: "mcp-eureg", endpoint: "e" }),
    ).rejects.toBeInstanceOf(McpServerUnreachableError);
    expect(read(), "失败后不该写入任何工具").toEqual([]);

    const timing: McpGateway = {
      listTools: async () => {
        throw new McpDiscoveryTimeoutError("mcp-eureg");
      },
    };
    await expect(
      discoverMcpTools({ gateway: timing, store }, { serverId: "mcp-eureg", endpoint: "e" }),
    ).rejects.toBeInstanceOf(McpDiscoveryTimeoutError);
    expect(read()).toEqual([]);
  });
});

describe("工具发现：变更集", () => {
  it("首次发现：全部进 added，其余为空", async () => {
    const { store, read } = storeOf();
    const r = await discoverMcpTools(
      { gateway: gatewayOf([READ_TOOL, WRITE_TOOL]), store },
      { serverId: "mcp-crm", endpoint: "e" },
    );
    expect(r.added).toHaveLength(2);
    expect(r.removed).toEqual([]);
    expect(r.signatureChanged).toEqual([]);
    expect(r.tightenedByCapRecheck).toEqual([]);
    expect(read()).toHaveLength(2);
  });

  it("重新发现且无变化 ⇒ 变更集全空（不会每次都报「变了」）", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL), toContractTool("mcp-crm", WRITE_TOOL)];
    const { store } = storeOf(prior);
    const r = await discoverMcpTools(
      { gateway: gatewayOf([READ_TOOL, WRITE_TOOL]), store },
      { serverId: "mcp-crm", endpoint: "e" },
    );
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.signatureChanged).toEqual([]);
  });

  it("签名变了 ⇒ 进 signatureChanged", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL)];
    const changed: DiscoveredTool = { ...READ_TOOL, signature: "query_contact(company: string) -> Contact[]" };
    const { store } = storeOf(prior);
    const r = await discoverMcpTools({ gateway: gatewayOf([changed]), store }, { serverId: "mcp-crm", endpoint: "e" });
    expect(r.signatureChanged).toEqual(["mcp:crm.query_contact"]);
    expect(r.added).toEqual([]);
  });

  it("工具消失 ⇒ 进 removed（不静默消失）", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL), toContractTool("mcp-crm", WRITE_TOOL)];
    const { store } = storeOf(prior);
    const r = await discoverMcpTools({ gateway: gatewayOf([READ_TOOL]), store }, { serverId: "mcp-crm", endpoint: "e" });
    expect(r.removed).toEqual(["mcp:crm.create_task"]);
  });

  it("指纹覆盖 sideEffect —— 只覆盖签名会漏掉 F130 ⑶ 要抓的那一种变化", () => {
    expect(fingerprint("f(x)", "只读")).not.toBe(fingerprint("f(x)", "写入外部"));
    expect(fingerprint("f(x)", "只读")).not.toBe(fingerprint("g(x)", "只读"));
    // 反证：完全相同的输入必须给出相同指纹，否则每次重发现都会误报
    expect(fingerprint("f(x)", "只读")).toBe(fingerprint("f(x)", "只读"));
  });
});

describe("I-21：新发现的工具不进任何白名单", () => {
  it("新工具的授权范围恒为「未开放」", async () => {
    const { store } = storeOf();
    const r = await discoverMcpTools({ gateway: gatewayOf([READ_TOOL]), store }, { serverId: "mcp-crm", endpoint: "e" });
    expect(r.tools[0]!.authScope).toBe(AR.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE);
    expect(r.tools[0]!.authScope).toBe("未开放");
  });

  it("已有工具的授权范围被**沿用**，不会被重新发现重置（重置也是一种静默变更）", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL, "全体成员")];
    const { store } = storeOf(prior);
    const r = await discoverMcpTools({ gateway: gatewayOf([READ_TOOL]), store }, { serverId: "mcp-crm", endpoint: "e" });
    expect(r.tools[0]!.authScope).toBe("全体成员");
  });

  it("结构性证据：本用例的依赖里根本没有白名单端口", () => {
    const deps = { gateway: gatewayOf([]), store: storeOf().store };
    expect(Object.keys(deps).sort()).toEqual(["gateway", "store"]);
  });
});

describe("🔴 F130 ⑶：sideEffect 变化必须当场重跑封顶并收紧", () => {
  it("只读 → 写入外部 的工具，授权范围被当场从「全体成员」夹到封顶", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL, "全体成员")];
    expect(prior[0]!.authScope, "前置：它此前确实是全体成员").toBe("全体成员");

    const nowWrites: DiscoveredTool = { ...READ_TOOL, sideEffect: "写入外部" };
    const { store } = storeOf(prior);
    const r = await discoverMcpTools({ gateway: gatewayOf([nowWrites]), store }, { serverId: "mcp-crm", endpoint: "e" });

    expect(r.tightenedByCapRecheck).toEqual([
      {
        toolFullName: "mcp:crm.query_contact",
        fromAuthScope: "全体成员",
        toAuthScope: "需人工确认每次",
        newSideEffect: "写入外部",
      },
    ]);
    expect(r.tools[0]!.authScope).toBe("需人工确认每次");
    expect(AR.checkToolScopeCap({ sideEffect: "写入外部", authScope: r.tools[0]!.authScope }).ok).toBe(true);
  });

  it("收紧结果满足契约的封顶判定 —— 夹到的是**最宽的合法档**，不是一律「未开放」", () => {
    expect(clampScopeToSideEffect("全体成员", "写入外部")).toBe("需人工确认每次");
    expect(clampScopeToSideEffect("全体成员", "对外发送")).toBe("需人工确认每次");
    // 已经合法的不动 —— 一个「一律收到最严」的实现会把正常配置也踩掉
    expect(clampScopeToSideEffect("全体成员", "只读")).toBe("全体成员");
    expect(clampScopeToSideEffect("未开放", "写入外部")).toBe("未开放");
    expect(clampScopeToSideEffect("需人工确认每次", "写入外部")).toBe("需人工确认每次");
  });

  it("反证：只在写路径校验、不在发现路径重跑，会留下「从只读那一侧走进来」的绕过", async () => {
    // 模拟漏掉 ⑶ 的实现：沿用旧范围，不重跑封顶
    const bypass = (previousScope: string) => previousScope;
    expect(bypass("全体成员")).toBe("全体成员");
    expect(AR.checkToolScopeCap({ sideEffect: "写入外部", authScope: "全体成员" }).ok).toBe(false);
    // 而正确实现不会留下这个状态
    const prior = [toContractTool("mcp-crm", READ_TOOL, "全体成员")];
    const { store } = storeOf(prior);
    const r = await discoverMcpTools(
      { gateway: gatewayOf([{ ...READ_TOOL, sideEffect: "写入外部" }]), store },
      { serverId: "mcp-crm", endpoint: "e" },
    );
    expect(AR.checkToolScopeCap({ sideEffect: "写入外部", authScope: r.tools[0]!.authScope }).ok).toBe(true);
  });

  it("没有 sideEffect 变化时 tightenedByCapRecheck 为空（不虚报）", async () => {
    const prior = [toContractTool("mcp-crm", READ_TOOL, "全体成员")];
    const { store } = storeOf(prior);
    const r = await discoverMcpTools({ gateway: gatewayOf([READ_TOOL]), store }, { serverId: "mcp-crm", endpoint: "e" });
    expect(r.tightenedByCapRecheck).toEqual([]);
  });
});

describe("响应形状受契约校验（返回方向不是断的）", () => {
  it("产物能被 discoverMcpTools.out 校验通过", async () => {
    const { store } = storeOf();
    const r = await discoverMcpTools(
      { gateway: gatewayOf([READ_TOOL, WRITE_TOOL]), store },
      { serverId: "mcp-crm", endpoint: "e" },
    );
    const parsed = AR.operations.discoverMcpTools.out.safeParse({
      tools: r.tools,
      added: r.added,
      removed: r.removed,
      signatureChanged: r.signatureChanged,
      tightenedByCapRecheck: r.tightenedByCapRecheck,
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("反证：响应体多带一个契约没描述的字段 ⇒ 校验失败", async () => {
    const { store } = storeOf();
    const r = await discoverMcpTools({ gateway: gatewayOf([READ_TOOL]), store }, { serverId: "mcp-crm", endpoint: "e" });
    const bad = AR.operations.discoverMcpTools.out.safeParse({
      tools: r.tools,
      added: r.added,
      removed: r.removed,
      signatureChanged: r.signatureChanged,
      tightenedByCapRecheck: r.tightenedByCapRecheck,
      credential: "sk-leaked",
    });
    expect(bad.success).toBe(false);
  });

  it("反证：漏掉 tightenedByCapRecheck ⇒ 校验失败（它是契约要求的字段，不是可选的额外信息）", async () => {
    const { store } = storeOf();
    const r = await discoverMcpTools({ gateway: gatewayOf([READ_TOOL]), store }, { serverId: "mcp-crm", endpoint: "e" });
    const bad = AR.operations.discoverMcpTools.out.safeParse({
      tools: r.tools, added: r.added, removed: r.removed, signatureChanged: r.signatureChanged,
    });
    expect(bad.success).toBe(false);
  });
});
