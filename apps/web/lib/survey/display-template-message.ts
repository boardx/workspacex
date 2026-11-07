import type { Locale } from "@/lib/i18n/locale";
import { displaySurveyRuntimeError } from "./display-runtime-error";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
import { surveyTemplatesZhCN } from "@/lib/i18n/namespaces/survey-templates";
type Translator = (key: MessageKey, params?: MessageParams) => string;
const keys = ["invalidData", "invalidLoadData", "loadFailed", "operationFailed", "createUnconfirmed", "wrongKind", "missingBuiltin", "invalidConfiguration", "saveFailed", "invalidSave", "saveUnconfirmed", "noQuestions", "missingBinding", "wrongBinding", "duplicateBinding", "requestLimit"] as const;
export function displaySurveyTemplateMessage(error: Error | string, t: Translator, locale: Locale = "zh-CN"): string {
  const message = error instanceof Error ? error.message : error;
  const limit = /^模板请求总大小不能超过 (\d+)KB（UTF-8，包含题目、报告内容及保存版本）$/.exec(message);
  if (limit) return t("survey.templates.requestLimit", { max: limit[1]! });
  const key = keys.find(key => surveyTemplatesZhCN[`survey.templates.${key}`] === message);
  return key ? t(`survey.templates.${key}`) : displaySurveyRuntimeError(error, t, locale);
}
