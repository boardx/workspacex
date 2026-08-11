/**
 * #946 · F153/W1（V9-b）—— `AttachmentExtractionStore` 的 PostgreSQL 实现。
 * outbox 的 claim SQL 逐字镜像 files `pg-ingestion-repository` 的 `FOR UPDATE SKIP LOCKED` +
 * staleness 认领；结果写回 `chat_message_attachments`。全部走 `withTenant`（RLS 租户会话）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { ConvertErrorCode } from "../../application/chat/attachment-to-markdown.port";
import type {
  AttachmentExtractionJob, AttachmentExtractionStore, AttachmentForExtraction,
} from "../../application/chat/attachment-extraction-store";

export class PgAttachmentExtractionRepository implements AttachmentExtractionStore {
  constructor(private readonly db: DatabasePort) {}

  async enqueue(orgId: OrgId, attachmentId: string): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `INSERT INTO chat_attachment_extraction_outbox (org_id, attachment_id)
         VALUES ($1, $2)
         ON CONFLICT (attachment_id) DO NOTHING`,
        [orgId, attachmentId],
      ),
    );
  }

  async claimNext(orgId: OrgId, workerId: string, staleAfterMs: number): Promise<AttachmentExtractionJob | null> {
    return this.db.withTenant(orgId, async (s) => {
      const claimed = await s.query<{ id: string; attachment_id: string; attempts: number }>(
        `UPDATE chat_attachment_extraction_outbox
            SET status = 'processing', locked_by = $2, locked_at = now(), attempts = attempts + 1
          WHERE org_id = $1
            AND id = (
              SELECT id FROM chat_attachment_extraction_outbox
               WHERE org_id = $1
                 AND (status = 'pending'
                      OR (status IN ('processing', 'failed')
                          AND locked_at < now() - ($3 || ' milliseconds')::interval))
               ORDER BY created_at
               LIMIT 1
               FOR UPDATE SKIP LOCKED
            )
          RETURNING id::text, attachment_id, attempts`,
        [orgId, workerId, staleAfterMs],
      );
      const row = claimed.rows[0];
      if (row === undefined) return null;
      return { jobId: row.id, attachmentId: row.attachment_id, attempts: row.attempts };
    });
  }

  async complete(orgId: OrgId, jobId: string): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(`DELETE FROM chat_attachment_extraction_outbox WHERE org_id = $1 AND id = $2`, [orgId, jobId]),
    );
  }

  async markJobFailed(orgId: OrgId, jobId: string, error: string): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `UPDATE chat_attachment_extraction_outbox SET status = 'failed', last_error = $3
          WHERE org_id = $1 AND id = $2`,
        [orgId, jobId, error],
      ),
    );
  }

  async readAttachment(orgId: OrgId, attachmentId: string): Promise<AttachmentForExtraction | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{ storage_ref: string; mime: string }>(
        `SELECT storage_ref, mime FROM chat_message_attachments WHERE org_id = $1 AND id = $2`,
        [orgId, attachmentId],
      );
      const row = r.rows[0];
      return row === undefined ? null : { storageRef: row.storage_ref, mime: row.mime };
    });
  }

  async recordExtracted(orgId: OrgId, attachmentId: string, extractedRef: string): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `UPDATE chat_message_attachments
            SET extracted_ref = $3, extraction_status = 'extracted', extraction_error = NULL
          WHERE org_id = $1 AND id = $2`,
        [orgId, attachmentId, extractedRef],
      ),
    );
  }

  async recordUnsupported(orgId: OrgId, attachmentId: string): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `UPDATE chat_message_attachments
            SET extraction_status = 'unsupported', extraction_error = NULL
          WHERE org_id = $1 AND id = $2`,
        [orgId, attachmentId],
      ),
    );
  }

  async recordFailed(orgId: OrgId, attachmentId: string, code: ConvertErrorCode): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query(
        `UPDATE chat_message_attachments
            SET extraction_status = 'failed', extraction_error = $3
          WHERE org_id = $1 AND id = $2`,
        [orgId, attachmentId, code],
      ),
    );
  }
}
