import { randomUUID } from "node:crypto";
import { interviewMarkdown,interview } from "@repo/contracts";
import type { z } from "zod";
import type { DatabasePort } from "../../application/ports/database.port";
import type { InterviewMarkdownReader } from "../../application/interview/read-interview-markdown";
import { DigitalInterviewWorkflowError } from "../../application/interview/workflow/digital-interview-runtime.port";
import { appendInterviewMarkdownDocument,DIGITAL_INTERVIEW_ACTOR_VISIBILITY,interviewMarkdownContentHash } from "./interview-markdown-store";
import { guard } from "../../application/security/permission-filter";

type SourceRow={document_id:string;step:interviewMarkdown.InterviewMarkdownDocument["step"];title:string;version:number;markdown:string;content_hash:string;evidence_mode:interviewMarkdown.InterviewMarkdownDocument["evidenceMode"];references:interviewMarkdown.InterviewMarkdownDocument["references"];status:z.infer<typeof interview.DigitalInterviewArtifact>["status"];failure:z.infer<typeof interview.DigitalInterviewArtifact>["failure"]};
/** Branch only the source lane. Old research bodies and execution records remain immutable history. */
export function branchMarkdownRevision(db:DatabasePort,input:Parameters<InterviewMarkdownReader["branch"]>[0]) {
  return db.withTenant(input.orgId,async session=>{
    const header=(await session.query<{version:string;revision_id:string}>(`SELECT s.version,r.id AS revision_id FROM interview_sessions s JOIN digital_interview_revisions r ON r.org_id=s.org_id AND r.interview_id=s.id AND r.is_current WHERE s.org_id=$1 AND s.id=$2 AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY} FOR UPDATE OF s`,[input.orgId,input.interviewId,input.actorId])).rows[0];
    if(!header) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
    if(Number(header.version)!==input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
    await session.query(`SELECT id FROM digital_interview_revisions WHERE org_id=$1 AND id=$2 AND is_current FOR UPDATE`,[input.orgId,header.revision_id]);
    const sources=(await session.query<SourceRow>(`SELECT DISTINCT ON(step) artifact_id AS document_id,step,title,version_number AS version,markdown,content_hash,evidence_mode,controlled_references AS references,status,failure FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3 AND content_source IS NOT NULL ORDER BY step,version_number DESC`,[input.orgId,input.interviewId,header.revision_id])).rows;
    const target=sources.find(source=>source.step===input.fromStep);
    if(!target||!["confirmed","completed"].includes(target.status)) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
    const order=["intake","analysis","experts","outline"] as const;
    const retained=sources.filter(source=>order.indexOf(source.step as typeof order[number])>=0&&order.indexOf(source.step as typeof order[number])<=order.indexOf(input.fromStep));
    for(const source of retained) {
      if(interviewMarkdownContentHash(source.markdown)!==source.content_hash) throw new Error("MARKDOWN_CONTENT_INTEGRITY_FAILED");
      interviewMarkdown.InterviewMarkdownDocument.parse({documentId:source.document_id,step:source.step,version:source.version,markdown:source.markdown,contentHash:source.content_hash,evidenceMode:source.evidence_mode,references:source.references});
    }
    const nextNumber=(await session.query<{number:number}>(`SELECT (COALESCE(max(revision_number),0)+1)::int AS number FROM digital_interview_revisions WHERE org_id=$1 AND interview_id=$2`,[input.orgId,input.interviewId])).rows[0]!.number;
    const revisionId=`rev-${randomUUID()}`;
    await session.query(`UPDATE digital_interview_revisions SET is_current=false,superseded_at=now() WHERE org_id=$1 AND id=$2 AND is_current`,[input.orgId,header.revision_id]);
    await session.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,$2,$3,$4,$5)`,[input.orgId,revisionId,input.interviewId,nextNumber,input.actorId]);
    for(const source of retained) await appendInterviewMarkdownDocument(session,{orgId:input.orgId,interviewId:input.interviewId,revisionId,step:source.step,title:source.title,markdown:source.markdown,evidenceMode:source.evidence_mode,references:source.references,expectedVersion:0,status:source.step===input.fromStep?"draft":source.status,failure:source.step===input.fromStep?null:source.failure});
    await session.query(`UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2`,[input.orgId,input.interviewId]);
    // No research body leaves the infrastructure boundary on this mutation path.
    return guard({kind:"interview",id:input.interviewId},undefined);
  }).then(()=>undefined);
}
