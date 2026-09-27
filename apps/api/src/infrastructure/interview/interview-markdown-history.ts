import { interviewMarkdown } from "@repo/contracts";
import type { TenantSession } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { StoredDigitalInterviewListItem } from "../../application/interview/digital-interview-ports";
import { interviewMarkdownContentHash } from "./interview-markdown-store";
import { guard } from "../../application/security/permission-filter";

/** Internal projection of an already SQL-visible row; callers guard the combined item. */
export async function projectMarkdownHistory(session:TenantSession,orgId:OrgId,item:StoredDigitalInterviewListItem) {
  const rows=await session.query<{document_id:string;step:interviewMarkdown.InterviewMarkdownDocument["step"];version:number;markdown:string;content_hash:string;evidence_mode:interviewMarkdown.InterviewMarkdownDocument["evidenceMode"];references:interviewMarkdown.InterviewMarkdownDocument["references"];status:string;failure:unknown;content_source:string}>(`SELECT DISTINCT ON(a.step) a.artifact_id AS document_id,a.step,a.version_number AS version,a.markdown,a.content_hash,a.evidence_mode,a.controlled_references AS references,a.status,a.failure,a.content_source FROM digital_interview_artifact_versions a JOIN digital_interview_revisions r ON r.org_id=a.org_id AND r.id=a.revision_id AND r.interview_id=a.interview_id AND r.is_current WHERE a.org_id=$1 AND a.interview_id=$2 AND a.content_source IS NOT NULL ORDER BY a.step,a.version_number DESC`,[orgId,item.interviewId]);
  // Retained migrated legacy documents keep their established history projection.
  if(!rows.rows.some(row=>row.content_source==="markdown-v1")) return {item:guard({kind:"interview",id:item.interviewId},item),status:item.status};
  const execution=(await session.query<{status:string;tasks:unknown}>(`SELECT e.status,e.tasks FROM interview_markdown_execution e JOIN digital_interview_revisions r ON r.org_id=e.org_id AND r.id=e.revision_id AND r.is_current WHERE e.org_id=$1 AND e.interview_id=$2`,[orgId,item.interviewId])).rows[0]??null;
  const documents=rows.rows.map(row=>{
    if(interviewMarkdownContentHash(row.markdown)!==row.content_hash) throw new Error("MARKDOWN_CONTENT_INTEGRITY_FAILED");
    return {documentId:row.document_id,step:row.step,version:row.version,markdown:row.markdown,contentHash:row.content_hash,evidenceMode:row.evidence_mode,references:row.references};
  });
  const source=interviewMarkdown.InterviewMarkdownEnvelope.parse({interviewId:item.interviewId,revisionId:null,version:item.version,documents,states:rows.rows.map(row=>({documentId:row.document_id,status:row.status,failure:row.failure})),execution});
  const progress=interviewMarkdown.projectInterviewMarkdownProgress(source);
  const expertDocument=source.documents.find(doc=>doc.step==="experts");
  const legacyExperts=rows.rows.find(row=>row.step==="experts")?.content_source==="legacy-migration-v1";
  const expertIds=source.execution?.tasks.map(task=>task.expertId)??(legacyExperts?item.selectedExpertIds:expertDocument?interviewMarkdown.projectInterviewMarkdownExperts(expertDocument).map(expert=>expert.expertId):[]);
  return {item:guard({kind:"interview",id:item.interviewId},{...item,status:progress.status,sourceStep:progress.step,selectedExpertIds:expertIds,completedExpertCount:source.execution?.tasks.filter(task=>task.status==="completed").length??(legacyExperts?item.completedExpertCount:0)}),status:progress.status};
}
