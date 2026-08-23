/**
 * F13（issue #1875）反证套件：Top 5 反复扣分维度统计。
 *
 * 覆盖：
 *   1. 合成数据下 Top5 排序/扣分率计算正确。
 *   2. dimensions=null 的记录不参与维度统计（不能拿总分记录硬凑维度分布）。
 *   3. R4-E2 反证：样本量小于阈值时必须带 sampleSizeWarning，不能悄悄输出「趋势」。
 *   4. R6：至少能给出 1 条对应具体行动项的建议（actionItem 非空）。
 *   5. 仓库真实日志：统计脚本能跑通、Top5 结构合法、样本量如实标注。
 */
import { describe, expect, it } from "vitest";
import { computeStats } from "./uiux-review-log-stats";
import { readEntries, UIUX_REVIEW_LOG_PATH, type UiuxReviewLogEntry } from "./uiux-review-log";

function entry(overrides: Partial<UiuxReviewLogEntry>): UiuxReviewLogEntry {
  return {
    review_target: "synthetic",
    review_date: "2026-01-01",
    rubric: "synthetic-rubric.md",
    dimensions: null,
    total_score: 5,
    scale: 10,
    deductions: null,
    issue_ref: null,
    pr_ref: null,
    commit_sha: null,
    source: "manual",
    backfill_status: "manual",
    notes: null,
    ...overrides,
  };
}

describe("computeStats：基本排序与扣分率", () => {
  it("扣分次数最多的维度排第一", () => {
    const entries = [
      entry({ dimensions: { D1: 0, D2: 1, D3: 1 } }), // D1 扣分
      entry({ dimensions: { D1: 0, D2: 0, D3: 1 } }), // D1, D2 扣分
      entry({ dimensions: { D1: 1, D2: 0, D3: 1 } }), // D2 扣分
    ];
    const stats = computeStats(entries);
    expect(stats.top5[0].dimension).toBe("D1");
    expect(stats.top5[0].deductionCount).toBe(2);
    expect(stats.top5[1].dimension).toBe("D2");
    expect(stats.top5[1].deductionCount).toBe(2);
    // D3 从未扣分，不应该出现在 top5（deductionCount 必须 > 0）
    expect(stats.top5.find((d) => d.dimension === "D3")).toBeUndefined();
  });

  it("扣分率 = 扣分次数 / 出现次数，且用于打破并列", () => {
    const entries = [
      // D-rare 只出现 1 次，扣分 1 次 → 100% 扣分率
      entry({ dimensions: { "D-rare": 0, "D-common": 1 } }),
      entry({ dimensions: { "D-common": 0 } }),
      entry({ dimensions: { "D-common": 1 } }),
    ];
    const stats = computeStats(entries);
    const rare = stats.top5.find((d) => d.dimension === "D-rare")!;
    expect(rare.appearances).toBe(1);
    expect(rare.deductionCount).toBe(1);
    expect(rare.deductionRate).toBe(1);
  });

  it("最多只返回 5 个维度", () => {
    const dims: Record<string, number> = {};
    for (let i = 0; i < 8; i++) dims[`D${i}`] = 0; // 全部扣分（同批内最高分是 0，因此不会被判定为扣分——见下一测试单独覆盖判定逻辑）
    // 用两档分数制造「扣分」：一半 0 一半 1，最高分是 1，0 的那些算扣分
    const mixed: Record<string, number> = {};
    for (let i = 0; i < 8; i++) mixed[`D${i}`] = i % 2 === 0 ? 0 : 1;
    const stats = computeStats([entry({ dimensions: mixed })]);
    expect(stats.top5.length).toBeLessThanOrEqual(5);
  });
});

describe("computeStats：dimensions=null 不参与维度统计", () => {
  it("只有总分、没有逐维明细的记录不会污染 Top5", () => {
    const entries = [
      entry({ dimensions: null, total_score: 9 }),
      entry({ dimensions: null, total_score: 1 }),
      entry({ dimensions: { D1: 0, D2: 1 } }),
    ];
    const stats = computeStats(entries);
    expect(stats.entriesWithDimensions).toBe(1);
    expect(stats.dimensionSampleCount).toBe(1);
    expect(stats.top5.map((d) => d.dimension)).toEqual(["D1"]);
  });
});

describe("computeStats：R4-E2 反证——样本量过小必须警示，不能冒充趋势", () => {
  it("样本量低于阈值时 sampleSizeWarning 非空", () => {
    const stats = computeStats([entry({ dimensions: { D1: 0, D2: 1 } })]);
    expect(stats.dimensionSampleCount).toBeLessThan(5);
    expect(stats.sampleSizeWarning).not.toBeNull();
    expect(stats.sampleSizeWarning).toMatch(/样本量/);
  });

  it("样本量达到阈值时不再警示", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({ dimensions: { D1: i % 2, D2: 1 }, review_target: `t${i}` }),
    );
    const stats = computeStats(entries);
    expect(stats.dimensionSampleCount).toBeGreaterThanOrEqual(5);
    expect(stats.sampleSizeWarning).toBeNull();
  });
});

describe("computeStats：R6——至少 1 条结论要对应具体后续行动项", () => {
  it("Top1 维度有明确的行动项建议（已知维度走精确映射）", () => {
    const stats = computeStats([entry({ dimensions: { "7-错误处理透明度": 0, "8-消息呈现质量": 1 } })]);
    expect(stats.actionItem).not.toBeNull();
    expect(stats.actionItem).toMatch(/lint-design|回归|契约测试/);
  });

  it("未知维度也有兜底建议，不会输出 null", () => {
    const stats = computeStats([entry({ dimensions: { "某个从未见过的自定义维度": 0, 满分参照: 1 } })]);
    expect(stats.actionItem).not.toBeNull();
  });

  it("没有任何扣分时 actionItem 为 null，不硬造建议", () => {
    const stats = computeStats([entry({ dimensions: { D1: 1, D2: 1 } })]);
    expect(stats.top5).toEqual([]);
    expect(stats.actionItem).toBeNull();
  });
});

describe("仓库真实日志：统计脚本能跑通并给出合法结构", () => {
  it(`${UIUX_REVIEW_LOG_PATH} 上跑 computeStats 不抛错，Top5 结构合法`, () => {
    const entries = readEntries(UIUX_REVIEW_LOG_PATH);
    const stats = computeStats(entries);
    expect(stats.totalEntries).toBe(entries.length);
    expect(stats.top5.length).toBeLessThanOrEqual(5);
    for (const d of stats.top5) {
      expect(d.deductionCount).toBeGreaterThan(0);
      expect(d.appearances).toBeGreaterThanOrEqual(d.deductionCount);
    }
    // R4-E2：本仓当前带逐维明细的记录数很少，统计脚本必须如实报出样本量提示。
    if (stats.dimensionSampleCount < 5) {
      expect(stats.sampleSizeWarning).not.toBeNull();
    }
  });

  it("R6：真实数据至少能给出 1 条对应后续行动项的结论", () => {
    const entries = readEntries(UIUX_REVIEW_LOG_PATH);
    const stats = computeStats(entries);
    expect(stats.top5.length).toBeGreaterThan(0);
    expect(stats.actionItem).not.toBeNull();
    expect((stats.actionItem ?? "").length).toBeGreaterThan(0);
  });
});
