/**
 * 产物取源失败 → 人话（单源）。
 *
 * ## 为什么需要它（2026-09-23）
 *
 * `chat-artifact-preview-dialog.tsx` 原本写的是
 * `e.reasonCode ?? \`HTTP ${e.status}\``——把**内部错误码原样端给用户**，屏上出现的是
 * 「NOT_VISIBLE」或「HTTP 503」。R2 把取源抽进 `chat-artifact-view.tsx` 时，我把这一行
 * 一起搬了过去，还在注释里替它辩护了一句「错码原样回显，不糊成一句加载失败」。
 *
 * 那句辩护只对了一半：**要区分不同失败**是对的（NOT_VISIBLE 与 STORAGE_UNAVAILABLE
 * 的处置完全不同），但「区分」不等于「把码端出去」。码→人话的穷举表两件事都做到：
 * 每个码有自己的一句话，而用户不必认识那个码。这也正是 `lint-user-facing-error-text`
 * 这道门要的（见其文件头注：规范早就有，落地只在改过的那一个文件里成立）。
 *
 * ⚠ 键集合是契约闭集，**漏一个编译不过**——契约给 `getThreadArtifactSource` 新增
 * 错误码却没配人话，会在这里当场变成 TS 错误，而不是悄悄退回到那个码本身。
 * 同 `lib/design-failure.ts` 的写法；HTTP 兜底两处共用 `lib/http-failure-text.ts`。
 */
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";

/** `chat.getThreadArtifactSource.err` 的闭集（见 packages/contracts/src/chat.ts）。 */
type ArtifactSourceError = "NOT_VISIBLE" | "STORAGE_UNAVAILABLE";

const ERROR_TEXT: Record<ArtifactSourceError, string> = {
  // 契约上「不存在」与「不可见」同码同语义（I-36），所以这句话两种情形都要说得通。
  NOT_VISIBLE: "这份产物你现在看不到：可能是别人的草稿，也可能已经被删掉",
  STORAGE_UNAVAILABLE: "产物内容暂时读不出来（存储服务不可用），稍后再试一次",
};

export function describeArtifactFailure(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && code in ERROR_TEXT) return ERROR_TEXT[code as ArtifactSourceError];
    return httpFailureText(err.status);
  }
  if (err instanceof TypeError) return "连不上服务器，检查一下网络再试";
  // 兜底同样不端出内部细节：`String(err)` 在这里多半是一段栈或一句英文异常。
  return "这份产物没能打开，稍后再试一次";
}
