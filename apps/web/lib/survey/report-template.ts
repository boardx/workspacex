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

/** Contract-backed statistics; the editor and template mapping share these capabilities. */
export const SURVEY_STATISTIC_LABELS: Record<
  survey.SurveyReportBlock["statistic"],
  string
> = {
  mean: "均值",
  count: "有效样本数",
  distribution: "选项数量",
  percentage: "选择比例（%）",
  nps: "NPS（推荐者减贬损者）",
  mean_rank: "平均名次",
  first_choice: "首选比例（%）",
  sum: "合计",
  responses: "回答清单",
};
export function reportQuestionSupportsStatistic(
  question: survey.SurveyWorkflowQuestion,
  statistic: survey.SurveyReportBlock["statistic"],
): boolean {
  return survey.surveyQuestionStatistics(question).includes(statistic);
}
export function availableReportStatistics(
  questions: survey.SurveyWorkflowQuestion[],
): survey.SurveyReportBlock["statistic"][] {
  if (!questions.length) return [];
  return survey
    .surveyQuestionStatistics(questions[0]!)
    .filter((statistic) =>
      questions.every((question) =>
        reportQuestionSupportsStatistic(question, statistic),
      ),
    );
}
export function defaultReportStatistic(
  question: survey.SurveyWorkflowQuestion,
): survey.SurveyReportBlock["statistic"] | undefined {
  return survey.surveyQuestionStatistics(question)[0];
}
