import { z } from "zod";
/**
 * 全局通知中心（2026-09-08 人类直接指令：「任务提醒不工作，做成一个 notification 简单服务，
 * 放在全局，有消息就可以往里面推，邮件的消息也往里面推送」）。
 *
 * 一条通知 = 一个已经发生的事实的**收据**：任务跑完/失败/暂停、给你发了一封邮件、系统消息。
 * 服务端任何模块都可以 `publish`，前端只读 + 标已读。`kind` 是闭集，新来源加枚举值，
 * 不另起第二张表。
 */
export const NotificationKind = z.enum(["task", "email", "system"]);
export const Notification = z.object({
  id: z.string().uuid(),
  kind: NotificationKind,
  title: z.string(),
  body: z.string(),
  /** 点开通知要跳去的对话；邮件/系统消息没有。 */
  threadId: z.string().nullable(),
  /**
   * 这条通知是**待办**还是**收据**（issue #3311）。
   *
   * `true` = 事情还没办（等待你授权工具 / 等待你确认计划）：点击只是把用户送到能办的
   * 地方，**不许**顺手标已读——否则用户被通知有事要办，点进去事没了，也没告诉他去哪办。
   * `false` = 已经发生的收据（已完成 / 执行失败 / 邮件）：点开看结果，看了就读掉。
   *
   * 这是**服务端给的事实**，不许前端拿标题字符串反推（同一事实不得声明在两处）。
   */
  actionable: z.boolean(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
}).strict();
export const NOTIFICATION_PAGE_SIZE = 50;
export const NotificationListOutput = z.object({
  notifications: z.array(Notification).max(NOTIFICATION_PAGE_SIZE),
  unreadCount: z.number().int().min(0),
}).strict();
/** 空 `ids` = 全部标已读。 */
export const NotificationReadInput = z.object({ ids: z.array(z.string().uuid()).max(NOTIFICATION_PAGE_SIZE).optional() }).strict();
export const NotificationReadOutput = z.object({ read: z.number().int().min(0) }).strict();
export const operations = {
  list: { method: "GET", path: "/notifications", out: NotificationListOutput },
  markRead: { method: "POST", path: "/notifications/read", in: NotificationReadInput, out: NotificationReadOutput },
} as const;
export type Notification = z.infer<typeof Notification>;
export type NotificationKind = z.infer<typeof NotificationKind>;
