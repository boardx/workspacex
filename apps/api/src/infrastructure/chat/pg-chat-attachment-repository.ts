/**
 * #946 · V9-a F150 —— `AttachmentCommandRepository` 的 PostgreSQL 实现。
 * 走 `DatabasePort.withTenant`（RLS 租户会话），与 pg-chat-message-command-repository 同一套。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type {
  AttachmentCommandRepository,
  AttachmentRow,
} from "../../application/chat/upload-attachment";

export class PgChatAttachmentRepository implements AttachmentCommandRepository {
  constructor(private readonly db: DatabasePort) {}

  /**
   * 该线程 pending（`message_id IS NULL`）附件数——数量上限校验用。
   * 经 `guard()` 出门（R7 / lint-permission-paths）：租户表的读一律带判定交出，调用方
   * disclose 后才拿得到数值。ref 的 id 只是 Guarded 的描述性元数据（discloseDecided 不查它），
   * 个人线程没有 projectId 时用 `personal:<threadId>`，同 pg-chat-message-command-repository 的先例。
   */
  async countPendingByThread(orgId: OrgId, threadId: string): Promise<Guarded<number>> {
    const n = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM chat_message_attachments
          WHERE org_id = $1 AND thread_id = $2 AND message_id IS NULL`,
        [orgId, threadId],
      );
      return r.rows[0]?.n ?? 0;
    });
    return guard({ kind: "project", id: `personal:${threadId}` }, n);
  }

  /** 落一行 pending 附件（`message_id` 恒 NULL，挂消息在另一条路径 set；extracted_ref 恒 NULL=V9-a）。 */
  async insertAttachment(row: AttachmentRow): Promise<void> {
    await this.db.withTenant(row.orgId, async (s) => {
      await s.query(
        `INSERT INTO chat_message_attachments
           (id, org_id, thread_id, message_id, storage_ref, filename, mime, bytes, extracted_ref, created_at)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, NULL, $8::timestamptz)`,
        [row.id, row.orgId, row.threadId, row.storageRef, row.filename, row.mime, row.bytes, row.createdAt],
      );
    });
  }
}
