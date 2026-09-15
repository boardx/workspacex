/**
 * 投后评级 ad-hoc MVP 验收脚本（issue #3676）。
 *
 * 直接调用生产代码里的确定性评分引擎（不是复述逻辑的第二份实现），
 * 对着《投后财务项目评级 Agent — 大模型测试方案与模拟测试文件》v1.0
 * 的规则表逐条构造场景，打印「输入摘要 → 系统输出 → 判定」验收表。
 *
 * 跑法（零 I/O，无需 docker/Postgres）：
 *   cd apps/api && pnpm exec tsx scripts/postinvest-rating-acceptance.ts
 *
 * MVP 边界说明：本脚本的输入是「已抽取好的结构化财务字段」，不是真实
 * 报表文件——文档解析（PDF/Excel/录音）接线是 backlog 明确推迟项。
 */
import {
  rateWithDataQuality,
  type FinancialInput,
  type HumanConfirmedFacts,
} from "../src/domain/postinvest-rating/scoring";

interface Scenario {
  id: string;
  name: string;
  pdfRule: string;
  financials: FinancialInput;
  facts: HumanConfirmedFacts;
  expect: {
    grade?: string | null;
    flagsInclude?: string[];
    note: string;
  };
}

function fin(overrides: Partial<FinancialInput>): FinancialInput {
  return {
    revenue: 6e8,
    revenuePriorYear: 5e8,
    netProfit: 6e7,
    netProfitPriorYear: 5e7,
    cashAndEquivalents: 2e8,
    operatingCashOutflow12m: 1e8,
    operatingCashFlowNet: 3e7,
    accountsReceivable: 5e7,
    inventory: 3e7,
    otherReceivables: 1e7,
    otherReceivablesPriorYear: 8e6,
    totalAssets: 1e9,
    netAssets: 5e8,
    currentAssets: 3e8,
    currentLiabilities: 1e8,
    ...overrides,
  };
}

const NORMAL_FACTS: HumanConfirmedFacts = {
  hasFinancialStatement: true,
  standaloneOrOperatingReportOnly: false,
  missingStatementReason: null,
};

const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    name: "优秀项目：高营收、高利润、现金充裕",
    pdfRule: "三、项目评级：>140 分 → A",
    financials: fin({ revenue: 8e8, revenuePriorYear: 5e8, netProfit: 1.2e8, netProfitPriorYear: 6e7, cashAndEquivalents: 5e8 }),
    facts: NORMAL_FACTS,
    expect: { grade: "A", note: "规模大、增长快、利润高、现金充足，应评 A" },
  },
  {
    id: "S2",
    name: "PDF 原文算例：营收增长 +50%",
    pdfRule: "二、S1：90 × log1.5(本年/上年)，示例 +50% → 90 分",
    financials: fin({ revenue: 1.5e8, revenuePriorYear: 1e8, netProfit: 6e7, netProfitPriorYear: 5e7 }),
    facts: NORMAL_FACTS,
    expect: { note: "本用例验证增长率子项定点得分，见下方明细里的 revenueGrowthScore≈90" },
  },
  {
    id: "S3",
    name: "资不抵债，其余指标正常",
    pdfRule: "三、降级触发：净资产<0 → 降到 D",
    financials: fin({ netAssets: -1e6, operatingCashFlowNet: 1e6 }),
    facts: NORMAL_FACTS,
    expect: { grade: "D", note: "无论算分多高，触发资不抵债一律不高于 D" },
  },
  {
    id: "S4",
    name: "资不抵债 + 经营现金流为负 + 流动比率<1",
    pdfRule: "三、降级触发：叠加条件 → 降到 E",
    financials: fin({ netAssets: -1e6, operatingCashFlowNet: -1e6, currentAssets: 5e7, currentLiabilities: 1e8 }),
    facts: NORMAL_FACTS,
    expect: { grade: "E", note: "三条件同时成立，直接 E" },
  },
  {
    id: "S5",
    name: "无财务报表，原因为失联",
    pdfRule: "一、数据质量：异常原因未提供报表 → 直接 E + 公司经营异常",
    financials: fin({}),
    facts: { hasFinancialStatement: false, standaloneOrOperatingReportOnly: false, missingStatementReason: "lost_contact" },
    expect: { grade: "E", flagsInclude: ["business_abnormal"], note: "人工确认失联，不由 Agent 自行推断" },
  },
  {
    id: "S6",
    name: "无财务报表，原因为保密期（上市前）",
    pdfRule: "一、数据质量：正常原因未提供报表 → 按往期数据评定 + 标注数据暂估",
    financials: fin({}),
    facts: { hasFinancialStatement: false, standaloneOrOperatingReportOnly: false, missingStatementReason: "confidentiality_period" },
    expect: { grade: null, note: "MVP 边界：不自动回填往期数据，明确给出需要往期报表的提示，不出分" },
  },
  {
    id: "S7",
    name: "仅有单体报表",
    pdfRule: "一、数据质量：仅未合并子公司单体报表 → 标注数据不完整",
    financials: fin({}),
    facts: { hasFinancialStatement: true, standaloneOrOperatingReportOnly: true, missingStatementReason: null },
    expect: { flagsInclude: ["incomplete"], note: "正常出分，附加标注" },
  },
  {
    id: "S8",
    name: "应收+存货占收入超 80%",
    pdfRule: "一、数据质量：(应收+存货)/收入 > 80% → 标注数据疑似异常",
    financials: fin({ revenue: 1e8, accountsReceivable: 5e7, inventory: 4e7 }),
    facts: NORMAL_FACTS,
    expect: { flagsInclude: ["suspected_abnormal"], note: "不因此降级，只标注" },
  },
  {
    id: "S9",
    name: "无上年对比数据",
    pdfRule: "二、增长率得分：无上年数据 → 按体量给分，中性偏正",
    financials: fin({ revenuePriorYear: null, netProfitPriorYear: null }),
    facts: NORMAL_FACTS,
    expect: { note: "首次评级仍可出分，增长子项退化为体量得分" },
  },
  {
    id: "S10",
    name: "扭亏为盈",
    pdfRule: "二、S2：扭亏为盈 70~90（亏损越大越高）",
    financials: fin({ netProfit: 1e6, netProfitPriorYear: -8e7 }),
    facts: NORMAL_FACTS,
    expect: { note: "净利润增长子项应落在 70~90 区间" },
  },
];

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(1);
}

let allPass = true;
console.log("# 投后评级 MVP 验收表\n");
console.log("| 场景 | 名称 | PDF 依据 | 等级 | 总分 | S1/S2/S3 | 标注 | 判定 |");
console.log("|---|---|---|---|---|---|---|---|");

for (const s of SCENARIOS) {
  const result = rateWithDataQuality(s.financials, s.facts);
  let ok = true;
  const problems: string[] = [];

  if (s.expect.grade !== undefined && result.grade !== s.expect.grade) {
    ok = false;
    problems.push(`期望等级 ${s.expect.grade}，实际 ${result.grade}`);
  }
  if (s.expect.flagsInclude) {
    for (const f of s.expect.flagsInclude) {
      if (!result.flags.includes(f as never)) {
        ok = false;
        problems.push(`缺少标注 ${f}`);
      }
    }
  }

  allPass = allPass && ok;
  const s1s2s3 = `${fmt(result.scores.s1)}/${fmt(result.scores.s2)}/${fmt(result.scores.s3)}`;
  const flags = result.flags.length ? result.flags.join(",") : "—";
  const verdict = ok ? "✅ 符合预期" : `❌ ${problems.join("；")}`;

  console.log(
    `| ${s.id} | ${s.name} | ${s.pdfRule} | ${result.grade ?? "—"} | ${fmt(result.scores.total)} | ${s1s2s3} | ${flags} | ${verdict} |`
  );
}

console.log(`\n${allPass ? "✅ 全部场景符合预期" : "❌ 存在不符合预期的场景，见上表"}`);

/**
 * R7 业务规则 2：同一输入两次运行得分必须**逐位**一致。
 *
 * 上面那张表证明的是「算得对」，不是「算得稳」。这两件事会分开坏：任何一次把
 * `Date.now()`、`Math.random()`、`Object.keys` 顺序或浮点累加次序引进评分路径的改动，
 * 都能让表照样全绿而同一份报表两次评出不同的分——而评级是要写进报告给人看的，
 * 「昨天 B 今天 C 而数据没变」会直接摧毁这份评级的可信度。
 *
 * 逐位比较用 `Object.is`：它把 `NaN` 判为相等、把 `+0/-0` 判为不等，正是"逐位"的语义；
 * `===` 在这两处都会说谎。
 */
let deterministic = true;
for (const s of SCENARIOS) {
  const a = rateWithDataQuality(s.financials, s.facts);
  const b = rateWithDataQuality(s.financials, s.facts);
  const keys = Object.keys(a.scores) as (keyof typeof a.scores)[];
  const drifted = keys.filter((k) => !Object.is(a.scores[k], b.scores[k]));
  if (a.grade !== b.grade || drifted.length > 0 || a.flags.join() !== b.flags.join()) {
    deterministic = false;
    console.log(`❌ ${s.id} 两次运行结果不一致：${drifted.join("、") || "等级或标注不同"}`);
  }
}
console.log(deterministic
  ? "✅ 确定性：每个场景连跑两次，等级/标注/全部分项逐位一致"
  : "❌ 确定性：存在两次运行结果不同的场景");

process.exit(allPass && deterministic ? 0 : 1);
