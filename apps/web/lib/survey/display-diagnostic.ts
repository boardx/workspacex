import { surveyDiagnosticCatalogue } from "@/lib/i18n/namespaces/survey-diagnostics";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
type Translate = (key: MessageKey, params?: MessageParams) => string;
const identities = Object.fromEntries(Object.entries(surveyDiagnosticCatalogue).map(([name, pair]) => [pair[0], `survey.diagnostic.${name}`])) as Record<string, MessageKey>;
/** Translate known canonical diagnostics at render time. Unknown/raw details remain literal. */
export function displaySurveyDiagnostic(message: string, t: Translate): string {
  if (Object.hasOwn(identities, message)) return t(identities[message]!);
  return message;
}
