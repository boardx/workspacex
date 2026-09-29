import { randomUUID } from "node:crypto";
import { interviewMarkdown } from "@repo/contracts";
import type { z } from "zod";
import type { DatabasePort,TenantSession } from "../../application/ports/database.port";
import type { InterviewMarkdownExecutionStore,MarkdownExecutionActor,MarkdownExecutionInput } from "../../application/interview/interview-markdown-execution.port";
import { DigitalInterviewWorkflowError } from "../../application/interview/workflow/digital-interview-runtime.port";
import { appendInterviewMarkdownDocument,DIGITAL_INTERVIEW_ACTOR_VISIBILITY,interviewMarkdownContentHash } from "./interview-markdown-store";
import { guard } from "../../application/security/permission-filter";
type Execution = z.infer<typeof interviewMarkdown.InterviewMarkdownExecution>;
type Row = Execution & { sources:{documentId:string;version:number}[]; claim_id:string|null; claim_expires_at:Date|null };
const EXECUTION_BATCH_SIZE = 5;
function invalid():never { throw new DigitalInterviewWorkflowError("DIGITAL_INTERVIEW_STEP_INVALID"); }
export class PgInterviewMarkdownExecutionStore implements InterviewMarkdownExecutionStore {
  constructor(private readonly db:DatabasePort) {}
  private async lock(session:TenantSession,input:MarkdownExecutionActor) {
    const rows = await session.query<{version:string;revision_id:string}>(`SELECT s.version,r.id AS revision_id FROM interview_sessions s JOIN digital_interview_revisions r ON r.org_id=s.org_id AND r.interview_id=s.id AND r.is_current WHERE s.org_id=$1 AND s.id=$2 AND ${DIGITAL_INTERVIEW_ACTOR_VISIBILITY} FOR UPDATE OF s`,[input.orgId,input.interviewId,input.actorId]);
    if (!rows.rows[0]) throw new DigitalInterviewWorkflowError("PERMISSION_REVOKED_MIDWAY");
    return rows.rows[0];
  }
  private async row(session:TenantSession,input:MarkdownExecutionActor,revision:string) {
    return (await session.query<Row>(`SELECT status,sources,tasks,claim_id,claim_expires_at FROM interview_markdown_execution WHERE org_id=$1 AND revision_id=$2`,[input.orgId,revision])).rows[0];
  }
  private async sources(session:TenantSession,input:MarkdownExecutionActor,revision:string) {
    const result=await session.query<{document_id:string;step:interviewMarkdown.InterviewMarkdownDocument["step"];version:number;markdown:string;content_hash:string;evidence_mode:interviewMarkdown.InterviewMarkdownDocument["evidenceMode"];references:interviewMarkdown.InterviewMarkdownDocument["references"];status:string}>(`SELECT DISTINCT ON(step) artifact_id AS document_id,step,version_number AS version,markdown,content_hash,evidence_mode,controlled_references AS references,status FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3 AND content_source IS NOT NULL ORDER BY step,version_number DESC`,[input.orgId,input.interviewId,revision]);
    return result.rows.filter(r=>["intake","analysis","experts","outline"].includes(r.step)&&["confirmed","completed"].includes(r.status)).map(r=>{
      if(interviewMarkdownContentHash(r.markdown)!==r.content_hash) throw new Error("MARKDOWN_CONTENT_INTEGRITY_FAILED");
      return interviewMarkdown.InterviewMarkdownDocument.parse({documentId:r.document_id,step:r.step,version:r.version,markdown:r.markdown,contentHash:r.content_hash,evidenceMode:r.evidence_mode,references:r.references});
    });
  }
  private async bump(session:TenantSession,input:MarkdownExecutionActor) {
    await session.query(`UPDATE interview_sessions SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2`,[input.orgId,input.interviewId]);
  }
  control(input:MarkdownExecutionInput) {
    return this.db.withTenant(input.orgId,async session=>{
      const header=await this.lock(session,input);
      if(Number(header.version)!==input.expectedVersion) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      let row=await this.row(session,input,header.revision_id);
      if(input.action==="start") {
        if(row) invalid();
        const sources=await this.sources(session,input,header.revision_id);
        if(sources.length!==4) invalid();
        const expert=sources.find(d=>d.step==="experts")!;
        const outline=sources.find(d=>d.step==="outline")!;
        const ids=interviewMarkdown.parseInterviewMarkdown(expert).blocks.flatMap(b=>b.links.filter(l=>/^#expert-[a-zA-Z0-9_-]+$/u.test(l.url)).map(l=>l.url.slice(8)));
        const outlines=interviewMarkdown.parseInterviewMarkdown(outline).blocks.flatMap(b=>b.links.filter(l=>/^#expert-[a-zA-Z0-9_-]+$/u.test(l.url)).map(l=>l.url.slice(8)));
        if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!outlines.includes(id))||outlines.some(id=>!ids.includes(id))) invalid();
        row={status:"running",sources:sources.map(d=>({documentId:d.documentId,version:d.version})),tasks:ids.map(expertId=>({expertId,status:"pending",errorCode:null})),claim_id:null,claim_expires_at:null};
        await session.query(`INSERT INTO interview_markdown_execution(org_id,interview_id,revision_id,status,sources,tasks) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,[input.orgId,input.interviewId,header.revision_id,row.status,JSON.stringify(row.sources),JSON.stringify(row.tasks)]);
      } else {
        if(!row) invalid();
        if(input.action==="advance") return;
        if(input.action==="pause" && row.status==="running") row.status="paused";
        else if(input.action==="resume" && row.status==="paused") row.status="running";
        else if(input.action==="retry" && row.status==="failed") {row.status="running";row.tasks=row.tasks.map(t=>t.status==="failed"?{...t,status:"pending",errorCode:null}:t);}
        else invalid();
        await session.query(`UPDATE interview_markdown_execution SET status=$3,tasks=$4::jsonb,updated_at=now() WHERE org_id=$1 AND revision_id=$2`,[input.orgId,header.revision_id,row.status,JSON.stringify(row.tasks)]);
      }
      await this.bump(session,input);
    });
  }
  claim(input:MarkdownExecutionActor) {
    return this.db.withTenant(input.orgId,async session=>{
      const header=await this.lock(session,input);
      const row=await this.row(session,input,header.revision_id);
      if(!row||row.status!=="running") return null;
      if(row.claim_id&&row.claim_expires_at&&new Date(row.claim_expires_at).getTime()>Date.now()) return null;
      const sources=await this.sources(session,input,header.revision_id);
      if(sources.length!==row.sources.length||sources.some(d=>!row.sources.some(s=>s.documentId===d.documentId&&s.version===d.version))) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const recoverable=row.tasks.filter(t=>t.status==="running");
      const tasks=(recoverable.length?recoverable:row.tasks.filter(t=>t.status==="pending")).slice(0,EXECUTION_BATCH_SIZE);
      if(!tasks.length) return null;
      for(const task of tasks) task.status="running";
      const claimId=randomUUID();
      await session.query(`UPDATE interview_markdown_execution SET tasks=$3::jsonb,claim_id=$4,claim_expires_at=now()+interval '5 minutes',updated_at=now() WHERE org_id=$1 AND revision_id=$2`,[input.orgId,header.revision_id,JSON.stringify(row.tasks),claimId]);
      const runs=await session.query<{markdown:string}>(`SELECT markdown FROM digital_interview_artifact_versions WHERE org_id=$1 AND revision_id=$2 AND step='runs' AND content_source IS NOT NULL ORDER BY version_number DESC LIMIT 1`,[input.orgId,header.revision_id]);
      await this.bump(session,input);
      return {claimId,tasks:tasks.map(task=>({expertId:task.expertId,content:guard({kind:"interview",id:input.interviewId},{sources,partial:runs.rows[0]?.markdown??""})}))};
    });
  }
  finish(input:MarkdownExecutionActor & {claimId:string;results:readonly {expertId:string;markdown:string;failed:boolean}[]}) {
    return this.db.withTenant(input.orgId,async session=>{
      const header=await this.lock(session,input);
      const row=await this.row(session,input,header.revision_id);
      if(!row||row.claim_id!==input.claimId) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const sources=await this.sources(session,input,header.revision_id);
      if(sources.length!==row.sources.length||sources.some(d=>!row.sources.some(s=>s.documentId===d.documentId&&s.version===d.version))) throw new DigitalInterviewWorkflowError("CONCURRENT_MODIFICATION");
      const running=row.tasks.filter(t=>t.status==="running");
      const resultIds=new Set(input.results.map(result=>result.expertId));
      if(!running.length||resultIds.size!==input.results.length||running.length!==input.results.length||running.some(task=>!resultIds.has(task.expertId))) invalid();
      for(const result of input.results) {
        const task=running.find(candidate=>candidate.expertId===result.expertId)!;
        task.status=result.failed?"failed":"completed";task.errorCode=result.failed?"AI_GENERATION_UNAVAILABLE":null;
      }
      if(input.results.some(result=>result.failed)) row.status="failed";
      else if(row.tasks.every(t=>t.status==="completed")) row.status="completed";
      const previous=(await session.query<{markdown:string;version:number}>(`SELECT markdown,version_number AS version FROM digital_interview_artifact_versions WHERE org_id=$1 AND revision_id=$2 AND step='runs' ORDER BY version_number DESC LIMIT 1`,[input.orgId,header.revision_id])).rows[0];
      const appended=input.results.filter(result=>result.markdown.trim()).map(result=>`## [${result.expertId}](#expert-${result.expertId})\n\n${result.markdown}`).join("\n\n");
      if(appended) await appendInterviewMarkdownDocument(session,{orgId:input.orgId,interviewId:input.interviewId,revisionId:header.revision_id,step:"runs",title:"模拟访谈回答",markdown:`${previous?.markdown??"# 模拟访谈记录\n\n以下回答来自模型模拟，需真人验证。"}\n\n${appended}`,evidenceMode:"simulated",references:sources.map((d,i)=>({anchor:`source-${i+1}`,documentId:d.documentId,version:d.version})),expectedVersion:previous?.version??0,status:row.status==="completed"?"completed":row.status==="failed"?"failed":"draft",failure:row.status==="failed"?{code:"AI_GENERATION_UNAVAILABLE",retryable:true}:null});
      await session.query(`UPDATE interview_markdown_execution SET status=$3,tasks=$4::jsonb,claim_id=NULL,claim_expires_at=NULL,updated_at=now() WHERE org_id=$1 AND revision_id=$2`,[input.orgId,header.revision_id,row.status,JSON.stringify(row.tasks)]);
      await this.bump(session,input);
    });
  }
}
