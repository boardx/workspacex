import { isAidtProblemControlText, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { createHash } from "node:crypto";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { guard, discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import type { TenantSession } from "../../application/ports/database.port";
import type { AidtContextActor } from "../../application/aidt-run-context/ports";
import type { AidtStagesService } from "../../application/aidt-stages/service";
import { aidtEntityThreadId, aidtSavedEntityTitle } from "../../application/aidt-stages/entity-thread";
import { problemSkillFields, projectProblemSkillDraft } from "../../application/aidt-stages/problem-skill-draft";
import { projectInterviewSkillDraft } from "../../application/aidt-stages/interview-skill-draft";

type Row = { run_id:string; message_id:string; user_text:string; assistant_text:string; source_revision:number|null; requested_by:string; input_at:Date; };
/** Receipt key in the normal append-only stage ledger. Version/variant bits follow UUID v5. */
function operationId(runId:string) {
  const b=createHash("sha256").update("aidt-skill-draft:"+runId).digest().subarray(0,16);
  b[6]=(b[6]! & 15)|80; b[8]=(b[8]! & 63)|128;
  const h=b.toString("hex");
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join("-");
}

/** Called after accessIn locks and authorizes the current project/thread. The immutable selector
 * binds the finished model answer to its real input message and the selected mounted Skill.
 * Never use text, entity IDs or version numbers supplied by the browser to create an outcome. */
export async function projectSavedSkillOutput(s:TenantSession, stages:AidtStagesService, actor:AidtContextActor,
  decision:PermissionDecision, stageId:number, entityId:string, runId?:string):Promise<boolean> {
  if ((stageId!==1 && stageId!==2) || aidtEntityThreadId(actor,stageId,entityId,"stage")!==actor.threadId) return false;
  const current=(await stages.get(actor,stageId)).stage;
  if (!current || !aidtSavedEntityTitle(current,entityId,"stage")) return false;
  const rows=await s.query<Row>(`
    SELECT snap.run_id, snap.requested_by, human.created_at AS input_at, human.body AS user_text, reply.body AS assistant_text, reply.id AS message_id,
      (SELECT (ref->>'revision')::integer FROM jsonb_array_elements(snap.selector_json->'stageRevisions') ref
        WHERE (ref->>'stageId')::integer=$4 LIMIT 1) AS source_revision
    FROM aidt_run_context_snapshots snap
    JOIN agent_runs r ON r.org_id=snap.org_id AND r.id=snap.run_id AND r.status='succeeded'
      AND r.aidt_selector_hash=snap.selector_hash AND r.input_message_id=snap.input_message_id AND r.thread_id=snap.thread_id
    JOIN chat_threads t ON t.org_id=snap.org_id AND t.id=snap.thread_id AND t.project_id=snap.project_id
      AND t.visibility_scope='plenary' AND t.ownership_layer='project' AND NOT t.agent_private AND t.group_id IS NULL
    JOIN chat_messages human ON human.org_id=t.org_id AND human.thread_id=t.id AND human.id=snap.input_message_id
      AND human.author_kind='human' AND human.author_id=snap.requested_by
      AND NOT human.raw_transcript AND COALESCE(human.visibility_scope,t.visibility_scope)='plenary'
    JOIN chat_messages reply ON reply.org_id=t.org_id AND reply.thread_id=t.id AND reply.agent_run_id=r.id
      AND reply.author_kind='agent' AND reply.reply_to_message_id=human.id AND NOT reply.raw_transcript
      AND COALESCE(reply.visibility_scope,t.visibility_scope)='plenary'
    WHERE snap.org_id=$1 AND snap.project_id=$2 AND snap.thread_id=$3 AND snap.selector_json->>'purpose'='stage'
      AND (snap.selector_json->>'stageId')::integer=$4 AND snap.selector_json->>'entityId'=$5
      AND snap.snapshot_json->'focus'->>'skillStableName'=$6
      AND ($7::text IS NULL OR snap.run_id=$7)
    ORDER BY human.created_at DESC,human.id DESC LIMIT 32`,
  [actor.orgId,actor.projectId,actor.threadId,stageId,entityId,stageId===1?"aidt-understand":"aidt-empathize",runId??null]);
  const recordKey=(stageId===1?"problemDraft:":"interviewRecord:")+entityId;
  const permitted = discloseDecided(guard({kind:"project",id:actor.projectId},rows.rows),decision);
  if (!isDisclosed(permitted)) return false;
  for (const row of permitted.payload) {
    const op=operationId(row.run_id);
    const receipt=await s.query("SELECT 1 FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 AND stage_id=$3 AND operation_id=$4",
      [actor.orgId,actor.projectId,stageId,op]);
    if (receipt.rows.length) return false;
    if (row.source_revision && row.source_revision!==current.revision) {
      const base=(await stages.getRevision(actor,stageId,row.source_revision)).stage;
      if (!base || base.content.draft.fields[recordKey]!==current.content.draft.fields[recordKey]) continue;
    }
    const proposed = stageId === 1 ? problemSkillFields(row.assistant_text).initial : undefined;
    // Historical summaries may quote the student's earlier framing. Verify the literal
    // wording in this same shared thread before admitting it as their original question.
    let verifiedInitial: string | undefined;
    if (proposed && !row.user_text.includes(proposed)) {
      const evidence = await s.query(`SELECT 1 FROM chat_messages
        WHERE org_id=$1 AND thread_id=$2 AND author_kind='human' AND NOT raw_transcript
          AND COALESCE(visibility_scope,'plenary')='plenary' AND created_at <= $3
          AND strpos(body,$4)>0 LIMIT 1`, [actor.orgId,actor.threadId,row.input_at,proposed]);
      if (evidence.rows.length) verifiedInitial = proposed;
    }
    const project=stageId===1?projectProblemSkillDraft:projectInterviewSkillDraft;
    const next=project(current.content.draft,entityId,{user:row.user_text,assistant:row.assistant_text,messageId:row.message_id,verifiedInitial});
    if (!next) continue;
    await stages.save(actor,{projectId:actor.projectId,stageId,operationId:op,expectedRevision:current.revision,
      content:{schemaVersion:1,draft:next},sourceStageRevisions:current.sourceStageRevisions});
    return true;
  }
  return false;
}

/** Read the student's literal original framing only when a successful matching Skill
 * named that framing and the same shared thread contains it before the pinned revision. */
export async function recoverProblemFraming(s:TenantSession, actor:AidtContextActor, source:SharedStageValue, entityId:string) {
  const thread = aidtEntityThreadId(actor,1,entityId,"stage");
  const result = await s.query<{body:string}>(`
    SELECT reply.body FROM aidt_run_context_snapshots snap
    JOIN agent_runs r ON r.org_id=snap.org_id AND r.id=snap.run_id AND r.thread_id=snap.thread_id
      AND r.status='succeeded' AND r.input_message_id=snap.input_message_id AND r.aidt_selector_hash=snap.selector_hash
    JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id AND t.project_id=snap.project_id
      AND t.visibility_scope='plenary' AND t.ownership_layer='project' AND NOT t.agent_private AND t.group_id IS NULL
    JOIN chat_messages reply ON reply.org_id=t.org_id AND reply.thread_id=t.id AND reply.agent_run_id=r.id
      AND reply.author_kind='agent' AND reply.reply_to_message_id=r.input_message_id AND NOT reply.raw_transcript
      AND COALESCE(reply.visibility_scope,t.visibility_scope)='plenary'
    WHERE snap.org_id=$1 AND snap.project_id=$2 AND snap.thread_id=$3 AND snap.selector_json->>'entityId'=$4
      AND snap.selector_json->>'stageId'='1' AND snap.selector_json->>'purpose'='stage'
      AND snap.snapshot_json->'focus'->>'skillStableName'='aidt-understand' AND reply.created_at <= $5
    ORDER BY reply.created_at DESC,reply.id DESC LIMIT 12`,[actor.orgId,actor.projectId,thread,entityId,source.updatedAt]);
  const candidates = [...new Set(result.rows.map(row=>problemSkillFields(row.body).initial)
    .filter((v):v is string=>!!v && !isAidtProblemControlText(v)))];
  if (!candidates.length) return;
  const verified=await s.query<{original:string}>(`SELECT original FROM unnest($3::text[]) WITH ORDINALITY candidates(original,idx)
    WHERE EXISTS (SELECT 1 FROM chat_messages m WHERE m.org_id=$1 AND m.thread_id=$2 AND m.author_kind='human'
      AND NOT m.raw_transcript AND COALESCE(m.visibility_scope,'plenary')='plenary' AND m.created_at <= $4
      AND strpos(m.body,original)>0) ORDER BY idx LIMIT 1`,[actor.orgId,thread,candidates,source.updatedAt]);
  return verified.rows[0]?.original;
}
