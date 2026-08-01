import { describe, expect, it } from "vitest";
import { agentRuntime as A } from "@repo/contracts";

/**
 * F129 (domain §B `ToolAuthScope` + I-28′/I-29′) -- 逐工具授权范围的**五值闭集**，
 * 落成**显式序数常量**的全序，不靠字符串比较。
 *
 * ## 为什么"不靠字符串比较"要专门测
 *
 * 字符串比较（比如 `scope === "全体成员" || scope === "仅某团队"`）在契约新增一个
 * 六等值时**不会报错**——它只是悄悄把新值分类到某一侧，通不通过全看写的人有没有想到
 * 要改这段 if/else。`TOOL_AUTH_SCOPE_RANK` 是 `satisfies Record<ToolAuthScopeT, number>`，
 * `ToolAuthScope` 加一个值而这张表没跟着改，`tsc` 立刻红——这正是这份测试要钉住的属性，
 * 而不仅仅是"5 个值都在"。
 *
 * ## `需人工确认每次` 排在 `仅项目负责人` 之下是裁决，不是自然序
 *
 * 前三者（全体成员/仅某团队/仅项目负责人）答的是"谁可以"，`需人工确认每次`答的是
 * "每次都要人点"——domain.md 逐字这是人为排序，这份测试把这条裁决钉成断言，
 * 而不是留给下一个人凭直觉重排。
 */

describe("F129 · ToolAuthScope 五值闭集", () => {
  it("成员集合与契约逐字相等（不多不少）", () => {
    expect(new Set(A.ToolAuthScope.options)).toEqual(
      new Set(["全体成员", "仅某团队", "仅项目负责人", "需人工确认每次", "未开放"]),
    );
  });

  it("未声明的值不能通过 schema 解析", () => {
    for (const v of A.ToolAuthScope.options) {
      expect(A.ToolAuthScope.safeParse(v).success).toBe(true);
    }
    expect(A.ToolAuthScope.safeParse("仅安全评审人").success).toBe(false);
    expect(A.ToolAuthScope.safeParse("all").success).toBe(false);
  });

  it("比 O-20 的服务器级三值多两个：`需人工确认每次` / `未开放`", () => {
    const serverThreeValues = ["全体成员", "仅某团队", "仅项目负责人"];
    const extra = A.ToolAuthScope.options.filter((v) => !serverThreeValues.includes(v));
    expect(new Set(extra)).toEqual(new Set(["需人工确认每次", "未开放"]));
  });
});

describe("F129 · TOOL_AUTH_SCOPE_RANK -- 显式序数常量的全序", () => {
  it("每个值都有一个序数，且序数集合与 ToolAuthScope 成员集合一一对应（编译期 satisfies 之外的运行期复核）", () => {
    const ranked = Object.keys(A.TOOL_AUTH_SCOPE_RANK);
    expect(new Set(ranked)).toEqual(new Set(A.ToolAuthScope.options));
  });

  it("五个序数互不相等 -- 全序而非偏序（没有并列）", () => {
    const ranks = Object.values(A.TOOL_AUTH_SCOPE_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("裁定的顺序逐字：全体成员 > 仅某团队 > 仅项目负责人 > 需人工确认每次 > 未开放", () => {
    const R = A.TOOL_AUTH_SCOPE_RANK;
    expect(R["全体成员"]).toBeGreaterThan(R["仅某团队"]);
    expect(R["仅某团队"]).toBeGreaterThan(R["仅项目负责人"]);
    expect(R["仅项目负责人"]).toBeGreaterThan(R["需人工确认每次"]);
    expect(R["需人工确认每次"]).toBeGreaterThan(R["未开放"]);
  });

  it("排序不靠字符串比较：按 rank 数值排序恰好还原上面那条链，且与 Array.prototype.sort 的默认（字典序）排列不同", () => {
    const byRank = [...A.ToolAuthScope.options].sort(
      (a, b) => A.TOOL_AUTH_SCOPE_RANK[b] - A.TOOL_AUTH_SCOPE_RANK[a],
    );
    expect(byRank).toEqual(["全体成员", "仅某团队", "仅项目负责人", "需人工确认每次", "未开放"]);

    // 反证：若真的退化为字符串比较（本地默认字典序），得到的顺序不是上面这条——
    // 用这条差异证明"排序结果正确"不是巧合，而是确实读了 rank 表。
    const byLexicographic = [...A.ToolAuthScope.options].sort();
    expect(byLexicographic).not.toEqual(byRank);
  });
});
