import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";
import { displaySurveyDiagnostic } from "./display-diagnostic";
import { surveyRuntimeErrorCatalogue, surveyRuntimeMessages } from "./runtime-error-copy";
type Translator = (key: MessageKey, params?: MessageParams) => string;
const identities = Object.fromEntries(Object.entries(surveyRuntimeErrorCatalogue).map(([key, pair]) => [pair[0], `survey.runtimeError.${key}`])) as Record<string, MessageKey>;
type SourceDiagnostic = { line: number; message: string };
export class SurveyDesignDiagnosticsError extends Error {
  constructor(readonly diagnostics: readonly SourceDiagnostic[]) {
    super(diagnostics.map(entry => `第 ${entry.line} 行：${entry.message}`).join("；"));
  }
}
/** Resolve display copy with the current locale; preserve unknown/raw diagnostics. */
export function displaySurveyRuntimeError(error: Error | string, t: Translator, locale: Locale): string {
  if (error instanceof ApiError) return httpFailureText(error.status, locale);
  if (error instanceof Error && error.cause instanceof ApiError && error.cause.status === 403) return httpFailureText(403, locale);
  if (error instanceof SurveyDesignDiagnosticsError) return error.diagnostics.map(entry => t("survey.design.diagnosticLine", { line: entry.line, message: displaySurveyDiagnostic(entry.message, t) })).join(locale === "en" ? "; " : "；");
  const message = error instanceof Error ? error.message : error;
  const [prefix, suffix] = surveyRuntimeMessages.reportImageMissing.split("{title}") as [string, string];
  if (message.length >= prefix.length + suffix.length && message.startsWith(prefix) && message.endsWith(suffix)) {
    return t("survey.runtimeError.reportImageMissing", { title: message.slice(prefix.length, message.length - suffix.length) });
  }
  return Object.hasOwn(identities, message) ? t(identities[message]!) : message;
}
