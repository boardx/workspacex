/**
 * F52 的核心不变量：**授权范围 / 评审状态 / 连接状态是三个正交字段，不许合并**
 * （domain I-17 / UC-21.1 V18 / O-20）。
 *
 * ## 「不许合并」怎么写成断言
 *
 * 「它们是三个字段」这句话几乎无法证伪——任何实现都摆得出三个键。
 * 真正要证的是**不可推导性**：不存在函数 `f(授权范围, 评审状态) = 连接状态`，
 * 另外两个方向同理。等价说法是：任意两维固定时，第三维仍能取到多于一个值。
 * 这个性质对 5×5×5 = 125 个组合逐个可查，本文件就这么查。
 *
 * 为什么值得这么较真：三者的**性质**不同——授权范围是配置、评审状态是流程、
 * 连接状态是运行事实。压成一个枚举以后，「为什么这个工具用不了」就没有答案了，
 * 因为「已隔离」（策略）和「不可达」（网络）指向完全不同的排障动作。
 *
 * ## 反证在文件里，不在提交历史里
 *
 * 每组断言后面跟一个 `反证` 用例：把同一套检查跑在一个**故意合并过的**数据集上，
 * 断言它会被判为不正交。没有这一步，上面那些 `expect` 有可能对**任何**输入都成立，
 * 整个文件就是在空转——本仓已九次踩到「全绿但空转」。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as AR from "@repo/contracts/agent-runtime";
import { CONTRACT_DIVERGENCES } from "@/lib/contract-divergences";

const AUTH = AR.ToolAuthScope.options;
const REVIEW = AR.McpReviewStatus.options;
const CONN = AR.McpConnectionStatus.options;

/** 一行合法的服务器，除三个正交字段外的部分固定不变 */
function rowWith(
  authScope: (typeof AUTH)[number],
  reviewStatus: (typeof REVIEW)[number],
  connectionStatus: (typeof CONN)[number],
) {
  return {
    serverId: "mcp-x",
    name: "某服务器",
    description: "第三方 · 未审计",
    endpointHint: "内网" as const,
    authScope,
    reviewStatus,
    connectionStatus,
    quarantineUntil: null,
    involvesCustomerData: false,
    isEgress: false,
  };
}

/**
 * 正交性检查器 —— **写成函数是为了能把它指向别的东西**。
 *
 * 输入一个「三元组集合」，输出「哪一维可被另外两维推导出来」。
 * 返回空数组 = 三者互不可推导 = 正交。
 */
function derivableDimensions(
  triples: readonly (readonly [string, string, string])[],
): string[] {
  const bad: string[] = [];
  for (let target = 0; target < 3; target++) {
    const others = [0, 1, 2].filter((i) => i !== target);
    const buckets = new Map<string, Set<string>>();
    for (const t of triples) {
      const key = others.map((i) => t[i]!).join("¦");
      if (!buckets.has(key)) buckets.set(key, new Set());
      buckets.get(key)!.add(t[target]!);
    }
    // 每个「另外两维」的取值组合下，目标维只要恒为单值，它就是那两维的函数
    if ([...buckets.values()].every((s) => s.size === 1)) {
      bad.push(AR.MCP_ORTHOGONAL_FIELDS[target]!);
    }
  }
  return bad;
}

const ALL_TRIPLES = AUTH.flatMap((a) =>
  REVIEW.flatMap((r) => CONN.map((c) => [a, r, c] as const)),
);

describe("三个正交字段：结构", () => {
  it("契约把三者声明为并列的三个键，且 MCP_ORTHOGONAL_FIELDS 与之逐字一致", () => {
    const keys = Object.keys(AR.McpServerRow.shape);
    for (const f of AR.MCP_ORTHOGONAL_FIELDS) expect(keys).toContain(f);
    // 反向：登记表不许多写也不许少写，否则它自己就是第二份会漂移的事实
    expect([...AR.MCP_ORTHOGONAL_FIELDS].sort()).toEqual([
      "authScope", "connectionStatus", "reviewStatus",
    ]);
  });

  it("三个枚举的取值集合两两不相交 —— 一个值不可能被误读成属于另一维", () => {
    const sets = [new Set<string>(AUTH), new Set<string>(REVIEW), new Set<string>(CONN)];
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const overlap = [...sets[i]!].filter((v) => sets[j]!.has(v));
        expect(overlap, `第 ${i} 维与第 ${j} 维取值重叠：${overlap.join(",")}`).toEqual([]);
      }
    }
  });

  it("「维持隔离」是评审结论，「已隔离」是连接状态 —— 两个不同的字面量、两个不同的字段", () => {
    expect(REVIEW).toContain("维持隔离");
    expect(CONN).toContain("已隔离");
    expect(REVIEW as readonly string[]).not.toContain("已隔离");
    expect(CONN as readonly string[]).not.toContain("维持隔离");
  });

  it("「不可达」与「凭据失效」各自独立成档，不被折进「已隔离」（UC-21.1 V18 / O-20）", () => {
    expect(CONN).toContain("不可达");
    expect(CONN).toContain("凭据失效");
    expect(new Set(CONN).size).toBe(CONN.length);
  });

  it("行 schema 是 strict 的：任何「合并出来的第三方状态字段」当场被拒", () => {
    const merged = { ...rowWith("全体成员", "待安全评审", "不可达"), status: "已隔离" };
    expect(AR.McpServerRow.safeParse(merged).success).toBe(false);
  });

  it("枚举的封闭性被守住：未声明的值不能通过（不断言成员个数，见 coding-standards E-4）", () => {
    expect(AR.McpConnectionStatus.safeParse("维持隔离").success).toBe(false);
    expect(AR.McpConnectionStatus.safeParse("offline").success).toBe(false);
    expect(AR.McpReviewStatus.safeParse("不可达").success).toBe(false);
    expect(AR.ToolAuthScope.safeParse("everyone").success).toBe(false);
    // 正面：每个声明过的成员都通过
    for (const v of CONN) expect(AR.McpConnectionStatus.safeParse(v).success).toBe(true);
    for (const v of REVIEW) expect(AR.McpReviewStatus.safeParse(v).success).toBe(true);
    for (const v of AUTH) expect(AR.ToolAuthScope.safeParse(v).success).toBe(true);
  });
});

describe(`三个正交字段：不可推导性（${AUTH.length}×${REVIEW.length}×${CONN.length} 个组合逐个）`, () => {
  it("每个组合**全部合法** —— 任意两维相同而第三维不同的行都能存在", () => {
    expect(ALL_TRIPLES).toHaveLength(AUTH.length * REVIEW.length * CONN.length);
    const rejected = ALL_TRIPLES.filter(
      ([a, r, c]) => !AR.McpServerRow.safeParse(rowWith(a, r, c)).success,
    );
    expect(rejected, `这些组合被拒了，说明字段之间有隐含耦合：${JSON.stringify(rejected)}`).toEqual([]);
  });

  it("三维互不为另外两维的函数", () => {
    expect(derivableDimensions(ALL_TRIPLES)).toEqual([]);
  });

  it("逐维给出具体反例：固定另外两维，第三维仍能取到 ≥2 个值", () => {
    // 目标 = connectionStatus：固定「全体成员 ∧ 待安全评审」
    expect(AR.McpServerRow.parse(rowWith("全体成员", "待安全评审", "不可达")).connectionStatus).toBe("不可达");
    expect(AR.McpServerRow.parse(rowWith("全体成员", "待安全评审", "已隔离")).connectionStatus).toBe("已隔离");
    // 目标 = reviewStatus：固定「全体成员 ∧ 已连接」
    expect(AR.McpServerRow.parse(rowWith("全体成员", "已放行", "已连接")).reviewStatus).toBe("已放行");
    expect(AR.McpServerRow.parse(rowWith("全体成员", "已到期待复核", "已连接")).reviewStatus).toBe("已到期待复核");
    // 目标 = authScope：固定「已放行 ∧ 已连接」
    expect(AR.McpServerRow.parse(rowWith("全体成员", "已放行", "已连接")).authScope).toBe("全体成员");
    expect(AR.McpServerRow.parse(rowWith("未开放", "已放行", "已连接")).authScope).toBe("未开放");
  });

  it("反证：把连接状态做成「评审状态的函数」，检查器必须判它可推导", () => {
    // 故意合并：评审通过就写「已连接」，否则写「已隔离」——正是 O-20 禁止的那种压缩
    const merged = AUTH.flatMap((a) =>
      REVIEW.map((r) => [a, r, r === "已放行" ? "已连接" : "已隔离"] as const),
    );
    expect(derivableDimensions(merged)).toContain("connectionStatus");
  });

  it("反证：只用「已隔离」而不用「不可达」的数据集，会让 connectionStatus 退化", () => {
    const collapsed = AUTH.flatMap((a) => REVIEW.map((r) => [a, r, "已隔离"] as const));
    expect(derivableDimensions(collapsed)).toContain("connectionStatus");
  });

  it("反证：检查器在「确实正交」与「确实合并」两种输入上给出不同答案", () => {
    expect(derivableDimensions(ALL_TRIPLES)).toEqual([]);
    expect(derivableDimensions([["全体成员", "已放行", "已连接"]])).toHaveLength(3);
  });
});

describe("O-20 点名的那台服务器：全体成员 ∧ 待安全评审 ∧ 不可达", () => {
  const witness = AR.McpServerRow.parse(rowWith("全体成员", "待安全评审", "不可达"));

  it("三字段各自读回原值，无一维度丢失", () => {
    expect(witness.authScope).toBe("全体成员");
    expect(witness.reviewStatus).toBe("待安全评审");
    expect(witness.connectionStatus).toBe("不可达");
  });

  it("「不可达」没有被写成「已隔离」，「待安全评审」也没有被写成「维持隔离」", () => {
    expect(witness.connectionStatus).not.toBe("已隔离");
    expect(witness.reviewStatus).not.toBe("维持隔离");
  });

  it("三个值来自三个不同的枚举 —— 互换任意两个都解析失败", () => {
    expect(AR.McpServerRow.safeParse({ ...witness, connectionStatus: "待安全评审" }).success).toBe(false);
    expect(AR.McpServerRow.safeParse({ ...witness, reviewStatus: "不可达" }).success).toBe(false);
    expect(AR.McpServerRow.safeParse({ ...witness, authScope: "已连接" }).success).toBe(false);
  });
});

describe("三层权限第 ① 层与副作用封顶是**两条独立的门**（I-28′ / I-29′）", () => {
  /**
   * 这两条不属于「三正交」，但它们是同一种错误的另一面：
   * 把两条门合成一条，同样会让一侧全绿。契约已提供纯函数，这里钉住两者不可互相替代。
   */
  it("服务器上限之内、却越了副作用封顶 ⇒ 仍被拒", () => {
    expect(AR.checkToolScopeWithinServer({ serverScope: "全体成员", toolScope: "全体成员" }).ok).toBe(true);
    expect(AR.checkToolScopeCap({ sideEffect: "写入外部", authScope: "全体成员" }).ok).toBe(false);
  });

  it("副作用封顶之内、却越了服务器上限 ⇒ 仍被拒", () => {
    expect(AR.checkToolScopeCap({ sideEffect: "只读", authScope: "全体成员" }).ok).toBe(true);
    expect(AR.checkToolScopeWithinServer({ serverScope: "仅某团队", toolScope: "全体成员" }).ok).toBe(false);
  });

  it("反证：服务器全体成员 + 工具全体成员 **允许** —— 否则「一律更严」的实现会让越界侧全绿", () => {
    expect(AR.checkToolScopeWithinServer({ serverScope: "全体成员", toolScope: "全体成员" }).ok).toBe(true);
  });
});

describe("契约五档 vs 视图两档：登记为分歧 D03，不由 agent 选边", () => {
  it("D03 仍在登记簿里", () => {
    const d = CONTRACT_DIVERGENCES.D03;
    expect(d, "D03 不见了——要么被裁掉了（那就该连同这条断言一起删），要么被人静默去掉").toBeDefined();
    expect(d.contractType).toBe("McpReviewStatus");
  });

  it("D03 记的契约取值与契约**当前实际**一致（登记簿不许自己漂移）", () => {
    expect([...CONTRACT_DIVERGENCES.D03.contractValues]).toEqual([...REVIEW]);
  });

  it("D03 描述的分歧**当前确实存在**（登记项不许变成免责声明）", () => {
    // 一旦有人把视图补齐到五态、或把契约收窄到两态，这里会红，逼他来删掉 D03
    expect(CONTRACT_DIVERGENCES.D03.viewValues.length).toBeLessThan(REVIEW.length);
  });

  it("F52 没有替人裁：既没收窄契约，也没把视图合并进契约", () => {
    // 契约保持五档
    expect(REVIEW.length).toBe(5);
    // 视图侧仍是自己的类型名（改名而非合并，见登记簿 §③ 类处置）
    expect(CONTRACT_DIVERGENCES.D03.viewType).toBe("McpReviewStatusView");
  });
});

describe("这个文件本身不是空转", () => {
  it("三个枚举都真的读到了成员（读到空数组会让上面几乎所有循环恒真）", () => {
    expect(AUTH.length).toBeGreaterThan(1);
    expect(REVIEW.length).toBeGreaterThan(1);
    expect(CONN.length).toBeGreaterThan(1);
    expect(ALL_TRIPLES.length).toBe(AUTH.length * REVIEW.length * CONN.length);
  });

  it("契约的三个枚举确实是 zod 枚举（不是被谁换成了裸字符串数组）", () => {
    expect(AR.ToolAuthScope).toBeInstanceOf(z.ZodEnum);
    expect(AR.McpReviewStatus).toBeInstanceOf(z.ZodEnum);
    expect(AR.McpConnectionStatus).toBeInstanceOf(z.ZodEnum);
  });
});
