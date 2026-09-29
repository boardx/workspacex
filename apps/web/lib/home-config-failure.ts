/**
 * 组织首页配置失败 → 人话（单源，`home-screen.tsx`/`home-config-screen.tsx` 共用）。
 *
 * `lint-user-facing-error-text` 不许把内部错误码原样端给用户——同 `lib/design-failure.ts`/
 * `lib/chat-workbench/artifact-failure.ts` 的既有写法：契约闭集穷举，漏一个编译不过；
 * HTTP 兜底复用 `lib/http-failure-text.ts`。
 */
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import type { homeConfig } from "@repo/contracts";
import type { z } from "zod";

type HomeConfigErrorCode = z.infer<typeof homeConfig.HomeConfigError>;

const ERROR_TEXT: Record<HomeConfigErrorCode, string> = {
  NO_ORG_MEMBERSHIP: "你不是这个组织的成员，看不到它的首页配置",
  FORBIDDEN: "首页配置仅组织管理员可编辑",
};

export function describeHomeConfigFailure(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && code in ERROR_TEXT) return ERROR_TEXT[code as HomeConfigErrorCode];
    return httpFailureText(err.status);
  }
  if (err instanceof TypeError) return "连不上服务器，检查一下网络再试";
  return "首页配置没能加载，稍后再试一次";
}
