/**
 * `ProjectMemberAddedNotifier` 的实现（#4787）：项目负责人按姓名把组织成员加进通用项目之后，
 * 告诉被加的人「你被加进了项目 X」。
 *
 * 不碰 SQL：项目名走既有的 `ProjectNameLookupPort`（只读 `name` 一列），姓名 / 邮箱走 `CredentialRepository`
 * ——所以本文件不点名任何租户表，不需要 `lint-permission-paths` 的豁免。
 *
 * 通道与降级：先发事务邮件（经 `NotifyingMailTransport`——邮件真正发出后它会自己往收件人的通知中心推一条
 * `email` 收据，所以成功时站内恰好一条）；邮件没发出去（没配好 / 发送失败 / 账号没邮箱）⇒ 直接往通知中心
 * 推一条 `system` 通知兜底。无论哪条路径，调用方（`addNonWorkshopMember`）都把本方法的任何抛出吞掉记日志，
 * 绝不回滚已经写入的加人。
 *
 * 去重：站内通知的 `sourceKey` 带 `projectId:userId:role`——同一档位重复加同一个人只通知一次，
 * 改档（collaborator→owner）会再通知。
 */
import type { CredentialRepository } from "../../application/auth/ports";
import type { NotificationPublisher } from "../../application/notifications/notification-center";
import type { TransactionalMailTransport } from "../../application/notifications/transactional-mail-ports";
import type { ProjectNameLookupPort } from "../../application/project/ports";
import { buildMemberAddedNotice } from "../../application/project/project-invitation-mail";
import type { ProjectMemberAddedNotifier } from "../../application/project/project-invitation-ports";
import type { OrgId } from "../../domain/org-id";

export class DefaultProjectMemberAddedNotifier implements ProjectMemberAddedNotifier {
  constructor(
    private readonly projects: ProjectNameLookupPort,
    private readonly credentials: Pick<CredentialRepository, "findByUserId">,
    private readonly notifications: NotificationPublisher,
    private readonly mail: TransactionalMailTransport,
    /** 惰性取：生产配置缺项时读它会抛。 */
    private readonly appPublicUrl: () => string,
  ) {}

  async notifyAdded(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly userId: string;
    readonly actorId: string;
    readonly role: "owner" | "collaborator";
  }): Promise<void> {
    const projectName = await this.projects.findName(input.orgId, input.projectId);
    if (projectName === null) return;
    const [inviter, target] = await Promise.all([
      this.credentials.findByUserId(input.actorId),
      this.credentials.findByUserId(input.userId),
    ]);

    const notice = buildMemberAddedNotice({
      projectName,
      inviterName: inviter?.displayName ?? "项目负责人",
      role: input.role,
    });

    if (target !== null) {
      try {
        const link = `${this.appPublicUrl().replace(/\/+$/, "")}/projects/${encodeURIComponent(input.projectId)}`;
        await this.mail.send({ to: target.email, subject: notice.title, text: `${notice.body}\n\n打开项目：${link}` });
        return; // 邮件成功 ⇒ NotifyingMailTransport 已推过站内收据
      } catch {
        // 落到下面的站内通知兜底。
      }
    }
    await this.notifications.publish({
      orgId: input.orgId,
      userId: input.userId,
      kind: "system",
      title: notice.title,
      body: notice.body,
      sourceKey: `project-member-added:${input.projectId}:${input.userId}:${input.role}`,
    });
  }
}
