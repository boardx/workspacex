import { randomUUID } from "node:crypto";
import { InterviewMarkdownReportReview, type SubmitInterviewMarkdownReportReview } from "@repo/contracts/interview-markdown-report-review";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { guard, type Guarded } from "../../application/security/permission-filter";
import type { InterviewMarkdownReportReviewRepository } from "../../application/interview/interview-markdown-report-review.port";
import { DigitalInterviewWorkflowError } from "../../application/interview/workflow/digital-interview-runtime.port";
import { deriveApprovalEligibility } from "../../domain/interview/digital-report-evidence";
import { DIGITAL_INTERVIEW_ACTOR_VISIBILITY, interviewMarkdownContentHash } from "./interview-markdown-store";
import type { interview } from "@repo/contracts";
import type { z } from "zod";

type ReviewRow = { id: string; revision_id: string; document_id: string; document_version: number; content_hash: string;
  status: "approved" | "changes_requested"; note: string | null; reviewed_by: string; reviewed_at: Date | string;
  expected_version: string; aggregate_version: string };
function metadata(row: ReviewRow): InterviewMarkdownReportReview {
  return InterviewMarkdownReportReview.parse({ reviewId: row.id, revisionId: row.revision_id, documentId: row.document_id,
    documentVersion: Number(row.document_version), contentHash: row.content_hash, status: row.status, note: row.note,
    reviewedBy: row.reviewed_by, reviewedAt: new Date(row.reviewed_at).toISOString() });
}
/** Only disclose this guarded read after the caller's interview permission decision. */
export async function readInterviewMarkdownReportReview(s: TenantSession, orgId: OrgId, interviewId: string, revisionId: string): Promise<Guarded<InterviewMarkdownReportReview | null>> {
  const result = await s.query<ReviewRow>(`SELECT rv.* FROM interview_markdown_report_reviews rv
    JOIN (SELECT artifact_id,version_number,content_hash FROM digital_interview_artifact_versions
      WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3 AND step='report' AND content_source IS NOT NULL
      ORDER BY version_number DESC LIMIT 1) d
      ON rv.document_id=d.artifact_id AND rv.document_version=d.version_number AND rv.content_hash=d.content_hash
    WHERE rv.org_id=$1 AND rv.interview_id=$2 AND rv.revision_id=$3 ORDER BY rv.aggregate_version DESC LIMIT 1`, [orgId, interviewId, revisionId]);
  return guard({ kind: "interview", id: interviewId }, result.rows[0] ? metadata(result.rows[0]) : null);
}
export class PgInterviewMarkdownReportReviewRepository implements InterviewMarkdownReportReviewRepository {
  constructor(private readonly db: DatabasePort) {}
  async submit(input: SubmitInterviewMarkdownReportReview & { orgId: OrgId; interviewId: string; actorId: string }) {
    return this.db.withTenant(input.orgId, async s => {
      const fail = (code: ConstructorParameters<typeof DigitalInterviewWorkflowError>[0]): never => { throw new DigitalInterviewWorkflowError(code); };
      // Same lock order as source saves: aggregate first, then current revision.
      const header = await s.query<{ version: string }>(`SELECT s.version FROM interview_sessions s
        WHERE s.org_id=$1 AND s.id=$2 AND s.archived=false AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY} FOR UPDATE OF s`, [input.orgId, input.interviewId, input.actorId]);
      if (!header.rows[0]) throw new DigitalInterviewWorkflowError("NO_INTERVIEW_ACCESS");
      const revision = await s.query<{ id: string }>(`SELECT id FROM digital_interview_revisions WHERE org_id=$1 AND interview_id=$2 AND is_current FOR UPDATE`, [input.orgId, input.interviewId]);
      if (revision.rows[0]?.id !== input.revisionId) fail("CONCURRENT_MODIFICATION");
      const doc = await s.query<{ artifact_id: string; version_number: number; content_hash: string; markdown: string; evidence_mode: z.infer<typeof interview.StudyEvidenceMode>; status: string }>(
        `SELECT artifact_id,version_number,content_hash,markdown,evidence_mode,status FROM digital_interview_artifact_versions
        WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3 AND step='report' AND content_source IS NOT NULL ORDER BY version_number DESC LIMIT 1`, [input.orgId, input.interviewId, input.revisionId]);
      const current = doc.rows[0];
      if (!current || current.artifact_id !== input.documentId || Number(current.version_number) !== input.documentVersion
        || current.content_hash !== input.contentHash || interviewMarkdownContentHash(current.markdown) !== input.contentHash) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const prior = await s.query<ReviewRow>(`SELECT * FROM interview_markdown_report_reviews WHERE org_id=$1 AND interview_id=$2 AND request_id=$3`, [input.orgId, input.interviewId, input.requestId]);
      if (prior.rows[0]) {
        const row = prior.rows[0];
        if (row.reviewed_by !== input.actorId || row.revision_id !== input.revisionId || row.document_id !== input.documentId
          || Number(row.document_version) !== input.documentVersion || row.content_hash !== input.contentHash || row.status !== input.status
          || row.note !== input.note || Number(row.expected_version) !== input.expectedVersion) fail("IDEMPOTENCY_KEY_REUSED");
        return guard({ kind: "interview", id: input.interviewId }, { review: metadata(row), version: Number(row.aggregate_version) });
      }
      if (Number(header.rows[0].version) !== input.expectedVersion) fail("CONCURRENT_MODIFICATION");
      if (input.status === "approved") {
        // Source currently has no trusted finding-level quality review projection.
        // Unknown qualification is fail-closed, never inferred from Markdown prose.
        const eligibility = deriveApprovalEligibility({ mode: current.evidence_mode, findings: [], hasUnreviewedQualityFlag: true });
        if (current.status !== "confirmed" || eligibility.eligibility !== "eligible") fail("REPORT_REVIEW_BLOCKED");
      }
      const nextVersion = input.expectedVersion + 1;
      const inserted = await s.query<ReviewRow>(`INSERT INTO interview_markdown_report_reviews
        (org_id,id,interview_id,revision_id,document_id,document_version,content_hash,status,note,request_id,expected_version,aggregate_version,reviewed_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [input.orgId, `md-review-${randomUUID()}`, input.interviewId,
          input.revisionId, input.documentId, input.documentVersion, input.contentHash, input.status, input.note, input.requestId, input.expectedVersion, nextVersion, input.actorId]);
      await s.query(`UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2 AND version=$3`, [input.orgId, input.interviewId, input.expectedVersion]);
      return guard({ kind: "interview", id: input.interviewId }, { review: metadata(inserted.rows[0]!), version: nextVersion });
    });
  }
}
