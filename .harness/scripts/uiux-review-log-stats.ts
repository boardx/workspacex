#!/usr/bin/env -S pnpm exec tsx
/**
 * F13（issue #1875）R3-步骤3：统计"最常反复扣分的维度" Top 5。
 *
 * R4-E2 硬约束：样本量过小不能冒充趋势结论——本文件把「样本量」做成输出的第一等公民，
 * 而不是脚注。样本量分两层：
 *   - `dimensionSampleCount`：有逐维明细（dimensions != null）的评审记录数。
 *     只有这些记录能参与"哪个维度反复扣分"的统计——总分记录（backfill_status=parsed 但
 *     dimensions=null）提供不了"是哪一维"的信息，不能硬凑进去。
 *   - 每个维度自己的出现次数（`appearances`），因为不是每条记录都覆盖同样的维度集合。
 *
 * "扣分"的判定：同一条记录内，某维度得分 < 该记录内维度的最高分（同评分卡内维度同量纲
 * 的合理假设），即算一次扣分。不跨记录假设固定满分（不同 rubric 的量纲不同，R4-A1）。
 */
import { readEntries, UIUX_REVIEW_LOG_PATH, type UiuxReviewLogEntry } from "./uiux-review-log";

export interface DimensionDeductionStat {
  dimension: string;
  deductionCount: number;
  appearances: number;
  deductionRate: number; // deductionCount / appearances
  /** 该维度对应的建议行动项；已知维度走精确映射，未知维度给出兜底建议，从不为 null。 */
  actionItem: string;
}

export interface ReviewLogStats {
  totalEntries: number;
  entriesWithDimensions: number;
  dimensionSampleCount: number; // 与 entriesWithDimensions 相同，语义上更贴近"样本量"这个词
  top5: DimensionDeductionStat[];
  sampleSizeWarning: string | null;
  actionItem: string | null;
}

const SMALL_SAMPLE_THRESHOLD = 5;

/** 已知维度 → 建议行动项的映射。仅覆盖本仓已实际出现过明细数据的维度，不臆造未见过的维度建议。 */
const KNOWN_ACTION_ITEMS: Record<string, string> = {
  "4-真实的多步能力": "本地取证路径（loopback 替身）结构性拿不到这一分，建议开一条独立的 devapp 真实模型取证轨，不要继续在本地剧本里加内容去凑分。",
  "5-语音输入体验": "同上，需真实麦克风取证；本地无头浏览器结构性拿不到，建议移出「每轮都测」的清单，改为 devapp 专项验证。",
  "6-多轮上下文": "桩（loopback）不记忆是已知限制；建议这一项在真实模型接入前标记为「基础设施限制」而非「产品缺陷」，避免每轮重复扣同一条已知分。",
  "7-错误处理透明度": "反复出现回归（裸错误码 / 失败态不在消息流内 / 成功勾与失败态并存）——建议把「失败态三件套」（人读文案+消息流内呈现+重试入口）固化成 lint-design 规则或组件级契约测试，防止后续改动再次回归。",
  "10-整体连贯性": "多次因身份漂移/空态矛盾/终态面板未清零扣分——建议给 agent 身份渲染、run 终态后的面板复位各补一条组件级回归测试，而不是每轮人工肉眼查。",
};

function deriveDeductions(entry: UiuxReviewLogEntry): string[] {
  if (!entry.dimensions) return [];
  const values = Object.values(entry.dimensions);
  if (values.length === 0) return [];
  const max = Math.max(...values);
  return Object.entries(entry.dimensions)
    .filter(([, score]) => score < max)
    .map(([dim]) => dim);
}

export function computeStats(entries: UiuxReviewLogEntry[]): ReviewLogStats {
  const withDims = entries.filter((e) => e.dimensions !== null);

  const appearances = new Map<string, number>();
  const deductions = new Map<string, number>();
  for (const entry of withDims) {
    for (const dim of Object.keys(entry.dimensions!)) {
      appearances.set(dim, (appearances.get(dim) ?? 0) + 1);
    }
    for (const dim of deriveDeductions(entry)) {
      deductions.set(dim, (deductions.get(dim) ?? 0) + 1);
    }
  }

  const actionItemFor = (dimension: string, deductionCount: number, count: number): string =>
    KNOWN_ACTION_ITEMS[dimension] ??
    `「${dimension}」在 ${count} 次评审中扣分 ${deductionCount} 次——建议下一次该维度扣分时，` +
      `在扣分说明里补一条具体的 lint 规则/组件修复建议，而不是只记分数。`;

  const allDims: DimensionDeductionStat[] = [...appearances.entries()].map(([dimension, count]) => {
    const deductionCount = deductions.get(dimension) ?? 0;
    return {
      dimension,
      deductionCount,
      appearances: count,
      deductionRate: deductionCount / count,
      actionItem: actionItemFor(dimension, deductionCount, count),
    };
  });

  const top5 = allDims
    .filter((d) => d.deductionCount > 0)
    .sort((a, b) => b.deductionCount - a.deductionCount || b.deductionRate - a.deductionRate)
    .slice(0, 5);

  const sampleSizeWarning =
    withDims.length < SMALL_SAMPLE_THRESHOLD
      ? `样本量仅 ${withDims.length} 条带逐维明细的评审记录（阈值 ${SMALL_SAMPLE_THRESHOLD}）——这是「已观察到的扣分次数」，` +
        `不是可靠的趋势结论。多数历史评审只在 commit subject 里留了总分、没留逐维明细（见 uiux-review-log-backfill.ts` +
        ` 产出的 unresolved/dimensions=null 记录），Top 5 排名会随着后续评审补充明细数据而变化，不要当成定论引用。`
      : null;

  const actionItem = top5[0]?.actionItem ?? null;

  return {
    totalEntries: entries.length,
    entriesWithDimensions: withDims.length,
    dimensionSampleCount: withDims.length,
    top5,
    sampleSizeWarning,
    actionItem,
  };
}

function printReport(stats: ReviewLogStats): void {
  console.log(`评审记录总数：${stats.totalEntries}`);
  console.log(`带逐维明细的记录数（可用于维度统计的样本量）：${stats.dimensionSampleCount}`);
  console.log("");
  if (stats.top5.length === 0) {
    console.log("Top 5 反复扣分维度：（暂无——没有任何维度出现过扣分，或没有带明细的记录）");
  } else {
    console.log("Top 5 反复扣分维度：");
    stats.top5.forEach((d, i) => {
      console.log(
        `  ${i + 1}. ${d.dimension} —— 扣分 ${d.deductionCount} 次 / 出现 ${d.appearances} 次（扣分率 ${(d.deductionRate * 100).toFixed(0)}%）`,
      );
      console.log(`     行动项：${d.actionItem}`);
    });
  }
  console.log("");
  if (stats.sampleSizeWarning) {
    console.log(`⚠ 样本量提示：${stats.sampleSizeWarning}`);
    console.log("");
  }
  if (stats.actionItem) {
    console.log(`后续行动项建议：${stats.actionItem}`);
  } else {
    console.log("后续行动项建议：（暂无可给出的建议——尚无扣分维度数据）");
  }
}

function main(): void {
  const entries = readEntries(UIUX_REVIEW_LOG_PATH);
  const stats = computeStats(entries);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  printReport(stats);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
