import type { MessageKey, MessageParams } from "@/lib/i18n/messages";

export type SurveyDisplayMessage =
  | { key: MessageKey; params?: MessageParams }
  | { raw: string };
type Translator = (key: MessageKey, params?: MessageParams) => string;

/** Resolve fixed notices at render time; authored and unknown diagnostics stay literal. */
export function displaySurveyMessage(message: SurveyDisplayMessage, t: Translator): string {
  return "raw" in message ? message.raw : t(message.key, message.params);
}

export function surveyErrorMessage(cause: unknown, fallback: MessageKey): SurveyDisplayMessage {
  return cause instanceof Error ? { raw: cause.message } : { key: fallback };
}
