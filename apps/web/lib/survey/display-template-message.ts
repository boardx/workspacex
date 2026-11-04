import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
import { surveyTemplatesZhCN } from "@/lib/i18n/namespaces/survey-templates";
type Translator = (key: MessageKey, params?: MessageParams) => string;
const keys = ["invalidData", "invalidLoadData", "loadFailed", "operationFailed", "createUnconfirmed", "wrongKind", "missingBuiltin", "invalidConfiguration", "saveFailed", "invalidSave", "saveUnconfirmed", "noQuestions", "missingBinding", "wrongBinding", "duplicateBinding", "requestLimit"] as const;
export function displaySurveyTemplateMessage(message: string, t: Translator): string {
  const key = keys.find(key => surveyTemplatesZhCN[`survey.templates.${key}`] === message);
  return key ? t(`survey.templates.${key}`) : message;
}
