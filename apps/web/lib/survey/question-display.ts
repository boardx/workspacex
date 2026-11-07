import { createSurveyQuestion, type SurveyQuestionType } from "@repo/contracts/survey-question-types";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
import type { Locale } from "@/lib/i18n/locale";
type Translate = (key: MessageKey, params?: MessageParams) => string;
export function surveyQuestionTypeLabel(type: SurveyQuestionType, t: Translate): string {
  return t(`survey.design.type.${type}.label`);
}
export function surveyQuestionTypeDescription(type: SurveyQuestionType, t: Translate): string {
  return t(`survey.design.type.${type}.description`);
}
/** Called only by explicit creation actions, never by render or a locale effect. */
export function createDisplaySurveyQuestion(type: SurveyQuestionType, id: string, order: number, locale: Locale, t: Translate) {
  const question = createSurveyQuestion(type, id, order);
  if (locale !== "en") return question;
  question.title = surveyQuestionTypeLabel(type, t);
  if (question.options.length && type !== "scale" && type !== "matrix_scale") {
    question.options = question.options.map((_, index) => t("survey.design.defaultOption", { index: index + 1 }));
  }
  if (question.config?.rows) question.config.rows = question.config.rows.map((row, index) => ({ ...row, label: t("survey.design.defaultItem", { index: index + 1 }) }));
  if (type === "multiple_text" && question.config?.fields) question.config.fields = question.config.fields.map((field, index) => ({ ...field, label: t("survey.design.defaultField", { index: index + 1 }) }));
  if (type === "address" && question.config?.fields) {
    const labels = [t("survey.design.defaultProvince"), t("survey.design.defaultCity"), t("survey.design.defaultAddress")];
    question.config.fields = question.config.fields.map((field, index) => ({ ...field, label: labels[index]! }));
  }
  if (question.config?.cascadePaths) question.config.cascadePaths = [
    [t("survey.design.defaultRegion", { index: 1 }), t("survey.design.defaultCityNumber", { index: 1 })],
    [t("survey.design.defaultRegion", { index: 1 }), t("survey.design.defaultCityNumber", { index: 2 })],
    [t("survey.design.defaultRegion", { index: 2 }), t("survey.design.defaultCityNumber", { index: 3 })],
  ];
  return question;
}
