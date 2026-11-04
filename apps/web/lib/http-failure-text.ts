/**
 * HTTP 状态 → 一句**能照着做**的话。单源。
 *
 * 2026-09-23 从 `lib/design-failure.ts` 里原样搬出来：产物取源
 * （`lib/chat-workbench/artifact-failure.ts`）需要同一份兜底，而这个仓库的头号病
 * 就是同一事实声明在两处——已经因此漂移过十一次。与其抄第二份，不如现在就收敛。
 *
 * 它只负责「不是本束已知错误码」时的兜底；各束自己的码→人话表仍然各归各家
 * （闭集断言要贴着各自的契约，合成一张大表反而会让漏配的码编译得过）。
 */
import type { Locale } from "./i18n/locale";
import { translate } from "./i18n/messages";

export function httpFailureText(status: number, locale: Locale = "zh-CN"): string {
  if (status === 401) return translate(locale, "common.http.auth");
  if (status === 403) return translate(locale, "common.http.forbidden");
  if (status === 404) return translate(locale, "common.http.notFound");
  if (status === 429) return translate(locale, "common.http.rateLimit");
  if (status >= 500) return translate(locale, "common.http.server");
  return translate(locale, "common.http.failure");
}
