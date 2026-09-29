import type { survey } from "@repo/contracts";

export type SurveySampleTier = "descriptive" | "exploratory" | "sufficient";

export function surveySampleTier(sampleSize: number | undefined): SurveySampleTier {
  if (typeof sampleSize !== "number") return "sufficient";
  if (sampleSize < 5) return "descriptive";
  if (sampleSize < 30) return "exploratory";
  return "sufficient";
}

export function surveySampleNotice(sampleSize: number | undefined) {
  const tier = surveySampleTier(sampleSize);
  if (tier === "descriptive") return {
    tier,
    label: "低样本说明",
    text: `当前仅纳入 ${sampleSize} 份答卷，仅展示描述性结果，不代表目标人群，也不形成行动结论。建议先补充样本并核对原始反馈。`,
  };
  if (tier === "exploratory") return {
    tier,
    label: "探索性样本说明",
    text: `当前纳入 ${sampleSize} 份答卷，结果适合作为探索性线索，置信度有限，不宜直接外推至全部目标人群。建议结合补充样本或访谈继续验证。`,
  };
  return null;
}

type ReportSection = survey.CompiledSurveyReport["sections"][number];
type ReportInsight = NonNullable<ReportSection["analysis"]>[number];

function blockEffectiveSample(block: ReportSection["blocks"][number]) {
  if (typeof block.sampleSize === "number") return block.sampleSize;
  if (block.rows.length) return Math.min(...block.rows.map((row) => row.count));
  if (block.answerTexts) return block.answerTexts.length;
  return undefined;
}

export function surveyInsightSampleSize(
  report: survey.CompiledSurveyReport,
  section: ReportSection,
  insight: ReportInsight,
) {
  const referenced = section.blocks
    .filter((block) => insight.blockIds.includes(block.id))
    .map(blockEffectiveSample)
    .filter((sample): sample is number => typeof sample === "number");
  const reportSample = report.sampleSummary?.included;
  const candidates = typeof reportSample === "number" ? [...referenced, reportSample] : referenced;
  return candidates.length ? Math.min(...candidates) : undefined;
}

export function surveyInsightAction(
  report: survey.CompiledSurveyReport,
  section: ReportSection,
  insight: ReportInsight,
) {
  const tier = surveySampleTier(surveyInsightSampleSize(report, section, insight));
  if (tier === "descriptive") return null;
  return { label: tier === "exploratory" ? "建议验证：" : "建议行动：", text: insight.action };
}
