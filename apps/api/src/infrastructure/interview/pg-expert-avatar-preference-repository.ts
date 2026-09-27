import { ExpertAvatarPreference } from "@repo/contracts/interview-expert-avatar";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { ExpertAvatarPreferenceRepository, ExpertAvatarScope, StoredExpertAvatarPreference } from "../../application/interview/expert-avatar-preference.port";
import { guard } from "../../application/security/permission-filter";
import { ExpertAvatarSourceAccessError, ExpertAvatarSourceRevisionConflictError } from "../../application/interview/expert-avatar-preference.port";
import { interviewMarkdown } from "@repo/contracts";
import { DIGITAL_INTERVIEW_ACTOR_VISIBILITY, interviewMarkdownContentHash } from "./interview-markdown-store";

export class PgExpertAvatarPreferenceRepository implements ExpertAvatarPreferenceRepository {
  constructor(private readonly db: DatabasePort) {}
  /** Recheck saved identity and revision under the same transaction as preference I/O. */
  private async sourceExpert(s: TenantSession, input: ExpertAvatarScope) {
    const header = await s.query<{ revision_id: string }>(
      `SELECT r.id AS revision_id FROM interview_sessions s
       JOIN digital_interview_revisions r ON r.org_id=s.org_id AND r.interview_id=s.id AND r.is_current
       WHERE s.org_id=$1 AND s.id=$2 AND s.archived=false AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY} FOR SHARE OF s,r`,
      [input.orgId, input.interviewId, input.actorId]);
    if (!header.rows[0]) throw new ExpertAvatarSourceAccessError();
    if (header.rows[0].revision_id !== input.revisionId) throw new ExpertAvatarSourceRevisionConflictError();
    const result = await s.query<{ document_id: string; version: number; markdown: string; content_hash: string; evidence_mode: string; references: unknown }>(
      `SELECT artifact_id AS document_id,version_number AS version,markdown,content_hash,evidence_mode,controlled_references AS references
       FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3
       AND step='experts' AND content_source IS NOT NULL ORDER BY version_number DESC LIMIT 1`,
      [input.orgId, input.interviewId, input.revisionId]);
    const row = result.rows[0];
    if (!row) throw new ExpertAvatarSourceAccessError();
    if (row.content_hash !== interviewMarkdownContentHash(row.markdown)) throw new Error("MARKDOWN_CONTENT_INTEGRITY_FAILED");
    const document = interviewMarkdown.InterviewMarkdownDocument.parse({ documentId: row.document_id, step: "experts", version: Number(row.version), markdown: row.markdown,
      contentHash: row.content_hash, evidenceMode: row.evidence_mode, references: row.references });
    const matches = interviewMarkdown.parseInterviewMarkdown(document).blocks.flatMap(block => block.links)
      .filter(link => link.url === `#expert-${input.expertId}` && /^#expert-[a-zA-Z0-9_-]+$/u.test(link.url));
    if (matches.length !== 1) throw new ExpertAvatarSourceAccessError();
  }
  async read(input: ExpertAvatarScope): Promise<StoredExpertAvatarPreference> {
    return this.db.withTenant(input.orgId, async (s) => {
      if (input.interviewId) await this.sourceExpert(s, input);
      const result = await s.query<{ org_id: string; actor_id: string; avatar_key: string | null; version: number }>(
        input.interviewId
          ? "SELECT org_id,actor_id,avatar_key,version FROM interview_expert_avatar_preferences WHERE org_id=$1 AND actor_id=$2 AND expert_id=$3 AND interview_id=$4"
          : "SELECT org_id,actor_id,avatar_key,version FROM digital_expert_avatar_preferences WHERE org_id=$1 AND actor_id=$2 AND expert_id=$3",
        input.interviewId ? [input.orgId, input.actorId, input.expertId, input.interviewId] : [input.orgId, input.actorId, input.expertId],
      );
      const row = result.rows[0];
      return { orgId: row?.org_id ?? input.orgId, actorId: row?.actor_id ?? input.actorId,
        item: guard(input.interviewId ? { kind: "interview", id: input.interviewId } : { kind: "capability", id: input.expertId }, ExpertAvatarPreference.parse({ expertId: input.expertId, avatarKey: row?.avatar_key ?? null, version: Number(row?.version ?? 0) })) };
    });
  }
  async save(input: ExpertAvatarScope & { avatarKey: ExpertAvatarPreference["avatarKey"]; expectedVersion: number }): Promise<StoredExpertAvatarPreference | null> {
    return this.db.withTenant(input.orgId, async (s) => {
      if (input.interviewId) await this.sourceExpert(s, input);
      // Initial writes use INSERT/ON CONFLICT; later writes use a fenced UPDATE.
      // Retain a row on reset so an old browser cannot recreate version zero.
      const result = await s.query<{ org_id: string; actor_id: string; avatar_key: string | null; version: number }>(
        input.interviewId ? (input.expectedVersion === 0
          ? `INSERT INTO interview_expert_avatar_preferences (org_id,actor_id,expert_id,avatar_key,version,interview_id)
             VALUES ($1,$2,$3,$4,1,$5) ON CONFLICT DO NOTHING RETURNING org_id,actor_id,avatar_key,version`
          : `UPDATE interview_expert_avatar_preferences SET avatar_key=$4,version=version+1,updated_at=now()
             WHERE org_id=$1 AND actor_id=$2 AND expert_id=$3 AND interview_id=$5 AND version=$6 RETURNING org_id,actor_id,avatar_key,version`)
        : input.expectedVersion === 0
          ? `INSERT INTO digital_expert_avatar_preferences (org_id,actor_id,expert_id,avatar_key,version)
             VALUES ($1,$2,$3,$4,1) ON CONFLICT DO NOTHING RETURNING org_id,actor_id,avatar_key,version`
          : `UPDATE digital_expert_avatar_preferences SET avatar_key=$4,version=version+1,updated_at=now()
             WHERE org_id=$1 AND actor_id=$2 AND expert_id=$3 AND version=$5 RETURNING org_id,actor_id,avatar_key,version`,
        input.interviewId ? (input.expectedVersion === 0
          ? [input.orgId, input.actorId, input.expertId, input.avatarKey, input.interviewId]
          : [input.orgId, input.actorId, input.expertId, input.avatarKey, input.interviewId, input.expectedVersion])
        : input.expectedVersion === 0
          ? [input.orgId, input.actorId, input.expertId, input.avatarKey]
          : [input.orgId, input.actorId, input.expertId, input.avatarKey, input.expectedVersion],
      );
      const row = result.rows[0];
      return row ? { orgId: row.org_id, actorId: row.actor_id,
        item: guard(input.interviewId ? { kind: "interview", id: input.interviewId } : { kind: "capability", id: input.expertId }, ExpertAvatarPreference.parse({ expertId: input.expertId, avatarKey: row.avatar_key, version: Number(row.version) })) } : null;
    });
  }
}
