import { surveyChoices, type SurveyWorkflowQuestion } from "@repo/contracts/survey-question-types";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
import { surveyAnswerLiteralCatalogue, surveyAnswerSuffixCatalogue } from "@/lib/i18n/namespaces/survey-public";
type Translator = (key: MessageKey, params?: MessageParams) => string;
const literalKeys = Object.fromEntries(Object.entries(surveyAnswerLiteralCatalogue).map(([id, pair]) => [pair[0], `survey.answer.${id}`])) as Record<string, MessageKey>;
/** Render an original validation result; never use this output for validation or focus. */
export function displaySurveyAnswerMessage(question: SurveyWorkflowQuestion, message: string, t: Translator): string {
  const authoredLabels = question.type.startsWith("matrix_") ? question.config?.rows?.map(row => row.label) ?? []
    : question.type === "multiple_text" || question.type === "address" ? question.config?.fields?.map(field => field.label) ?? []
    : question.type === "allocation" ? surveyChoices(question).map(choice => choice.label) : [];
  const matchLabel = (raw: string, label: string): string | undefined => {
    for (const [id, parts] of Object.entries(surveyAnswerSuffixCatalogue)) {
      if (message === raw + parts[0]) return t(`survey.answer.dynamic.${id}` as MessageKey, { label });
    }
  };
  // An authored row literally named 答案 remains raw, unlike the fixed default label.
  for (const label of authoredLabels) {
    const displayed = matchLabel(label, label);
    if (displayed !== undefined) return displayed;
  }
  if (Object.hasOwn(literalKeys, message)) return t(literalKeys[message]!);
  for (const [raw, key] of [["答案", "survey.answer.label"], ["其他说明", "survey.answer.otherLabel"]] as const) {
    const displayed = matchLabel(raw, t(key));
    if (displayed !== undefined) return displayed;
  }
  if (question.type === "allocation" && question.config?.total !== undefined && message === `分配合计必须为 ${question.config.total}`) return t("survey.answer.total", { total: question.config.total });
  return message;
}
