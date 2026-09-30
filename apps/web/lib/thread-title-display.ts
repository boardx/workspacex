/**
 * 线程标题的展示兜底（UIUX r1 屏 4 P0-2）：服务端起名已剥控制标记（`domain/chat/thread-title.ts`），
 * 这里只救**存量**标题——修复前落库的「UIUX [start_workflow:W0…」。规则只有一份：`chat.stripControlMarkers`。
 * 剥完为空（整条标题都是标记）⇒ `undefined`，调用点落回各自的默认名。
 */
import { chat } from "@repo/contracts";

export function displayThreadTitle(title: string | null | undefined): string | undefined {
  if (typeof title !== "string") return undefined;
  const clean = chat.stripControlMarkers(title);
  return clean === "" ? undefined : clean;
}
