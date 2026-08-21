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
  SentAttachmentRow,
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

  /**
   * #1584 —— 按 id 查一行（预览/下载用）。同 `countPendingByThread` 经 `guard()` 出门（R7）。
   * `thread_id = $2` 是查询本身的一部分，不是事后过滤——防止 org 内跨线程用别的线程的
   * attachmentId 探测「这个 id 在不在」。
   */
  async findById(orgId: OrgId, threadId: string, attachmentId: string): Promise<Guarded<AttachmentRow | null>> {
    const row = await this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; storage_ref: string; filename: string; mime: string;
        bytes: string; created_at: string;
      }>(
        `SELECT id, storage_ref, filename, mime, bytes, created_at::text AS created_at
           FROM chat_message_attachments
          WHERE org_id = $1 AND thread_id = $2 AND id = $3`,
        [orgId, threadId, attachmentId],
      );
      const hit = r.rows[0];
      if (hit === undefined) return null;
      // bytes 是 bigint（pg 回字符串）——转成 number（≤25MB 远在安全整数内）。
      return {
        id: hit.id, orgId, threadId, storageRef: hit.storage_ref, filename: hit.filename,
        mime: hit.mime, bytes: Number(hit.bytes), createdAt: hit.created_at,
      } satisfies AttachmentRow;
    });
    return guard({ kind: "project", id: `personal:${threadId}` }, row);
  }

  /**
   * `listThreadAttachments`（#728 D9，右侧栏「材料」）：该线程已挂到消息的附件全部行
   * （`message_id IS NOT NULL`），按 `created_at DESC`。**不经 `guard()`**——与
   * `PgArtifactLandingRepository.listByThread` 同一套分工：调用方
   * （`list-thread-attachments.ts`）在拿到这份行之前已经跑过 `resolveVisibility`，
   * 这里不重复披露判定，只做数据整形（同一个理由，这类"读端口先由上层判过权限
   * 才会被调用"的路径不在 `guard()` 覆盖范围内）。
   */
  async listSentByThread(orgId: OrgId, threadId: string): Promise<readonly SentAttachmentRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; storage_ref: string; filename: string; mime: string;
        bytes: string; created_at: string; message_id: string;
      }>(
        `SELECT id, storage_ref, filename, mime, bytes, created_at::text AS created_at, message_id
           FROM chat_message_attachments
          WHERE org_id = $1 AND thread_id = $2 AND message_id IS NOT NULL
          ORDER BY created_at DESC`,
        [orgId, threadId],
      );
      return r.rows.map((hit) => ({
        id: hit.id, orgId, threadId, storageRef: hit.storage_ref, filename: hit.filename,
        mime: hit.mime, bytes: Number(hit.bytes), createdAt: hit.created_at, messageId: hit.message_id,
      } satisfies SentAttachmentRow));
    });
  }
}
