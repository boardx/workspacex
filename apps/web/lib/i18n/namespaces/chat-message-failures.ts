export const chatMessageFailuresZhCN = {
  "chatMessageFailures.unauthenticated": "{action}失败：登录已失效（HTTP 401），请重新登录。",
  "chatMessageFailures.forbidden": "{action}失败：当前身份没有写入权限（HTTP 403）。",
  "chatMessageFailures.skillMissing": "{action}失败：该 skill 不存在或当前身份不可见（HTTP 404）。",
  "chatMessageFailures.threadMissing": "{action}失败：对话不存在或当前身份不可见（HTTP 404）。",
  "chatMessageFailures.idempotency": "{action}失败：同一 clientMessageId 已对应其他内容（HTTP 409），未创建重复消息。",
  "chatMessageFailures.conflict": "{action}失败：对话状态冲突或已归档（HTTP 409）。",
  "chatMessageFailures.invalid": "{action}失败：消息无效或所选 Agent 没有可用的已发布版本（HTTP 422）。",
  "chatMessageFailures.unavailable": "{action}失败：授权或依赖服务暂不可用（HTTP 503），系统没有降级到 mock。",
  "chatMessageFailures.http": "{action}失败：{reason}（HTTP {status}）。",
  "chatMessageFailures.error": "{action}失败：{message}",
  "chatMessageFailures.unknown": "{action}失败，请稍后重试。",
} as const;

export const chatMessageFailuresEn: Record<keyof typeof chatMessageFailuresZhCN, string> = {
  "chatMessageFailures.unauthenticated": "{action} failed: your session has expired (HTTP 401). Sign in again.",
  "chatMessageFailures.forbidden": "{action} failed: the current identity does not have write permission (HTTP 403).",
  "chatMessageFailures.skillMissing": "{action} failed: this skill does not exist or is not visible to the current identity (HTTP 404).",
  "chatMessageFailures.threadMissing": "{action} failed: this conversation does not exist or is not visible to the current identity (HTTP 404).",
  "chatMessageFailures.idempotency": "{action} failed: the same clientMessageId already refers to different content (HTTP 409). No duplicate message was created.",
  "chatMessageFailures.conflict": "{action} failed: the conversation state conflicts or it has been archived (HTTP 409).",
  "chatMessageFailures.invalid": "{action} failed: the message is invalid or the selected agent has no available published version (HTTP 422).",
  "chatMessageFailures.unavailable": "{action} failed: authorization or a required service is temporarily unavailable (HTTP 503).",
  "chatMessageFailures.http": "{action} failed: {reason} (HTTP {status}).",
  "chatMessageFailures.error": "{action} failed: {message}",
  "chatMessageFailures.unknown": "{action} failed. Try again later.",
};
