import type { MessageKey } from "@/lib/i18n/messages";

/** Known authoring statuses; publication overrides belong to the library's runtime data. */
export function surveyAuthoringStatusMessageKey(status: string): MessageKey | null {
  if (status === "ready") return "survey.library.statusReady";
  if (status === "draft") return "survey.library.statusDraft";
  return null;
}
