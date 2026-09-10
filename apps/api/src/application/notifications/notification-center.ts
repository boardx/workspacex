import type { z } from "zod";
import type { NotificationKind, NotificationListOutput, NotificationReadInput, NotificationReadOutput } from "@repo/contracts/notifications";
import type { OrgId } from "../../domain/org-id";
/**
 * 全局通知中心端口。任何模块（run 状态、邮件、定时任务……）都通过 `publish` 往里推，
 * 前端只通过 `list`/`markRead` 读。推送方不关心谁在看，读的一方不关心谁推的。
 */
export const NOTIFICATION_CENTER = Symbol("NotificationCenter");
export interface NotificationViewer { readonly orgId: OrgId; readonly userId: string }
export interface PublishNotificationInput {
  /** 为 null 时是跨组织的个人通知（邮件），在用户任意组织下都能看到。 */
  readonly orgId: OrgId | null;
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly threadId?: string | null;
  /** 待办（等你授权/确认）还是收据（已完成/失败/邮件）。见 contracts/notifications.ts。 */
  readonly actionable?: boolean;
  /** 同一事实的去重键；重复 publish 静默忽略。 */
  readonly sourceKey?: string | null;
}
export interface NotificationPublisher {
  publish(input: PublishNotificationInput): Promise<void>;
  /**
   * 把收件人名下**同一件事**的旧**待办**通知读掉（issue #3311）。
   *
   * 待办通知（等你授权工具/确认计划）点开不再顺手标已读——事情还没办。那它由谁收掉？
   * 由这件事往前走一步的人：`sourceKeyPrefix` 圈出这件事的所有收据，`exceptSourceKey`
   * 保住刚要推的这一条。只动 `actionable` 的行：收据是历史事实，不许被后来的状态抹掉。
   */
  supersede(viewer: NotificationViewer, input: SupersedeNotificationsInput): Promise<void>;
}
export interface SupersedeNotificationsInput {
  /** 形如 `run:<id>:%` 的 LIKE 模式，圈定同一件事的所有通知。 */
  readonly sourceKeyPrefix: string;
  /** 不许收掉的那一条（通常是正要推的新通知）。 */
  readonly exceptSourceKey: string;
}
export interface NotificationCenter extends NotificationPublisher {
  list(viewer: NotificationViewer): Promise<z.infer<typeof NotificationListOutput>>;
  markRead(viewer: NotificationViewer, input: z.infer<typeof NotificationReadInput>): Promise<z.infer<typeof NotificationReadOutput>>;
}
