import { apiRequest, apiUrl, getStoredSessionToken, ApiError, type ApiRequestOptions } from "@/lib/api-client";
import { SurveyPublishBlockerSchema, type SurveyPublishBlocker } from "@repo/contracts/survey";
import type { z } from "zod";

export class SurveyPublishBlockedError extends Error {
  constructor(readonly blockers: SurveyPublishBlocker[]) {
    super("问卷尚未达到发布条件");
    this.name = "SurveyPublishBlockedError";
  }
}

export class SurveyConflictError extends Error {
  constructor(readonly reasonCode: string | null) {
    super(
      reasonCode === "ANONYMITY_IMMUTABLE"
        ? "问卷开始回收后不能修改匿名方式。"
        : reasonCode === "INVALID_TRANSITION"
          ? "问卷状态已变化，请刷新后重试。"
          : "数据已更新，请刷新后重试。当前未保存的修改仍保留。",
    );
    this.name = "SurveyConflictError";
  }
}

export class SurveySystemError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
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
      throw new SurveySystemError("服务返回了无法识别的数据，请刷新后重试。");
    return parsed.data;
  } catch (error) {
    if (error instanceof SurveySystemError) throw error;
    if (error instanceof ApiError) {
      if (error.status === 422 && error.reasonCode === "SURVEY_PUBLISH_BLOCKED") {
        const raw = error.raw as { blockers?: unknown } | null;
        const blockers = SurveyPublishBlockerSchema.array().safeParse(raw?.blockers);
        if (blockers.success) throw new SurveyPublishBlockedError(blockers.data);
      }
      if (error.status === 409) throw new SurveyConflictError(error.reasonCode);
      if (error.status === 401) throw new SurveySystemError("请先登录后再操作。");
      if (error.status === 404) throw new SurveySystemError("问卷不存在或没有访问权限。");
      if (error.status === 410) throw new SurveySystemError("问卷已关闭、已过期或题目已锁定。");
      if (error.status === 429) throw new SurveySystemError("提交过于频繁，请稍后重试。");
      if (error.status === 400) throw new SurveySystemError("请检查题目、模板配置和有效答卷后重试。");
    }
    throw new SurveySystemError("请求未完成，请检查网络后重试。");
  }
}

/** Fetch protected bytes before creating a local download; never expose a public object URL. */
export async function downloadSurveyAttachment(surveyId: string, responseId: string, attachmentId: string): Promise<void> {
  const token = getStoredSessionToken();
  if (!token) throw new Error("请先登录后再下载附件。");
  let response: Response;
  try {
    const path = `/surveys/${encodeURIComponent(surveyId)}/responses/${encodeURIComponent(responseId)}/attachments/${encodeURIComponent(attachmentId)}/content`;
    response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch { throw new Error("附件下载失败，请检查网络后重试。"); }
  if (response.status === 401) throw new Error("登录已过期，请重新登录后下载。");
  if (response.status === 403 || response.status === 404) throw new Error("附件不存在或没有访问权限。");
  if (!response.ok) throw new Error("附件下载失败，请稍后重试。");
  let filename = "问卷附件";
  const encoded = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { filename = decodeURIComponent(encoded).replace(/[\\/\r\n\x00]/g, "_"); } catch { /* Keep the safe fallback. */ } }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
