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
  /** 同一事实的去重键；重复 publish 静默忽略。 */
  readonly sourceKey?: string | null;
}
export interface NotificationPublisher {
  publish(input: PublishNotificationInput): Promise<void>;
}
export interface NotificationCenter extends NotificationPublisher {
  list(viewer: NotificationViewer): Promise<z.infer<typeof NotificationListOutput>>;
  markRead(viewer: NotificationViewer, input: z.infer<typeof NotificationReadInput>): Promise<z.infer<typeof NotificationReadOutput>>;
}
