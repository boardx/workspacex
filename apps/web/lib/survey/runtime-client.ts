import { apiRequest, apiUrl, getStoredSessionToken, ApiError, type ApiRequestOptions } from "@/lib/api-client";
export async function surveyRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 409)
        throw new Error("数据已更新，请刷新后重试。当前未保存的修改仍保留。");
      if (error.status === 401) throw new Error("请先登录后再操作。");
      if (error.status === 404) throw new Error("问卷不存在或没有访问权限。");
      if (error.status === 410)
        throw new Error("问卷已关闭、已过期或题目已锁定。");
      if (error.status === 429) throw new Error("提交过于频繁，请稍后重试。");
      if (error.status === 400)
        throw new Error("请检查题目、模板配置和有效答卷后重试。");
    }
    throw new Error("请求未完成，请检查网络后重试。");
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
