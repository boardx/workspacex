import {
  SurveyTemplateInputSchema,
  type SurveyTemplateInput,
} from "@repo/contracts/survey-template-library";
import {
  SurveyReportTemplateSchema,
  type SurveyReportBlock,
} from "@repo/contracts/survey-report";
import type { survey } from "@repo/contracts";
import { SURVEY_SCENARIOS, scenarioTemplate } from "./scenario-templates";
import { SURVEY_QUESTION_MODULE_CARDS } from "./resource-library";
import { getSurveyReferenceQuestions } from "./template-content";

export type BuiltinSurveyTemplate = SurveyTemplateInput & { id: string };
type Kind = SurveyTemplateInput["kind"];

function publishableQuestions(): survey.SurveyWorkflowQuestion[] {
  // Preserve the original incomplete prototype content in the shared source. Only
  // real built-in copies receive the missing scale domain and chapter mapping.
  return getSurveyReferenceQuestions().map((question) => ({
    ...question,
    options:
      question.type === "scale" && !question.options.length
        ? ["1", "2", "3", "4", "5"]
        : question.options,
    chapterId: question.chapterId || "improvement",
  }));
}

function dataBlock(
  id: string,
  type: SurveyReportBlock["type"],
  title: string,
  questionIds: string[],
  statistic: SurveyReportBlock["statistic"] = "mean",
): SurveyReportBlock {
  return {
    id: `${id}-data`,
    title,
    type,
    questionIds,
    statistic,
    samplePolicy: "valid",
    minGroupSize: 5,
  };
}
function buildTemplates(kind: Kind): BuiltinSurveyTemplate[] {
  const questions = publishableQuestions();
  if (kind === "question")
    return [
      ...SURVEY_SCENARIOS.map((scenario) => ({
        id: `builtin-survey-${scenario.id}`,
        ...SurveyTemplateInputSchema.parse(scenarioTemplate(scenario, kind)),
      })),
      ...SURVEY_QUESTION_MODULE_CARDS.map((module) => {
        const selected = questions
          .filter((question) => question.chapterId === module.id)
          .map((question, index) => ({ ...question, order: index + 1 }));
        const id = `builtin-${module.id}`;
        return {
          id,
          ...SurveyTemplateInputSchema.parse({
            kind,
            title: module.title,
            description: module.description,
            questions: selected,
            template: SurveyReportTemplateSchema.parse({
              id: `${id}-report`,
              title: `${module.title}报告`,
              sections: [
                {
                  id: `${module.id}-results`,
                  title: module.title,
                  blocks: [
                    dataBlock(
                      module.id,
                      "table",
                      "实际答卷统计",
                      selected.map((q) => q.id),
                      selected.every((q) => q.type === "scale")
                        ? "mean"
                        : "distribution",
                    ),
                  ],
                },
              ],
            }),
          }),
        };
      }),
    ];
  return SURVEY_SCENARIOS.map((card) => {
    const id = `builtin-tpl-${card.id}`;
    return {
      id,
      ...SurveyTemplateInputSchema.parse(scenarioTemplate(card, kind)),
    };
  });
}

/** Each call returns independent editable content; no simulated response state is exposed. */
export function getBuiltinSurveyTemplates(kind: Kind): BuiltinSurveyTemplate[] {
  return structuredClone(buildTemplates(kind));
}
export function getBuiltinSurveyTemplate(
  id: string,
  kind: Kind,
): BuiltinSurveyTemplate | undefined {
  return getBuiltinSurveyTemplates(kind).find((template) => template.id === id);
}
