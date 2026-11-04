import { surveyDiagnosticCatalogue } from "@/lib/i18n/namespaces/survey-diagnostics";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
type Translate = (key: MessageKey, params?: MessageParams) => string;
const identities = Object.fromEntries(Object.entries(surveyDiagnosticCatalogue).map(([name, pair]) => [pair[0], `survey.diagnostic.${name}`])) as Record<string, MessageKey>;
/** Translate known canonical diagnostics at render time. Unknown/raw details remain literal. */
export function displaySurveyDiagnostic(message: string, t: Translate): string {
  if (Object.hasOwn(identities, message)) return t(identities[message]!);
  if (message.startsWith("不支持的题型：")) return t("survey.design.unsupportedType", { type: message.slice("不支持的题型：".length) });
  if (message.startsWith("题目编号重复：")) return t("survey.design.duplicateQuestionId", { id: message.slice("题目编号重复：".length) });
  return message;
}
