import { NOTIFICATION_PAGE_SIZE, Notification, NotificationListOutput, NotificationReadInput } from "@repo/contracts/notifications";
import type { z } from "zod";
import type { DatabasePort } from "../../application/ports/database.port";
import type { NotificationCenter, NotificationViewer, PublishNotificationInput, SupersedeNotificationsInput } from "../../application/notifications/notification-center";
interface Row { id: string; kind: Notification["kind"]; title: string; body: string; thread_id: string | null; actionable: boolean; created_at: Date; read_at: Date | null }
const project = (row: Row): Notification => Notification.parse({
  id: row.id, kind: row.kind, title: row.title, body: row.body, threadId: row.thread_id, actionable: row.actionable,
  createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null,
});
/** 通知是收据，不是状态机：只有 insert（publish）和 read_at 一次性置位。 */
export class PgNotificationCenter implements NotificationCenter {
  constructor(private readonly db: DatabasePort) {}
  async publish(input: PublishNotificationInput): Promise<void> {
    const run = async (s: { query: (sql: string, params: unknown[]) => Promise<unknown> }) => {
      await s.query(
        `INSERT INTO user_notifications(org_id,user_id,kind,title,body,thread_id,source_key,actionable) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [input.orgId, input.userId, input.kind, input.title.slice(0, 500), input.body.slice(0, 4000), input.threadId ?? null, input.sourceKey ?? null, input.actionable ?? false],
      );
    };
    if (input.orgId) await this.db.withTenant(input.orgId, run); else await this.db.withoutTenant(run);
  }
  /** 见端口注释（#3311）：只读掉这件事的旧**待办**行，收据一行不碰。 */
  async supersede(viewer: NotificationViewer, input: SupersedeNotificationsInput): Promise<void> {
    await this.db.withTenant(viewer.orgId, async (s) => {
      await s.query(
        `UPDATE user_notifications SET read_at=now() WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2) AND source_key LIKE $3 AND source_key<>$4 AND actionable AND read_at IS NULL`,
        [viewer.userId, viewer.orgId, input.sourceKeyPrefix, input.exceptSourceKey],
      );
    });
  }
  async list(viewer: NotificationViewer): Promise<z.infer<typeof NotificationListOutput>> {
    return this.db.withTenant(viewer.orgId, async (s) => {
      const rows = (await s.query<Row>(
        `SELECT id,kind,title,body,thread_id,actionable,created_at,read_at FROM user_notifications WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2) ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT $3`,
        [viewer.userId, viewer.orgId, NOTIFICATION_PAGE_SIZE],
      )).rows;
      const unread = (await s.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM user_notifications WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2) AND read_at IS NULL`,
        [viewer.userId, viewer.orgId],
      )).rows[0];
      return NotificationListOutput.parse({ notifications: rows.map(project), unreadCount: Number(unread?.n ?? 0) });
    });
  }
  async markRead(viewer: NotificationViewer, raw: z.infer<typeof NotificationReadInput>): Promise<{ read: number }> {
    const input = NotificationReadInput.parse(raw);
    return this.db.withTenant(viewer.orgId, async (s) => {
      const result = await s.query<{ id: string }>(
        `UPDATE user_notifications SET read_at=now() WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2) AND read_at IS NULL AND ($3::uuid[] IS NULL OR id=ANY($3::uuid[])) RETURNING id`,
        [viewer.userId, viewer.orgId, input.ids?.length ? input.ids : null],
      );
      return { read: result.rows.length };
    });
  }
}
