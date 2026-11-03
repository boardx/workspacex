/**
 * 设计工作台的失败 → 人话（单源）。
 *
 * 迭代 27 起放在 `detail-screen.tsx` 里；迭代 28 搬到这里——属性面板与版本历史面板各自
 * 抄着一份 `err.reasonCode ?? \`http_${err.status}\`` 的老写法，在同一屏上把同一类失败
 * 说成两种话（一种是人话、两种是内部码）。同一事实不得声明在两处：三处共用这一份。
 */
import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { ApiError } from "@/lib/api-client";
// HTTP 兜底搬到 `lib/http-failure-text.ts`（产物取源也要用同一份，见该文件头注）。
import { httpFailureText } from "@/lib/http-failure-text";
import { designWorkbench, feedbackLoop } from "@repo/contracts";

/**
 * 迭代 27 —— 错误码 → 人话。
 *
 * `describeFailure` 原来是 `err.reasonCode ?? \`http_${err.status}\``，也就是把**内部错误码
 * 原样端给用户**：屏上出现的是「没能发送（PROJECT_NOT_FOUND），已保留草稿」
 * 「没能推送到收件箱（http_500）」。对一个不做设计、也不看代码的人，这既不说明发生了什么，
 * 更不说明下一步该做什么——而这正是他最需要一句人话的时刻。`detail-screen` 里有 37 处用它。
 *
 * ⚠ 键集合是契约闭集 `DesignWorkbenchError`，**漏一个编译不过**——契约新增一个错误码却
 *   没给人话，会在这里当场变成 TS 错误，而不是悄悄退回到那个码本身。
 */
const ERROR_TEXT: Record<designWorkbench.DesignWorkbenchError, MessageKey> = {
  PROJECT_NOT_FOUND: "failures.design.PROJECT_NOT_FOUND",
  NAME_REQUIRED: "failures.design.NAME_REQUIRED",
  NOT_PROJECT_OWNER: "failures.design.NOT_PROJECT_OWNER",
  DEPENDENCY_UNAVAILABLE: "failures.design.DEPENDENCY_UNAVAILABLE",
  VERSION_NOT_FOUND: "failures.design.VERSION_NOT_FOUND",
  REF_IMAGE_REJECTED: "failures.design.REF_IMAGE_REJECTED",
  PROTOTYPE_PATCH_REJECTED: "failures.design.PROTOTYPE_PATCH_REJECTED",
  FEEDBACK_NOT_FOUND: "failures.design.FEEDBACK_NOT_FOUND",
  FEEDBACK_DETAIL_NOT_VISIBLE: "failures.design.FEEDBACK_DETAIL_NOT_VISIBLE",
  PROJECT_NOT_PUSHED: "failures.design.PROJECT_NOT_PUSHED",
  DESIGN_ISSUE_ALREADY_EXISTS: "failures.design.DESIGN_ISSUE_ALREADY_EXISTS",
  DESIGN_ISSUE_IN_PROGRESS: "failures.design.DESIGN_ISSUE_IN_PROGRESS",
  DESIGN_ISSUE_CREATION_FAILED: "failures.design.DESIGN_ISSUE_CREATION_FAILED",
  SHARE_NOT_FOUND: "failures.design.SHARE_NOT_FOUND",
  NOTHING_TO_PUBLISH: "failures.design.NOTHING_TO_PUBLISH",
  COMMENT_NOT_FOUND: "failures.design.COMMENT_NOT_FOUND",
  NOT_COMMENT_AUTHOR: "failures.design.NOT_COMMENT_AUTHOR",
  COMMENT_LIMIT_REACHED: "failures.design.COMMENT_LIMIT_REACHED",
};

/**
 * 迭代 35 —— 反馈束的错误码 → 人话。
 *
 * 把 `feedback-dialog.tsx` 那第五份本地 `describeFailure` 并进来时才发现：并进来只挡住了
 * 「码上屏」，却把**反馈自己的那些码**一律落到那句泛泛的兜底（「出了点问题」）。
 * 而提反馈的人最需要知道的恰恰是具体那件事——他刚写的那段还在不在、该重试还是该找人。
 * 所以这里再穷举一张反馈束的表，与上面那张并列。
 *
 * ⚠ 同样是契约闭集 `FeedbackError`，漏一个编译不过。
 */
const FEEDBACK_ERROR_TEXT: Record<feedbackLoop.FeedbackError, MessageKey> = {
  FEEDBACK_NOT_FOUND: "failures.feedback.FEEDBACK_NOT_FOUND",
  PERMISSION_REVOKED: "failures.feedback.PERMISSION_REVOKED",
  TRIAGE_REASON_REQUIRED: "failures.feedback.TRIAGE_REASON_REQUIRED",
  DEPENDENCY_UNAVAILABLE: "failures.feedback.DEPENDENCY_UNAVAILABLE",
  NO_GITHUB_ISSUE: "failures.feedback.NO_GITHUB_ISSUE",
  COMMENT_BODY_REQUIRED: "failures.feedback.COMMENT_BODY_REQUIRED",
  FILE_TOO_LARGE: "failures.feedback.FILE_TOO_LARGE",
  UNSUPPORTED_CONTENT_TYPE: "failures.feedback.UNSUPPORTED_CONTENT_TYPE",
  MALWARE_DETECTED: "failures.feedback.MALWARE_DETECTED",
  STRUCTURING_FAILED: "failures.feedback.STRUCTURING_FAILED",
  DRAFT_NOT_FOUND: "failures.feedback.DRAFT_NOT_FOUND",
  DRAFT_EMPTY: "failures.feedback.DRAFT_EMPTY",
};

export function describeFailure(err: unknown, locale: Locale = "zh-CN"): string {
  if (err instanceof ApiError) {
    const code = err.reasonCode;
    if (code !== null && Object.hasOwn(ERROR_TEXT, code)) return translate(locale, ERROR_TEXT[code as designWorkbench.DesignWorkbenchError]);
    if (code !== null && Object.hasOwn(FEEDBACK_ERROR_TEXT, code)) return translate(locale, FEEDBACK_ERROR_TEXT[code as feedbackLoop.FeedbackError]);
    return httpFailureText(err.status, locale);
  }
  if (err instanceof TypeError) return translate(locale, "failures.network");
  // 兜底同样不端出内部细节：`String(err)` 在这里多半是一段栈或一句英文异常。
  return translate(locale, "failures.unknown");
}
