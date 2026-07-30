/**
 * F52：**工具以 `mcp:<服务器>.<工具>` 命名空间登记，与内建 `graph.*` / `brain.*` 可区分；
 * 每个工具记函数签名与参数 schema**（domain I-20 / I-23）。
 *
 * ## 这条不变量此前没有任何东西守
 *
 * `McpTool.fullName` 在契约里是裸 `z.string()`，而它上方的注释逐字写着「全名恒为
 * `mcp:<服务器>.<工具>`（I-20）」。**注释不是门。** F52 追加了构造/解析/判定三个纯函数
 * 与一条正则（`packages/contracts/src/agent-runtime.ts` 的「🟢 F52 追加」段，纯新增），
 * 本文件把它们钉住。
 *
 * 为什么非守不可：三层权限的第 ② 层（agent 工具白名单）按**全名**存。全名一旦有第二套
 * 拼法，白名单里会出现两条指向同一个工具的记录，其中一条永远命中不了——于是
 * 「我明明授权了」和「它调不到」可以同时为真，而两边数据各自自洽。
 *
 * ## 反证
 *
 * 每组正面断言配一组「必然失败的变体」：非法全名、保留前缀、手拼全名、缺签名的工具。
 * 没有它们，正则断言可能对任何输入都成立。
 */
import { describe, expect, it } from "vitest";
import * as AR from "@repo/contracts/agent-runtime";

/** 一个满足契约的工具，作为各条断言的正面样本 */
function toolOf(serverSlug: string, name: string, over: Partial<Record<string, unknown>> = {}) {
  return AR.McpTool.parse({
    fullName: AR.mcpToolFullName(serverSlug, name),
    serverId: `mcp-${serverSlug}`,
    signature: `${name}(company?: string) -> Contact[]`,
    schemaFingerprint: `fp-${name}`,
    sideEffect: "只读",
    authScope: AR.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE,
    ...over,
  });
}

const SAMPLE = [
  toolOf("crm", "query_contact"),
  toolOf("crm", "create_task", { sideEffect: "写入外部" }),
  toolOf("data", "search_market"),
  toolOf("eu-reg", "search_regulation"),
];

describe("工具全名的格式恒为 mcp:<服务器>.<工具>", () => {
  it("每个工具的全名都满足契约的正则，且整体通过 McpTool 校验", () => {
    expect(SAMPLE.length).toBeGreaterThan(3); // 防止下面的循环对空数组恒真
    for (const t of SAMPLE) {
      expect(AR.MCP_TOOL_FULL_NAME_RE.test(t.fullName), `不合法：${t.fullName}`).toBe(true);
      expect(AR.McpTool.safeParse(t).success).toBe(true);
    }
  });

  it("全名以契约声明的前缀开头", () => {
    for (const t of SAMPLE) expect(t.fullName.startsWith(AR.MCP_TOOL_NAMESPACE_PREFIX)).toBe(true);
  });

  it("解析可逆：parse(fullName) 还原出的两段能拼回原串", () => {
    for (const t of SAMPLE) {
      const parsed = AR.parseMcpToolFullName(t.fullName);
      expect(parsed, `解析不出来：${t.fullName}`).not.toBeNull();
      expect(AR.mcpToolFullName(parsed!.serverSlug, parsed!.toolName)).toBe(t.fullName);
    }
  });

  it("分隔符是第一个 `.`：服务器段含短横线时仍能正确切分", () => {
    const parsed = AR.parseMcpToolFullName("mcp:eu-reg.search_regulation");
    expect(parsed).toEqual({ serverSlug: "eu-reg", toolName: "search_regulation" });
  });

  it("全名唯一（白名单按全名存，重名等于授权歧义）", () => {
    const names = SAMPLE.map((t) => t.fullName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("反证：这些形状必须被拒 —— 少前缀 / 少分隔符 / 大写 / 空段 / 多余空白", () => {
    const illegal = [
      "crm.query_contact",       // 少了 mcp: 前缀
      "mcp:crm_query_contact",   // 少了 . 分隔符
      "mcp:CRM.query_contact",   // 大写服务器段
      "mcp:.query_contact",      // 空服务器段
      "mcp:crm.",                // 空工具段
      "mcp:crm.query contact",   // 含空格
      " mcp:crm.query_contact",  // 前导空白
      "mcp:crm.query_contact ",  // 尾随空白
      "graph.search_nodes",      // 保留命名空间
      "",                        // 空串
    ];
    for (const bad of illegal) {
      expect(AR.isMcpToolFullName(bad), `本该被拒却通过了：「${bad}」`).toBe(false);
      expect(AR.parseMcpToolFullName(bad), `本该解析不出却出来了：「${bad}」`).toBeNull();
    }
  });

  it("反证：构造入口对非法输入抛错，而不是拼出一个坏名字", () => {
    expect(() => AR.mcpToolFullName("CRM", "query_contact")).toThrow();
    expect(() => AR.mcpToolFullName("crm", "query contact")).toThrow();
    expect(() => AR.mcpToolFullName("", "x")).toThrow();
    expect(() => AR.mcpToolFullName("crm", "")).toThrow();
    // 正面：合法输入不抛
    expect(AR.mcpToolFullName("crm", "query_contact")).toBe("mcp:crm.query_contact");
  });
});

describe("与内建命名空间不相交", () => {
  const RESERVED = ["graph.search_nodes", "graph.expand", "brain.recall", "brain.summarize"];

  it("保留命名空间的工具一个都不被判为 MCP 工具", () => {
    for (const b of RESERVED) {
      expect(AR.isReservedToolFullName(b)).toBe(true);
      expect(AR.isMcpToolFullName(b)).toBe(false);
    }
  });

  it("MCP 工具一个都不被判为保留命名空间 —— 两个集合交集为空", () => {
    for (const t of SAMPLE) {
      expect(AR.isReservedToolFullName(t.fullName), `被误判为内建：${t.fullName}`).toBe(false);
      expect(AR.isMcpToolFullName(t.fullName)).toBe(true);
    }
    expect(SAMPLE.map((t) => t.fullName).filter((n) => RESERVED.includes(n))).toEqual([]);
  });

  it("两个判定互斥：不存在同时为真的字符串", () => {
    const probes = [...RESERVED, ...SAMPLE.map((t) => t.fullName), "mcp:graph.x", "graph.mcp_x"];
    for (const p of probes) {
      expect(AR.isMcpToolFullName(p) && AR.isReservedToolFullName(p), `两者同时为真：${p}`).toBe(false);
    }
  });

  it("反证：保留前缀表非空且就是那两个 —— 否则「交集为空」可能因表为空而恒真", () => {
    expect([...AR.RESERVED_TOOL_NAMESPACE_PREFIXES]).toEqual(["graph.", "brain."]);
    expect(AR.isMcpToolFullName("graph.anything")).toBe(false);
    expect(AR.isMcpToolFullName("brain.anything")).toBe(false);
  });

  it("一台叫 `graph` 的 MCP 服务器不会污染保留命名空间", () => {
    // 它的全名是 `mcp:graph.x`，仍以 mcp: 开头，不与 `graph.x` 冲突
    const t = AR.mcpToolFullName("graph", "search");
    expect(t).toBe("mcp:graph.search");
    expect(AR.isReservedToolFullName(t)).toBe(false);
    expect(t).not.toBe("graph.search");
  });
});

describe("每个工具记函数签名与指纹", () => {
  it("契约要求 signature 与 schemaFingerprint，缺任一即不合法", () => {
    const ok = SAMPLE[0]!;
    expect(AR.McpTool.safeParse(ok).success).toBe(true);
    const { signature: _s, ...noSignature } = ok;
    expect(AR.McpTool.safeParse(noSignature).success).toBe(false);
    const { schemaFingerprint: _f, ...noFingerprint } = ok;
    expect(AR.McpTool.safeParse(noFingerprint).success).toBe(false);
  });

  it("签名里出现工具名，不是一句占位文案", () => {
    for (const t of SAMPLE) {
      const name = AR.parseMcpToolFullName(t.fullName)!.toolName;
      expect(t.signature, `签名与工具名对不上：${t.fullName}`).toContain(name);
    }
  });

  it("反证：全名不合法的工具即便其余字段齐全也不该被当成合法记录", () => {
    // ⚠ 契约的 `fullName` 目前是裸 z.string()，所以 zod **不会**拒——
    //    这正是 F52 追加纯函数的理由。写入路径必须自己调判定。
    const smuggled = { ...SAMPLE[0]!, fullName: "crm.query_contact" };
    expect(AR.McpTool.safeParse(smuggled).success, "契约收紧了 fullName？那这条注释该更新").toBe(true);
    expect(AR.isMcpToolFullName(smuggled.fullName), "而判定必须拦下它").toBe(false);
  });
});

describe("「涉客户数据」按服务器整体标注，工具级不存在（I-23 / O-19）", () => {
  it("McpServerRow 有这个字段", () => {
    expect(Object.keys(AR.McpServerRow.shape)).toContain("involvesCustomerData");
  });

  it("McpTool **没有**这个字段，且塞进去会被拒（strict）", () => {
    expect(Object.keys(AR.McpTool.shape)).not.toContain("involvesCustomerData");
    expect(AR.McpTool.safeParse({ ...SAMPLE[0]!, involvesCustomerData: true }).success).toBe(false);
  });

  it("工具级有的是 `sideEffect`，它与服务器级的「涉客户数据」是两回事，不得合并", () => {
    expect(Object.keys(AR.McpTool.shape)).toContain("sideEffect");
    // 反证：两者取值域完全不同，压不到一起
    expect(AR.ToolSideEffect.safeParse(true).success).toBe(false);
    expect([...AR.ToolSideEffect.options]).toEqual(["只读", "对外发送", "写入外部"]);
  });
});

describe("新发现的工具默认不进任何白名单（I-21）", () => {
  it("默认授权范围恒为「未开放」，且它是全序里最低的一档", () => {
    expect(AR.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE).toBe("未开放");
    const ranks = AR.ToolAuthScope.options.map((s) => AR.TOOL_AUTH_SCOPE_RANK[s]);
    expect(AR.TOOL_AUTH_SCOPE_RANK["未开放"]).toBe(Math.min(...ranks));
  });

  it("反证：默认值若是「全体成员」，权限会在每次重新发现时静默扩大", () => {
    expect(AR.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE).not.toBe("全体成员");
    expect(AR.TOOL_AUTH_SCOPE_RANK[AR.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE]).toBe(0);
  });

  it("默认值通过副作用封顶的最严情形 —— 一个连自己默认值都过不了的封顶是坏的", () => {
    for (const se of AR.ToolSideEffect.options) {
      expect(
        AR.checkToolScopeCap({ sideEffect: se, authScope: AR.NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE }).ok,
      ).toBe(true);
    }
  });
});
