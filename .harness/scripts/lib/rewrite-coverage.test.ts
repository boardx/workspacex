// rewrite-coverage.test.ts — #539 的反证。
//
// ⚠ 这些用例**全部喂固定 fixture**，不读仓库真实文件。理由是 coord-main 今天刚踩过的坑：
// 看板那条钉子在 CI 里是空转的——CI 没有 `gh` 认证 ⇒ 拿到零个 issue ⇒ 被断言的那条
// 缺省分支**根本走不到** ⇒ 修没修都是同一个结果。
// 喂 fixture 保证每条判断在任何环境下都真的被执行到。
// 对真实仓库的扫描由 lint-rewrite-coverage.mjs 承担，那是另一回事。
import { describe, expect, it } from "vitest";
import {
  analyzeRewriteCoverage,
  extractRewrites,
  extractRoutes,
  staleAllowlistEntries,
  type CoverageInput,
} from "./rewrite-coverage";

/** 本仓 34 个 controller 里 33 个是这种：空前缀，完整路径在方法装饰器上。 */
const EMPTY_PREFIX_CONTROLLER = `
@Controller()
export class AgentRunController {
  @Post("/agent-runs")
  create() {}
  @Get("/agent-runs/:id")
  read() {}
}
`;

/** 另一种：controller 上带前缀。 */
const PREFIXED_CONTROLLER = `
@Controller("/kernel/probe")
export class ProbeController {
  @Get("/identity-session")
  probe() {}
}
`;

const FULL_CONFIG = `
return [
  { source: \`\${prefix}/agent-runs\`, destination: \`\${apiOrigin}/agent-runs\` },
  { source: \`\${prefix}/agent-runs/:path*\`, destination: \`\${apiOrigin}/agent-runs/:path*\` },
  { source: \`\${prefix}/kernel/:path*\`, destination: \`\${apiOrigin}/kernel/:path*\` },
];
`;

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    controllers: [
      { file: "agent-run.controller.ts", source: EMPTY_PREFIX_CONTROLLER },
      { file: "probe.controller.ts", source: PREFIXED_CONTROLLER },
    ],
    nextConfig: FULL_CONFIG,
    allowlist: [],
    ...over,
  };
}

describe("#539 抽取：两种 controller 形态都要认", () => {
  it("空前缀 controller —— 路径全在方法装饰器上（本仓 33/34 是这种，第四次事故栽在这里）", () => {
    const routes = extractRoutes(EMPTY_PREFIX_CONTROLLER, "f.ts");
    expect(routes.map((r) => r.path)).toEqual(["/agent-runs", "/agent-runs/:id"]);
    expect(routes.map((r) => r.head)).toEqual(["agent-runs", "agent-runs"]);
    expect(routes.map((r) => r.bare)).toEqual([true, false]);
  });

  it("带前缀 controller —— 前缀与方法路径拼接", () => {
    const routes = extractRoutes(PREFIXED_CONTROLLER, "f.ts");
    expect(routes[0]!.path).toBe("/kernel/probe/identity-session");
    expect(routes[0]!.head).toBe("kernel");
    expect(routes[0]!.bare).toBe(false);
  });

  it("rewrites 区分裸路径与深路径", () => {
    const { bare, deep } = extractRewrites(FULL_CONFIG);
    expect([...bare]).toEqual(["agent-runs"]);
    expect([...deep].sort()).toEqual(["agent-runs", "kernel"]);
  });
});

describe("#539 反证：删掉 rewrite 必须红", () => {
  it("基线全覆盖时没有缺口（否则下面的反证全是空转）", () => {
    const report = analyzeRewriteCoverage(input());
    expect(report.incomplete).toBe(false);
    expect(report.gaps).toEqual([]);
  });

  it("🔴 删掉整个前缀的两条 rewrite → 报缺口", () => {
    const nextConfig = FULL_CONFIG.split("\n").filter((l) => !l.includes("/agent-runs")).join("\n");
    const report = analyzeRewriteCoverage(input({ nextConfig }));
    expect(report.gaps.map((g) => `${g.head}:${g.kind}`).sort()).toEqual(["agent-runs:bare", "agent-runs:deep"]);
  });

  it("🔴 只删「裸路径」那一条、留着 `:path*` → **仍然必须红**（前三次事故全是这个形态）", () => {
    // `:path*` 匹配不到没有后缀的那一条。这条如果不红，门就漏掉了历史上最常见的形态。
    const nextConfig = FULL_CONFIG.replace(
      "  { source: `${prefix}/agent-runs`, destination: `${apiOrigin}/agent-runs` },\n",
      "",
    );
    const report = analyzeRewriteCoverage(input({ nextConfig }));
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]).toMatchObject({ head: "agent-runs", kind: "bare", example: "/agent-runs" });
  });

  it("🔴 只删 `:path*`、留着裸路径 → 深路径必须红", () => {
    const nextConfig = FULL_CONFIG.replace(
      "  { source: `${prefix}/agent-runs/:path*`, destination: `${apiOrigin}/agent-runs/:path*` },\n",
      "",
    );
    const report = analyzeRewriteCoverage(input({ nextConfig }));
    expect(report.gaps).toEqual([
      { head: "agent-runs", kind: "deep", example: "/agent-runs/:id" },
    ]);
  });

  it("新增一个不接 rewrite 的 controller → 红（这才是门要拦的日常动作）", () => {
    const controllers = [
      ...input().controllers,
      { file: "new.controller.ts", source: `@Controller()\nclass C { @Post("/brand-new/things") x() {} }` },
    ];
    const report = analyzeRewriteCoverage(input({ controllers }));
    expect(report.gaps.map((g) => g.head)).toContain("brand-new");
  });
});

describe("#539 扫不全就不判 —— 宁可不判，也不要用不完整的数据说「有缺口」", () => {
  it("扫到 0 条路由 → incomplete，且**不报任何缺口**", () => {
    const report = analyzeRewriteCoverage(input({ controllers: [] }));
    expect(report.incomplete).toBe(true);
    expect(report.incompleteReason).toContain("0 条 controller");
    expect(report.gaps, "扫不全时报缺口 = 用不完整数据做否定性判断").toEqual([]);
  });

  it("扫到 0 条 rewrite → incomplete，且不报缺口", () => {
    const report = analyzeRewriteCoverage(input({ nextConfig: "return [];" }));
    expect(report.incomplete).toBe(true);
    expect(report.incompleteReason).toContain("0 条 rewrite");
    expect(report.gaps).toEqual([]);
  });

  it("反证：这个保护确实在起作用 —— 有路由、但 rewrite 扫空时，本会报出一大把缺口", () => {
    const report = analyzeRewriteCoverage(input({ nextConfig: "return [];" }));
    // 路由是扫到了的（说明不是"没东西可判"），但仍然一条缺口都不报 ——
    // 差别正是那道 incomplete 保护。没有它，这里会把「全仓都缺 rewrite」当成真相，
    // 而真相只是 next.config.mjs 的结构变了、扫描器读不懂。
    expect(report.routes.length).toBeGreaterThan(0);
    expect(report.gaps).toEqual([]);
    expect(report.incomplete).toBe(true);
  });
});

describe("#539 棘轮：allowlist 只能变短", () => {
  it("allowlist 里的前缀暂时豁免，其余照常判", () => {
    const controllers = [
      { file: "a.ts", source: `@Controller()\nclass A { @Get("/legacy/thing") x() {} }` },
      { file: "b.ts", source: `@Controller()\nclass B { @Get("/fresh/thing") y() {} }` },
    ];
    const report = analyzeRewriteCoverage(input({ controllers, allowlist: ["legacy"] }));
    expect(report.gaps.map((g) => g.head)).toEqual(["fresh"]);
  });

  it("🔴 allowlist 里已经不缺了的条目要被报为陈旧 —— 否则它会一直遮住回归", () => {
    // 棘轮的意义是只减不增。一条已经补好的豁免留在名单里，
    // 等于给未来的回归留了一扇没人看守的门。
    const stale = staleAllowlistEntries(input({ allowlist: ["agent-runs", "kernel"] }));
    expect(stale.sort()).toEqual(["agent-runs", "kernel"]);
  });

  it("真的还缺的条目不算陈旧", () => {
    const controllers = [{ file: "a.ts", source: `@Controller()\nclass A { @Get("/legacy/thing") x() {} }` }];
    expect(staleAllowlistEntries(input({ controllers, allowlist: ["legacy"] }))).toEqual([]);
  });
});
