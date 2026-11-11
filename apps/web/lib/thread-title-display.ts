/**
 * 线程标题的展示兜底（UIUX r1 屏 4 P0-2）：服务端起名已剥控制标记（`domain/chat/thread-title.ts`），
 * 这里只救**存量**标题——修复前落库的「UIUX [start_workflow:W0…」。规则只有一份：`chat.stripControlMarkers`。
 * 剥完为空（整条标题都是标记）⇒ `undefined`，调用点落回各自的默认名。
 */
import { chat } from "@repo/contracts";
import { DEFAULT_LOCALE } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/messages";

export function displayThreadTitle(title: string | null | undefined): string | undefined {
  if (typeof title !== "string") return undefined;
  const clean = chat.stripControlMarkers(title);
  return clean === "" ? undefined : clean;
}

/** The persisted default title is also the server's automatic naming sentinel. */
export function displayConversationTitle(title: string | null | undefined, localizedDefault: string): string | undefined {
  const clean = displayThreadTitle(title);
  return clean === translate(DEFAULT_LOCALE, "chatEntry.untitled") ? localizedDefault : clean;
}
