import type { DatabasePort } from "../../application/ports/database.port";
import type { InterviewMarkdownAttachmentRepository } from "../../application/interview/interview-markdown-attachment.port";
import { guard } from "../../application/security/permission-filter";
import { DigitalInterviewWorkflowError } from "../../application/interview/workflow/digital-interview-runtime.port";
import { appendInterviewMarkdownDocument,DIGITAL_INTERVIEW_ACTOR_VISIBILITY } from "./interview-markdown-store";
import type { interviewMarkdown } from "@repo/contracts";
export class PgInterviewMarkdownAttachmentRepository implements InterviewMarkdownAttachmentRepository {
  constructor(private readonly db:DatabasePort) {}
  commit(input:Parameters<InterviewMarkdownAttachmentRepository["commit"]>[0]) {
    return this.db.withTenant(input.orgId,async s=>{
      const header=(await s.query<{version:string;revision_id:string}>(`SELECT s.version,r.id AS revision_id FROM interview_sessions s JOIN digital_interview_revisions r ON r.org_id=s.org_id AND r.interview_id=s.id AND r.is_current WHERE s.org_id=$1 AND s.id=$2 AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY} FOR UPDATE OF s`,[input.orgId,input.interviewId,input.actorId])).rows[0];
      if(!header) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
      if(Number(header.version)!==input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const previous=(await s.query<{markdown:string;version:number;status:string;evidence_mode:interviewMarkdown.InterviewMarkdownDocument["evidenceMode"];references:interviewMarkdown.InterviewMarkdownDocument["references"]}>(`SELECT markdown,version_number AS version,status,evidence_mode,controlled_references AS references FROM digital_interview_artifact_versions WHERE org_id=$1 AND revision_id=$2 AND step='intake' AND content_source IS NOT NULL ORDER BY version_number DESC LIMIT 1`,[input.orgId,header.revision_id])).rows[0];
      if((previous?.version??0)!==input.expectedDocumentVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      if(previous&&!["draft","failed"].includes(previous.status)) throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID");
      const o=input.original;
      await s.query(`INSERT INTO interview_markdown_attachments(org_id,asset_id,interview_id,revision_id,storage_ref,filename,mime,bytes,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[input.orgId,o.assetId,input.interviewId,header.revision_id,input.storageRef,o.filename,o.mime,o.bytes,o.sha256,input.actorId]);
      const filename=o.filename.replace(/[\\[\]()*_`#<>]/gu,"\\$&").replace(/[\r\n]+/gu," ");
      await appendInterviewMarkdownDocument(s,{orgId:input.orgId,interviewId:input.interviewId,revisionId:header.revision_id,step:"intake",title:"需求",markdown:`${previous?.markdown?previous.markdown+"\n\n":""}## 附件：${filename}\n\n${input.markdown}`,evidenceMode:previous?.evidence_mode??"simulated",references:[...(previous?.references??[]),{anchor:`attachment-${o.assetId}`,documentId:o.assetId,version:1}],expectedVersion:input.expectedDocumentVersion,status:"draft"});
      await s.query(`UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2`,[input.orgId,input.interviewId]);
      return guard({kind:"interview",id:input.interviewId},o);
    });
  }
}
