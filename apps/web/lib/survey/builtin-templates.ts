import { SurveyTemplateInputSchema, type SurveyTemplateInput } from "@repo/contracts/survey-template-library";
import { SurveyReportTemplateSchema, type SurveyReportBlock } from "@repo/contracts/survey-report";
import type { survey } from "@repo/contracts";
import { SURVEY_QUESTION_MODULE_CARDS, SURVEY_TEMPLATE_CARDS } from "./resource-library";
import { getSurveyReferenceQuestions, getSurveyReferenceReportSections } from "./template-content";

export type BuiltinSurveyTemplate = SurveyTemplateInput & { id: string };
type Kind = SurveyTemplateInput["kind"];

function publishableQuestions(): survey.SurveyWorkflowQuestion[] {
  // Preserve the original incomplete prototype content in the shared source. Only
  // real built-in copies receive the missing scale domain and chapter mapping.
  return getSurveyReferenceQuestions().map(question => ({
    ...question,
    options: question.type === "scale" && !question.options.length ? ["1", "2", "3", "4", "5"] : question.options,
    chapterId: question.chapterId || "improvement",
  }));
}

function textBlock(id: string, title: string, text = ""): SurveyReportBlock {
  return { id: `${id}-text`, title, type: "text", text, questionIds: [], statistic: "mean", samplePolicy: "valid", minGroupSize: 5 };
}
function dataBlock(id: string, type: SurveyReportBlock["type"], title: string, questionIds: string[], statistic: SurveyReportBlock["statistic"] = "mean"): SurveyReportBlock {
  return { id: `${id}-data`, title, type, questionIds, statistic, samplePolicy: "valid", minGroupSize: 5 };
}
function reportSections(count: number, questions: survey.SurveyWorkflowQuestion[]) {
  const scales = questions.filter(question => question.type === "scale").map(question => question.id);
  return getSurveyReferenceReportSections().slice(0, count).map(section => {
    let blocks: SurveyReportBlock[];
    switch (section.id) {
      case "summary": blocks = [dataBlock(section.id, "table", "量表评分概览", scales)]; break;
      case "findings": blocks = [dataBlock(section.id, "bar", "职责层级分布", ["Q01"], "distribution")]; break;
      case "gap": blocks = [dataBlock(section.id, "table", "实际量表均值", scales)]; break;
      case "scenario": blocks = [dataBlock(section.id, "radar", "实际量表评分比较", scales)]; break;
      case "boundary": blocks = [textBlock(section.id, "统计方法与适用边界", "量表按对应题目的量表选项计分。各区块的结果依据其绑定题目、统计量及样本范围计算。描述性统计不证明因果关系，也不预测行动效果。")]; break;
      // No evidence yet supports implications, recommended actions, or a roadmap.
      // Empty text requires author input before the existing compiler allows a report.
      default: blocks = [textBlock(section.id, section.title)];
    }
    return { id: section.id, title: section.title, blocks };
  });
}
function reportDescription(count: number): string {
  const instructions = getSurveyReferenceReportSections().slice(0, count)
    .map(section => `${section.title}：${section.managementQuestion} 方法：${section.method}。`).join("\n");
  return `保留原有章节结构，使用通用参考题目；应用时请映射到实际问卷。业务含义、行动和路线图正文留空，需结合真实证据完成后才能生成报告。缺口章节暂展示实际均值，差距目标由作者配置；雷达图仅展示实际评分，不模拟情景。\n${instructions}`;
}
function buildTemplates(kind: Kind): BuiltinSurveyTemplate[] {
  const questions = publishableQuestions();
  if (kind === "question") return SURVEY_QUESTION_MODULE_CARDS.map(module => {
    const selected = questions.filter(question => question.chapterId === module.id).map((question, index) => ({ ...question, order: index + 1 }));
    const id = `builtin-${module.id}`;
    return { id, ...SurveyTemplateInputSchema.parse({
      kind, title: module.title, description: module.description, questions: selected,
      template: SurveyReportTemplateSchema.parse({ id: `${id}-report`, title: `${module.title}报告`, sections: [{
        id: `${module.id}-results`, title: module.title,
        blocks: [dataBlock(module.id, "table", "实际答卷统计", selected.map(q => q.id), selected.every(q => q.type === "scale") ? "mean" : "distribution")],
      }] }),
    }) };
  });
  return SURVEY_TEMPLATE_CARDS.map(card => {
    const id = `builtin-${card.id}`;
    return { id, ...SurveyTemplateInputSchema.parse({
      kind, title: card.title,
      description: reportDescription(card.reportSectionCount),
      questions,
      template: { id: `${id}-report`, title: card.title, sections: reportSections(card.reportSectionCount, questions) },
    }) };
  });
}

/** Each call returns independent editable content; no simulated response state is exposed. */
export function getBuiltinSurveyTemplates(kind: Kind): BuiltinSurveyTemplate[] {
  return structuredClone(buildTemplates(kind));
}
export function getBuiltinSurveyTemplate(id: string, kind: Kind): BuiltinSurveyTemplate | undefined {
  return getBuiltinSurveyTemplates(kind).find(template => template.id === id);
}
