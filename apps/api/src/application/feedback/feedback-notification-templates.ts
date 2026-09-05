/**
 * 反馈提交人会收到的事务邮件——**文案单源**（UC-17.8 B6.3）。
 *
 * ## 为什么是一份"事件种类 + 模板"的表，而不是各用例各拼一段
 *
 * 在 B6.3 之前只有一种通知：分诊转移之后的「状态已更新」（`triage-feedback.ts` 私有函数
 * `statusChangeEmail`，事件行 `product_feedback_status_events` 的 `email_subject`/`email_text`
 * 存的就是它的产物）。B6.3 backlog 条目原文要求「新增『反馈已生成设计方案』事件类型」——
 * 但那个事件**进不了** `product_feedback_status_events`（列 CHECK 只认四态、契约 `FeedbackStatus`
 * 闭集，见 `design-workbench/push-to-inbox.ts` 头注「没有落库」一节），所以"事件类型"落在
 * **通知层**：本文件的 `FEEDBACK_NOTIFICATION_KINDS` 是"提交人会因为什么事收到邮件"的唯一
 * 声明处，每一种对应一个模板函数。两个用例（`triage-feedback.ts` / `push-to-inbox.ts`）只
 * 引用这里，不各自复制一份文案——AGENTS.md「同一事实不得声明在两处」。
 *
 * ⚠ 这里**只有文案**，不含收件人解析（`FeedbackSubmitterDirectory`）、不含发送
 *   （`TransactionalMailTransport`）：端口头注写明"内容由调用方拼好再传进来"，这份文件
 *   就是"拼好"那一步，放在 application 层是因为它是业务文案，不是呈现（呈现外壳在
 *   `infrastructure/notifications/email-branding.ts`）。
 */
import type { FeedbackStatus } from "../../domain/feedback/product-feedback";

/**
 * 提交人会收到邮件的事件种类：
 *   · `status_changed`   —— 分诊把状态迁到了另一个值（`triageFeedback`，best-effort，
 *                           结果回填到事件行 `notified`/`email_subject`/`email_text`）。
 *   · `design_generated` —— 由这条反馈深化出来的设计方案被推送进收件箱、反馈的
 *                           `resolved_by_design_id` 首次指向它（`pushToInbox`，best-effort，
 *                           **不落任何事件行**——见文件头）。
 */
export const FEEDBACK_NOTIFICATION_KINDS = ["status_changed", "design_generated"] as const;
export type FeedbackNotificationKind = (typeof FEEDBACK_NOTIFICATION_KINDS)[number];

export interface FeedbackNotificationEmail {
  readonly kind: FeedbackNotificationKind;
  readonly subject: string;
  readonly text: string;
}

export function statusChangeEmail(input: {
  readonly title: string;
  readonly status: FeedbackStatus;
  readonly reason: string | null;
}): FeedbackNotificationEmail {
  // ⚠ 2026-09-04 #2682:此前 subject 里只有状态、没有标题——收信人在邮件列表/通知里
  //   只看得到「你的反馈状态已更新为『已修复』」，同时提交过多条反馈时完全分不清
  //   说的是哪一条,要点开正文才知道。标题是用户当初自己填的、最直观的识别信息,
  //   拼进 subject 里让收件箱一栏就能认出来,不必逐封点开对照。
  const subject = `你的反馈《${input.title}》状态已更新为「${input.status}」`;
  const lines = [
    `你提交的反馈《${input.title}》状态已更新为「${input.status}」。`,
    input.reason !== null ? `处理说明:${input.reason}` : null,
  ].filter((line): line is string => line !== null);
  return { kind: "status_changed", subject, text: lines.join("\n") };
}

/**
 * 「你的反馈已生成设计方案 D-X」。`inboxCode` 就是收件箱里那条设计条目的编号
 * （`pushToInbox` 返回值的 `inboxCode`，同 drawer 上「已生成 D-2」关联标读到的那个），
 * 邮件里用同一个编号，用户在收件箱按它找得到。
 */
export function designGeneratedEmail(input: {
  readonly title: string;
  readonly inboxCode: string;
  readonly designName: string;
}): FeedbackNotificationEmail {
  const subject = `你的反馈《${input.title}》已生成设计方案 ${input.inboxCode}`;
  const text = [
    `你提交的反馈《${input.title}》已由产品团队深化为设计方案「${input.designName}」（收件箱编号 ${input.inboxCode}），并已推送到收件箱。`,
    `你可以在收件箱里按编号 ${input.inboxCode} 找到它。`,
  ].join("\n");
  return { kind: "design_generated", subject, text };
}
