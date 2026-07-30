/**
 * F52 backend: tool discovery, and the three-orthogonal-fields invariant on the WRITE side.
 *
 * The web-side tests prove the SHAPE keeps three dimensions. This one proves the write path
 * cannot collapse them: a probe timeout lands as `不可达`, and there is no code path from a
 * probe to `已隔离` at all.
 *
 * Every group carries a counter-proof -- an input that must fail. Without them a suite like
 * this is green against a stub that does nothing, which this project has hit nine times.
 */
import { describe, expect, it } from "vitest";
import { agentRuntime as AR } from "@repo/contracts";
import {
  callability,
  connectionStatusFromProbe,
  initialStatusOnRegister,
  isolatedByPolicy,
  violatesScopeOnRelease,
  type ProbeOutcome,
} from "../../src/domain/mcp/server-status";
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

const ALL_PROBES: ProbeOutcome[] = ["reachable", "rate-limited", "timeout", "auth-rejected"];

/* ── probe -> connection status ────────────────────────────────── */

describe("三正交字段的写入侧：探测结果不会被写成策略结果", () => {
  it("超时记为「不可达」，不是「已隔离」（UC-21.1 V18 / O-20）", () => {
    expect(connectionStatusFromProbe("timeout")).toBe("不可达");
    expect(connectionStatusFromProbe("timeout")).not.toBe("已隔离");
  });

  it("凭据被拒记为「凭据失效」，也不是「已隔离」", () => {
    expect(connectionStatusFromProbe("auth-rejected")).toBe("凭据失效");
  });

  it("**没有任何**探测结果能产出「已隔离」——隔离只由策略产生", () => {
    for (const o of ALL_PROBES) {
      expect(connectionStatusFromProbe(o), `探测 ${o} 产出了已隔离`).not.toBe("已隔离");
    }
    // 而策略那条路径确实存在，所以上面不是因为「根本没人写已隔离」而恒真
    expect(isolatedByPolicy()).toBe("已隔离");
  });

  it("四种探测结果映射到四个不同的、契约声明过的取值", () => {
    const mapped = ALL_PROBES.map(connectionStatusFromProbe);
    for (const m of mapped) expect(AR.McpConnectionStatus.safeParse(m).success).toBe(true);
    expect(new Set(mapped).size).toBe(ALL_PROBES.length);
  });

  it("反证：把 timeout 也映射成「已隔离」，两个来源就产出同一个值", () => {
    const collapsed = (o: ProbeOutcome) => (o === "timeout" ? "已隔离" : connectionStatusFromProbe(o));
    // 代价不是「取值变少」（仍是 4 个），而是拿到「已隔离」的人再也分不清
    // 这是策略隔离还是网络不通——排障方向完全相反。
    expect(collapsed("timeout")).toBe(isolatedByPolicy());
    expect(connectionStatusFromProbe("timeout")).not.toBe(isolatedByPolicy());
  });
});

describe("注册初始态（I-18）与放行前置（I-25）", () => {
  it("开关一为开 ⇒ 待安全评审 ∧ 已隔离，两个字段各自显式写入", () => {
    expect(initialStatusOnRegister(true)).toEqual({
      reviewStatus: "待安全评审",
      connectionStatus: "已隔离",
    });
  });

  it("开关一为关时评审状态**不变**（它不是连接状态的函数）", () => {
    expect(initialStatusOnRegister(false).reviewStatus).toBe("待安全评审");
    expect(initialStatusOnRegister(false).connectionStatus).toBe("已连接");
  });

  it("「已放行但授权范围未定」被判违规", () => {
    expect(violatesScopeOnRelease({ reviewStatus: "已放行", authScope: null })).toBe(true);
    expect(violatesScopeOnRelease({ reviewStatus: "已放行", authScope: "全体成员" })).toBe(false);
    // 反证：未放行的行不受这条约束，否则它会拦下正常的待评审记录
    expect(violatesScopeOnRelease({ reviewStatus: "待安全评审", authScope: null })).toBe(false);
  });
});

describe("拒绝时说得出是哪一维（正交的操作性收益）", () => {
  it("未评审 ⇒ 卡在 reviewStatus，即便网络完全正常", () => {
    const r = callability({ reviewStatus: "待安全评审", connectionStatus: "已连接" });
    expect(r.callable).toBe(false);
    expect(r.callable === false && r.blockedBy).toBe("reviewStatus");
  });

  it("已放行但不可达 ⇒ 卡在 connectionStatus，不会被说成「没评审」", () => {
    const r = callability({ reviewStatus: "已放行", connectionStatus: "不可达" });
    expect(r.callable).toBe(false);
    expect(r.callable === false && r.blockedBy).toBe("connectionStatus");
    expect(r.callable === false && r.detail).toBe("不可达");
  });

  it("「已到期待复核」卡在评审维 —— 它不是「待安全评审」的同义词，但拦的是同一层", () => {
    const r = callability({ reviewStatus: "已到期待复核", connectionStatus: "已连接" });
    expect(r.callable === false && r.blockedBy).toBe("reviewStatus");
    expect(r.callable === false && r.detail).toBe("已到期待复核");
  });

  it("限流中仍可调用（限流不是不可用）", () => {
    expect(callability({ reviewStatus: "已放行", connectionStatus: "限流中" }).callable).toBe(true);
  });

  it("反证：把两维压成一个布尔，就答不出「为什么用不了」", () => {
    const merged = (s: { reviewStatus: string; connectionStatus: string }) =>
      s.reviewStatus === "已放行" && s.connectionStatus === "已连接";
    // 两个原因完全不同的行，压缩后给出同一个答案
    expect(merged({ reviewStatus: "待安全评审", connectionStatus: "已连接" })).toBe(false);
    expect(merged({ reviewStatus: "已放行", connectionStatus: "不可达" })).toBe(false);
  });
});

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
