import type {
  SurveyPublishBlocker,
  SurveyWorkflowQuestion,
} from "@repo/contracts/survey";
import type { SurveyReportTemplate } from "@repo/contracts/survey-report";

export type SurveyPublishGateInput = {
  questions: SurveyWorkflowQuestion[];
  template: SurveyReportTemplate;
};

const optionQuestionTypes = new Set<SurveyWorkflowQuestion["type"]>([
  "single",
  "multi",
  "dropdown",
  "image_single",
  "image_multi",
  "scale",
  "matrix_single",
  "matrix_multi",
  "matrix_scale",
  "matrix_dropdown",
  "ranking",
  "allocation",
]);

export function isLeadingSurveyQuestion(
  question: Pick<SurveyWorkflowQuestion, "title">,
): boolean {
  const title = question.title.trim();
  return (
    /(?:显然|当然|毋庸置疑|难道)/u.test(title) ||
    /你是否同意.{0,24}(?:优秀|更好|提升|改善)/u.test(title) ||
    /(?:obviously|clearly|don't you agree|wouldn't you agree)/i.test(title)
  );
}

export function evaluateSurveyForPublish(
  input: SurveyPublishGateInput,
): SurveyPublishBlocker[] {
  const blockers: SurveyPublishBlocker[] = [];
  const questionIds = new Set(input.questions.map((question) => question.id));
  if (!input.questions.length) {
    blockers.push({
      code: "QUESTIONS_EMPTY",
      side: "survey",
      subjectId: "survey",
      missingFields: ["questions"],
    });
  }

  const mappedQuestionIds = new Set(
    input.template.sections.flatMap((section) =>
      section.blocks.flatMap((block) => [
        ...block.questionIds,
        ...(block.groupByQuestionId ? [block.groupByQuestionId] : []),
      ]),
    ),
  );

  for (const question of input.questions) {
    if (optionQuestionTypes.has(question.type) && question.options.length === 0)
      blockers.push({
        code: "QUESTION_OPTIONS_EMPTY",
        side: "question",
        subjectId: question.id,
        missingFields: ["options"],
      });
    if (!mappedQuestionIds.has(question.id))
      blockers.push({
        code: "MAPPING_INCOMPLETE",
        side: "question",
        subjectId: question.id,
        missingFields: ["reportBlock"],
      });
    if (isLeadingSurveyQuestion(question))
      blockers.push({
        code: "LEADING_QUESTION",
        side: "question",
        subjectId: question.id,
        missingFields: ["title"],
      });
  }

  for (const section of input.template.sections) {
    const hasQuestionSupply = section.blocks.some((block) =>
      block.questionIds.some((questionId) => questionIds.has(questionId)),
    );
    if (!hasQuestionSupply)
      blockers.push({
        code: "MAPPING_INCOMPLETE",
        side: "section",
        subjectId: section.id,
        missingFields: ["blocks"],
      });
  }

  return blockers.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.subjectId.localeCompare(right.subjectId) ||
      left.side.localeCompare(right.side),
  );
}
