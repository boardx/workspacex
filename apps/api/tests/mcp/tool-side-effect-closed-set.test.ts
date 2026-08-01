import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";

/**
 * F129 (UC-21.1 R3 步骤 4 / domain I-28′) -- `McpTool.sideEffect` 是**三值闭集**，
 * 且带副作用的工具在授权范围上被**服务端强制封顶**（`checkToolScopeCap`）。
 *
 * ## 为什么闭集断言不是 `toHaveLength(3)`
 *
 * AGENTS.md 纪律第 9 条：断言的是「成员集合与契约逐字相等 ∧ 未声明的值不能通过 schema」，
 * 不是数量。`toHaveLength(3)` 在 `ToolSideEffect` 正当新增第四个值时一样会红，
 * 但它红的理由是错的——它挡的是「多了一个值」而不是「值不对」，一次疏忽的重命名
 * （比如把 `写入外部` 拼成 `写入外部数据`）在长度断言下完全不可见。
 *
 * ## I-28′ 的四格，缺一不算落地（domain.md 逐字）
 *
 * ⑴ 越界被拒 ⑵ ⭐ 合规值通过（这一格最容易被漏——「一律拒绝」的实现在只写 ⑴ 时全绿）
 * ⑶ 边界恰好 ⑷ `sideEffect` 变化时重新求值收紧（`discoverMcpTools`/F130 的落点，
 *   这里只钉 `checkToolScopeCap` 本身对新 `sideEffect` 重新判定得到的结果，
 *   不是重复测 F130 的重探测流程）。
 */

describe("F129 I-28′ · ToolSideEffect 三值闭集", () => {
  it("成员集合与契约逐字相等（不多不少）", () => {
    expect(new Set(A.ToolSideEffect.options)).toEqual(
      new Set(["只读", "对外发送", "写入外部"]),
    );
  });

  it("未声明的值不能通过 schema 解析（正向：合法值可以）", () => {
    for (const v of A.ToolSideEffect.options) {
      expect(A.ToolSideEffect.safeParse(v).success).toBe(true);
    }
    expect(A.ToolSideEffect.safeParse("只写").success).toBe(false);
    expect(A.ToolSideEffect.safeParse("readonly").success).toBe(false);
    expect(A.ToolSideEffect.safeParse("").success).toBe(false);
  });

  it("`McpTool.sideEffect` 与 `McpServer.involvesCustomerData` 是两个不同的键，不得合并（I-23 正交声明）", () => {
    const toolKeys = Object.keys(A.McpTool.shape);
    expect(toolKeys).toContain("sideEffect");
    expect(toolKeys).not.toContain("involvesCustomerData");
    const serverKeys = Object.keys(A.McpServerRow.shape);
    expect(serverKeys).toContain("involvesCustomerData");
    expect(serverKeys).not.toContain("sideEffect");
  });
});

describe("F129 I-28′ · checkToolScopeCap -- 带副作用工具的授权范围封顶（纯函数，四格）", () => {
  it("⑴ 越界被拒：`对外发送` × `全体成员`", () => {
    const r = A.checkToolScopeCap({ sideEffect: "对外发送", authScope: "全体成员" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP");
  });

  it("⑵ ⭐ 合规值通过：`对外发送` × `需人工确认每次`、`只读` × `全体成员`", () => {
    expect(A.checkToolScopeCap({ sideEffect: "对外发送", authScope: "需人工确认每次" }).ok).toBe(true);
    expect(A.checkToolScopeCap({ sideEffect: "只读", authScope: "全体成员" }).ok).toBe(true);
    expect(A.checkToolScopeCap({ sideEffect: "写入外部", authScope: "未开放" }).ok).toBe(true);
  });

  it("⑶ 边界恰好：`对外发送` × `仅项目负责人` 仍被拒（介于二者之间的范围一样越界）", () => {
    const r = A.checkToolScopeCap({ sideEffect: "对外发送", authScope: "仅项目负责人" });
    expect(r.ok).toBe(false);
  });

  it("⑷ `sideEffect` 变化时重新求值会收紧：同一个 `authScope` 在 `只读` 下合规、在 `写入外部` 下越界", () => {
    const wasOk = A.checkToolScopeCap({ sideEffect: "只读", authScope: "全体成员" });
    const nowOk = A.checkToolScopeCap({ sideEffect: "写入外部", authScope: "全体成员" });
    expect(wasOk.ok).toBe(true);
    expect(nowOk.ok).toBe(false);
  });

  it("未标注（视为最严）不给『默认只读』——把带副作用的语义传进去必须被拒，不能被悄悄当只读通过", () => {
    // `checkToolScopeCap` 不接受第四个"未标注"值（ToolSideEffect 是三值闭集，见上），
    // 这里断言的是：调用方没有第三条路可走——只有『只读』才拿到最宽松的封顶，
    // 任何带副作用的声明都会拿到最严的封顶，不存在中间态。
    const readOnlyCap = A.MAX_SCOPE_RANK_FOR_SIDE_EFFECT["只读"];
    const outboundCap = A.MAX_SCOPE_RANK_FOR_SIDE_EFFECT["对外发送"];
    const writeCap = A.MAX_SCOPE_RANK_FOR_SIDE_EFFECT["写入外部"];
    expect(readOnlyCap).toBeGreaterThan(outboundCap);
    expect(outboundCap).toBe(writeCap);
    expect(outboundCap).toBe(A.TOOL_AUTH_SCOPE_RANK["需人工确认每次"]);
  });
});
