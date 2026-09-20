import { survey } from "@repo/contracts";

export const BLOCK_LABELS: Record<survey.SurveyReportBlock["type"], string> = {
  text: "文字说明",
  metric: "指标卡",
  table: "数据表",
  bar: "柱状图",
  radar: "雷达图",
  line: "时间趋势",
  gap: "差距矩阵",
  image: "图片",
  "page-break": "分页",
};
export function newBlock(
  type: survey.SurveyReportBlock["type"],
): survey.SurveyReportBlock {
  return {
    id: crypto.randomUUID(),
    type,
    title: BLOCK_LABELS[type],
    questionIds: [],
    statistic: "mean",
    samplePolicy: "valid",
    minGroupSize: 5,
  };
}
export function templateFromModel(
  model: survey.SurveyWorkflowModel,
): survey.SurveyReportTemplate {
  return {
    id: model.survey.id,
    title: `${model.survey.title} 分析报告`,
    sections: model.reportTemplate.sections.map((section) => ({
      id: section.id,
      title: section.title,
      blocks: [{ ...newBlock("text"), text: "" }],
    })),
  };
}
export function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const result = [...items];
  [result[index], result[target]] = [result[target]!, result[index]!];
  return result;
}
export function copySection(
  section: survey.SurveyReportTemplate["sections"][number],
) {
  return {
    ...section,
    id: crypto.randomUUID(),
    title: `${section.title} 副本`,
    blocks: section.blocks.map((block) => ({
      ...block,
      id: crypto.randomUUID(),
      questionIds: [...block.questionIds],
    })),
  };
}
