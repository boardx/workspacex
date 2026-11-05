import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/messages";
import { ApiError } from "@/lib/api-client";

/**
 * 会话/编制写操作失败的用户可见文案。
 *
 * 抽成单一事实源是 issue #2052（CK-P7）逼出来的：CopilotKit v2 外壳现在也要做编制
 * 增删，而这份措辞原本私有在 `chat-read-screen.tsx` 里。两条轨道各写一份，同一个
 * `VERSION_CHANGED` 就会有两句不一样的话——那正是本仓「同一事实不得声明在两处」
 * 要挡的东西。措辞逐字保持不变（旧轨道的 UI 测试断言的就是这些字）。
 */
export function describeMutateFailure(failure: unknown, locale: Locale = DEFAULT_LOCALE): string {
  if (failure instanceof ApiError) {
    if (failure.reasonCode === "NO_WRITE_ROLE") return translate(locale, "chatErrors.noWrite");
    if (failure.reasonCode === "VERSION_CHANGED") return translate(locale, "chatErrors.versionChanged");
    if (failure.reasonCode === "TITLE_INVALID") return translate(locale, "chatErrors.invalidTitle");
    if (failure.reasonCode === "THREAD_ARCHIVED_READONLY") return translate(locale, "chatErrors.archived");
    return translate(locale, "chatErrors.http", { reason: failure.reasonCode ?? translate(locale, "chatErrors.operationFailed"), status: failure.status });
  }
  return failure instanceof Error ? failure.message : translate(locale, "chatErrors.generic");
}
