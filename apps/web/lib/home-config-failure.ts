/**
 * 组织首页配置失败 → 人话（单源，`home-screen.tsx`/`home-config-screen.tsx` 共用）。
 *
 * `lint-user-facing-error-text` 不许把内部错误码原样端给用户——同 `lib/design-failure.ts`/
 * `lib/chat-workbench/artifact-failure.ts` 的既有写法：契约闭集穷举，漏一个编译不过；
 * HTTP 兜底复用 `lib/http-failure-text.ts`。
 */
import type { Locale } from "./i18n/locale";
import { translate, type MessageKey } from "./i18n/messages";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import type { homeConfig } from "@repo/contracts";
import type { z } from "zod";

type HomeConfigErrorCode = z.infer<typeof homeConfig.HomeConfigError>;
const ERROR_MESSAGE: Record<HomeConfigErrorCode, MessageKey> = {
  NO_ORG_MEMBERSHIP: "home.error.NO_ORG_MEMBERSHIP",
  FORBIDDEN: "home.error.FORBIDDEN",
  BANNER_ARTIFACT_NOT_OWNED: "home.error.BANNER_ARTIFACT_NOT_OWNED",
  BANNER_COLOR_REQUIRED: "home.error.BANNER_COLOR_REQUIRED",
  FILE_TOO_LARGE: "home.error.FILE_TOO_LARGE",
  UNSUPPORTED_CONTENT_TYPE: "home.error.UNSUPPORTED_CONTENT_TYPE",
};

export function describeHomeConfigFailure(err: unknown, locale: Locale = "zh-CN"): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && Object.hasOwn(ERROR_MESSAGE, code)) return translate(locale, ERROR_MESSAGE[code as HomeConfigErrorCode]);
    return httpFailureText(err.status, locale);
  }
  return translate(locale, err instanceof TypeError ? "common.error.network" : "home.configFailed");
}
