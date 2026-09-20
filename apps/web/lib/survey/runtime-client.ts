import { apiRequest, ApiError, type ApiRequestOptions } from "@/lib/api-client";
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
