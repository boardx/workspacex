import type { Locale } from "@/lib/i18n/locale";
import { displaySurveyRuntimeError } from "./display-runtime-error";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";

export type SurveyDisplayMessage =
  | { key: MessageKey; params?: MessageParams }
  | { raw: string }
  | { error: Error };
type Translator = (key: MessageKey, params?: MessageParams) => string;

/** Resolve fixed notices at render time; authored and unknown diagnostics stay literal. */
export function displaySurveyMessage(message: SurveyDisplayMessage, t: Translator, locale: Locale): string {
  if ("error" in message) return displaySurveyRuntimeError(message.error, t, locale);
  return "raw" in message ? message.raw : t(message.key, message.params);
}

export function surveyErrorMessage(cause: unknown, fallback: MessageKey): SurveyDisplayMessage {
  return cause instanceof Error ? { error: cause } : { key: fallback };
}
