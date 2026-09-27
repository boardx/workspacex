import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import { interview, interviewMarkdown } from "@repo/contracts";
import type { TenantSession } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { guard, type Guarded } from "../../application/security/permission-filter";

type Document = interviewMarkdown.InterviewMarkdownDocument;

/** Shared write visibility predicate. Parameters: $1 org, $2 interview, $3 actor;
 * session alias s. Consumers still lock the row and disclose reads through Guarded.
 */
export const DIGITAL_INTERVIEW_ACTOR_VISIBILITY = `
  EXISTS (
    SELECT 1 FROM org_memberships om
     WHERE om.org_id=$1 AND om.user_id=$3
  )
  AND (
    s.created_by=$3
    OR EXISTS (
      SELECT 1 FROM interview_collaborators ic
       WHERE ic.org_id=$1 AND ic.interview_id=s.id AND ic.user_id=$3
    )
    OR (
      s.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM project_memberships pm
         WHERE pm.org_id=$1 AND pm.project_id=s.project_id AND pm.user_id=$3
      )
    )
  )`;
type Artifact = z.infer<typeof interview.DigitalInterviewArtifact>;
type SourceRow = {
  artifact_id: string; step: Document["step"]; version_number: number;
  markdown: string; content_hash: string | null;
  evidence_mode: Document["evidenceMode"];
  controlled_references: Document["references"];
};
function hash(markdown: string): string {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

/** Called only within the authorized actor's existing tenant transaction. */
export async function readInterviewMarkdownDocuments(
  session: TenantSession, orgId: OrgId, interviewId: string, revisionId: string,
): Promise<{ documents: Guarded<Document[]>; versions: Array<Pick<Document, "step" | "version">> }> {
  const result = await session.query<SourceRow>(
    `SELECT DISTINCT ON (step) artifact_id,step,version_number,markdown,content_hash,evidence_mode,controlled_references
       FROM digital_interview_artifact_versions
      WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3 AND content_source IS NOT NULL
      ORDER BY step,version_number DESC`, [orgId, interviewId, revisionId],
  );
  const documents = result.rows.map((row) => {
    if (row.content_hash !== hash(row.markdown)) throw new Error("MARKDOWN_CONTENT_INTEGRITY_FAILED");
    return interviewMarkdown.InterviewMarkdownDocument.parse({
      documentId: row.artifact_id, step: row.step, version: row.version_number,
      markdown: row.markdown, contentHash: row.content_hash,
      evidenceMode: row.evidence_mode, references: row.controlled_references,
    });
  });
  return {
    documents: guard({ kind: "interview", id: interviewId }, documents),
    versions: documents.map(({ step, version }) => ({ step, version })),
  };
}

export async function appendInterviewMarkdownDocument(session: TenantSession, input: {
  orgId: OrgId; interviewId: string; revisionId: string; step: Document["step"];
  title: string; markdown: string; evidenceMode: Document["evidenceMode"];
  references: Document["references"]; expectedVersion: number;
  source?: "legacy-migration-v1" | "markdown-v1";
  status?: Artifact["status"];
  failure?: Artifact["failure"];
}): Promise<Document> {
  // All steps share one revision lock, including legacy migration and concurrent edits.
  const locked = await session.query(
    `SELECT id FROM digital_interview_revisions WHERE org_id=$1 AND interview_id=$2 AND id=$3 AND is_current FOR UPDATE`,
    [input.orgId, input.interviewId, input.revisionId],
  );
  if (!locked.rows.length) throw new Error("MARKDOWN_REVISION_NOT_CURRENT");
  const current = await session.query<{ version: number }>(
    `SELECT COALESCE(max(version_number),0)::integer AS version FROM digital_interview_artifact_versions
      WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3 AND step=$4`,
    [input.orgId, input.interviewId, input.revisionId, input.step],
  );
  if (current.rows[0]?.version !== input.expectedVersion) throw new Error("MARKDOWN_VERSION_CONFLICT");
  const document = interviewMarkdown.InterviewMarkdownDocument.parse({
    documentId: `md-${randomUUID()}`, step: input.step, version: input.expectedVersion + 1,
    markdown: input.markdown, contentHash: hash(input.markdown),
    evidenceMode: input.evidenceMode, references: input.references,
  });
  if (!input.title.trim() || !input.markdown.trim()) throw new Error("MARKDOWN_DOCUMENT_EMPTY");
  const artifact = interview.DigitalInterviewArtifact.parse({
    artifactId: document.documentId, step: document.step, title: input.title,
    markdown: document.markdown, version: document.version,
    status: input.status ?? "confirmed", failure: input.failure ?? null,
    evidenceMode: document.evidenceMode, generatedAt: null,
  });
  await session.query(
    `INSERT INTO digital_interview_artifact_versions
      (org_id,artifact_id,interview_id,revision_id,step,version_number,title,markdown,status,evidence_mode,
       content_hash,controlled_references,content_source,failure)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$13,$9,$10,$11::jsonb,$12,$14::jsonb)`,
    [input.orgId, document.documentId, input.interviewId, input.revisionId, document.step,
      document.version, input.title, document.markdown, document.evidenceMode,
      document.contentHash, JSON.stringify(document.references), input.source ?? "markdown-v1",
      artifact.status, JSON.stringify(artifact.failure)],
  );
  return document;
}
