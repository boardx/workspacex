/**
 * FB-5 —— `feedback_attachments` 的 PostgreSQL 适配器。见迁移
 * `20260902120000_fb5_feedback_attachments.sql` 头注：两段生命周期，上传时未认领
 * （`feedback_id IS NULL`），`submitFeedback` 成功后按 id 认领。
 *
 * ⚠ 每个方法恰好一次 `withTenant`，同 `pg-product-feedback-repository.ts` 的既有纪律。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { guard } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import type {
  FeedbackAttachmentContentType,
  FeedbackAttachmentRepository,
  FeedbackAttachmentRow,
  NewFeedbackAttachment,
} from "../../application/feedback/attachment-ports";

interface AttachmentDbRow {
  readonly id: string;
  readonly org_id: string;
  readonly uploaded_by: string;
  readonly feedback_id: string | null;
  readonly object_key: string;
  readonly content_type: string;
  readonly size_bytes: string | number;
  readonly sha256: string;
  readonly created_at: string;
}

function toRow(r: AttachmentDbRow): FeedbackAttachmentRow {
  return {
    id: r.id,
    orgId: r.org_id,
    uploadedBy: r.uploaded_by,
    feedbackId: r.feedback_id,
    // 见 `attachment-ports.ts` 头注：只有已认领（挂着 `feedback_id`）的行才有可供
    // `guard()` 挂靠的反馈对象——未认领的行调用方本来就不会读到这一步。
    objectKey: r.feedback_id !== null ? guard({ kind: "feedback", id: r.feedback_id }, r.object_key) : null,
    contentType: r.content_type as FeedbackAttachmentContentType,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256,
    createdAt: r.created_at,
  };
}

export class PgFeedbackAttachmentRepository implements FeedbackAttachmentRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(row: NewFeedbackAttachment): Promise<void> {
    await this.db.withTenant(row.orgId, async (s: TenantSession) => {
      await s.query(
        `INSERT INTO feedback_attachments
           (id, org_id, uploaded_by, object_key, content_type, size_bytes, sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.orgId, row.uploadedBy, row.objectKey, row.contentType, row.sizeBytes, row.sha256],
      );
    });
  }

  async claimForFeedback(
    orgId: OrgId,
    feedbackId: string,
    attachmentIds: readonly string[],
    uploadedBy: string,
  ): Promise<number> {
    if (attachmentIds.length === 0) return 0;
    return this.db.withTenant(orgId, async (s: TenantSession) => {
      const { rows } = await s.query<{ id: string }>(
        `UPDATE feedback_attachments
            SET feedback_id = $1
          WHERE org_id = $2 AND uploaded_by = $3 AND feedback_id IS NULL AND id = ANY($4::text[])
          RETURNING id`,
        [feedbackId, orgId, uploadedBy, attachmentIds],
      );
      return rows.length;
    });
  }

  async findByFeedbackIds(
    orgId: OrgId,
    feedbackIds: readonly string[],
  ): Promise<readonly FeedbackAttachmentRow[]> {
    if (feedbackIds.length === 0) return [];
    return this.db.withTenant(orgId, async (s: TenantSession) => {
      const { rows } = await s.query<AttachmentDbRow>(
        `SELECT id, org_id, uploaded_by, feedback_id, object_key, content_type, size_bytes, sha256, created_at
           FROM feedback_attachments
          WHERE org_id = $1 AND feedback_id = ANY($2::text[])
          ORDER BY created_at ASC`,
        [orgId, feedbackIds],
      );
      return rows.map(toRow);
    });
  }

  async findById(orgId: OrgId, attachmentId: string): Promise<FeedbackAttachmentRow | null> {
    return this.db.withTenant(orgId, async (s: TenantSession) => {
      const { rows } = await s.query<AttachmentDbRow>(
        `SELECT id, org_id, uploaded_by, feedback_id, object_key, content_type, size_bytes, sha256, created_at
           FROM feedback_attachments
          WHERE org_id = $1 AND id = $2`,
        [orgId, attachmentId],
      );
      return rows[0] ? toRow(rows[0]) : null;
    });
  }
}
