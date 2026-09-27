import type { DatabasePort } from "../../application/ports/database.port";
import type { InterviewMarkdownReader } from "../../application/interview/read-interview-markdown";
import { guard } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";
import { appendInterviewMarkdownDocument, readInterviewMarkdownDocuments, DIGITAL_INTERVIEW_ACTOR_VISIBILITY } from "./interview-markdown-store";
import { DigitalInterviewWorkflowError } from "../../application/interview/workflow/digital-interview-runtime.port";
import { interviewMarkdown } from "@repo/contracts";
import type { z } from "zod";
import { migrateInterviewMarkdown } from "./interview-markdown-migration";
import { randomUUID } from "node:crypto";

export class PgInterviewMarkdownReader implements InterviewMarkdownReader {
  constructor(private readonly db: DatabasePort) {}

  initialize(input: Parameters<InterviewMarkdownReader["initialize"]>[0]) {
    return this.db.withTenant(input.orgId, async (session) => {
      const current = await session.query<{ version: string }>(`SELECT s.version FROM interview_sessions s WHERE s.org_id=$1 AND s.id=$2 AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY} FOR UPDATE OF s`, [input.orgId, input.interviewId, input.actorId]);
      if (!current.rows[0]) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
      if (Number(current.rows[0].version) !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const revision = await session.query(`SELECT id FROM digital_interview_revisions WHERE org_id=$1 AND interview_id=$2 AND is_current`, [input.orgId, input.interviewId]);
      if (!revision.rows.length) await session.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,$2,$3,1,$4)`, [input.orgId, `rev-${randomUUID()}`, input.interviewId, input.actorId]);
      const count = () => session.query<{ count: string }>(`SELECT count(*)::text AS count FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND content_source IS NOT NULL`, [input.orgId, input.interviewId]);
      const before = (await count()).rows[0]!.count;
      await migrateInterviewMarkdown(session, input.orgId, input.interviewId);
      if (!revision.rows.length || (await count()).rows[0]!.count !== before) await session.query(`UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2`, [input.orgId, input.interviewId]);
    });
  }

  saveDraft(input: Parameters<InterviewMarkdownReader["saveDraft"]>[0]) {
    return this.db.withTenant(input.orgId, async (session) => {
      // Visibility is checked again under the write lock, not just before the transaction.
      const current = await session.query<{ version: string; revision_id: string }>(
        `SELECT s.version,r.id AS revision_id FROM interview_sessions s
         JOIN digital_interview_revisions r ON r.org_id=s.org_id AND r.interview_id=s.id AND r.is_current
         WHERE s.org_id=$1 AND s.id=$2
           AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY}
         FOR UPDATE OF s`, [input.orgId, input.interviewId, input.actorId],
      );
      const row = current.rows[0];
      if (!row) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
      if (Number(row.version) !== input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const previous = await session.query<{
        status: string; evidence_mode: "simulated" | "participant" | "mixed";
        controlled_references: Parameters<typeof appendInterviewMarkdownDocument>[1]["references"];
      }>(
        `SELECT status,evidence_mode,controlled_references FROM digital_interview_artifact_versions
         WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3 AND step=$4 ORDER BY version_number DESC LIMIT 1`,
        [input.orgId, input.interviewId, row.revision_id, input.step],
      );
      // Reconfirmation must use the workflow's revision-branch operation. A draft save
      // cannot silently invalidate confirmed downstream artifacts in the same revision.
      if (previous.rows[0] && !["draft", "failed"].includes(previous.rows[0].status)) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      if (input.confirm && previous.rows[0]?.status !== "draft") throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      try {
        await appendInterviewMarkdownDocument(session, {
          orgId: input.orgId, interviewId: input.interviewId, revisionId: row.revision_id,
          step: input.step, title: input.step, markdown: input.markdown,
          evidenceMode: previous.rows[0]?.evidence_mode ?? "simulated",
          references: previous.rows[0]?.controlled_references ?? [],
          expectedVersion: input.expectedDocumentVersion, status: input.confirm ? "confirmed" : input.failure ? "failed" : "draft",
          failure: input.failure ?? null,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "MARKDOWN_VERSION_CONFLICT") throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
        throw error;
      }
      await session.query("UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2", [input.orgId, input.interviewId]);
    });
  }

  readCurrent(orgId: OrgId, interviewId: string) {
    return this.db.withTenant(orgId, async (session) => {
      const header = await session.query<{ version: string; revision_id: string | null }>(
        `SELECT i.version, r.id AS revision_id FROM interview_sessions i
         LEFT JOIN digital_interview_revisions r
           ON r.org_id=i.org_id AND r.interview_id=i.id AND r.is_current
         WHERE i.org_id=$1 AND i.id=$2 FOR SHARE OF i`, [orgId, interviewId],
      );
      const row = header.rows[0];
      if (!row) return null;
      const documents = row.revision_id
        ? (await readInterviewMarkdownDocuments(session, orgId, interviewId, row.revision_id)).documents
        : guard({ kind: "interview", id: interviewId }, []);
      const states = row.revision_id ? await session.query<{
        documentId: string;
        status: z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>["states"][number]["status"];
        failure: z.infer<typeof interviewMarkdown.InterviewMarkdownEnvelope>["states"][number]["failure"];
      }>(
        `SELECT DISTINCT ON (step) artifact_id AS "documentId",status,failure FROM digital_interview_artifact_versions
         WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3 AND content_source IS NOT NULL
         ORDER BY step,version_number DESC`, [orgId, interviewId, row.revision_id],
      ) : { rows: [] };
      return { version: Number(row.version), revisionId: row.revision_id, documents, states: states.rows };
    });
  }
}
