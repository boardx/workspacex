import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import { apiRequest, apiUrl, getStoredSessionToken, ApiError, type ApiRequestOptions } from "@/lib/api-client";
import { SurveyPublishBlockerSchema, type SurveyPublishBlocker } from "@repo/contracts/survey";
import { SurveySourceStateSchema, type SurveySourceState } from "@repo/contracts/survey-runtime";
import type { z } from "zod";

export class SurveyPublishBlockedError extends Error {
  constructor(readonly blockers: SurveyPublishBlocker[]) {
    super(surveyRuntimeMessages.publishBlocked);
    this.name = "SurveyPublishBlockedError";
  }
}

export class SurveyConflictError extends Error {
  constructor(readonly reasonCode: string | null) {
    super(
      reasonCode === "ANONYMITY_IMMUTABLE"
        ? surveyRuntimeMessages.anonymity
        : reasonCode === 'SURVEY_ALREADY_SUBMITTED'
          ? surveyRuntimeMessages.submitted
        : reasonCode === "INVALID_TRANSITION"
          ? surveyRuntimeMessages.transition
          : surveyRuntimeMessages.conflict,
    );
    this.name = "SurveyConflictError";
  }
}

export class SurveySystemError extends Error {
  readonly retryable = true;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SurveySystemError";
  }
}

export async function surveyRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  try {
    const response = await apiRequest<unknown>(path, options);
    if (!schema) return response as T;
    const parsed = schema.safeParse(response);
    if (!parsed.success)
      throw new SurveySystemError(surveyRuntimeMessages.invalidData);
    return parsed.data;
  } catch (error) {
    if (error instanceof SurveySystemError) throw error;
    if (error instanceof ApiError) {
      if (error.reasonCode === "SURVEY_NOT_STARTED") throw new SurveySystemError(surveyRuntimeMessages.notStarted);
      if (error.reasonCode === "SURVEY_COLLECTION_WINDOW_INVALID") throw new SurveySystemError(surveyRuntimeMessages.invalidWindow);
      if (error.status === 422 && error.reasonCode === "SURVEY_PUBLISH_BLOCKED") {
        const raw = error.raw as { blockers?: unknown } | null;
        const blockers = SurveyPublishBlockerSchema.array().safeParse(raw?.blockers);
        if (blockers.success) throw new SurveyPublishBlockedError(blockers.data);
      }
      if (error.status === 409) throw new SurveyConflictError(error.reasonCode);
      if (error.status === 401) throw new SurveySystemError(surveyRuntimeMessages.login);
      if (error.status === 404) throw new SurveySystemError(surveyRuntimeMessages.notFound);
      if (error.status === 410) throw new SurveySystemError(surveyRuntimeMessages.closed);
      if (error.status === 429) throw new SurveySystemError(surveyRuntimeMessages.rateLimit);
      if (error.status === 400) throw new SurveySystemError(surveyRuntimeMessages.invalidRequest);
    }
    throw new SurveySystemError(surveyRuntimeMessages.network, { cause: error });
  }
}

/** Read Markdown source exactly as validated by the API; this helper never generates local source. */
export function surveySourceRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<SurveySourceState> {
  return surveyRequest(path, options, SurveySourceStateSchema);
}

/** Fetch protected bytes before creating a local download; never expose a public object URL. */
export async function downloadSurveyAttachment(surveyId: string, responseId: string, attachmentId: string): Promise<void> {
  const token = getStoredSessionToken();
  if (!token) throw new Error(surveyRuntimeMessages.attachmentLogin);
  let response: Response;
  try {
    const path = `/surveys/${encodeURIComponent(surveyId)}/responses/${encodeURIComponent(responseId)}/attachments/${encodeURIComponent(attachmentId)}/content`;
    response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch { throw new Error(surveyRuntimeMessages.attachmentNetwork); }
  if (response.status === 401) throw new Error(surveyRuntimeMessages.attachmentExpired);
  if (response.status === 403 || response.status === 404) throw new Error(surveyRuntimeMessages.attachmentAccess);
  if (!response.ok) throw new Error(surveyRuntimeMessages.attachmentServer);
  let filename = "问卷附件";
  const encoded = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { filename = decodeURIComponent(encoded).replace(/[\\/\r\n\x00]/g, "_"); } catch { /* Keep the safe fallback. */ } }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
