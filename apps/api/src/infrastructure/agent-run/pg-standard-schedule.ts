import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ScheduleWake as wake,SCHEDULE_LIMITS,ScheduleCreateInput,ScheduleListInput,ScheduleCancelInput,ScheduleToolRequest,SCHEDULE_TOOL_SCHEMAS,ScheduleItem} from '@repo/contracts/standard-schedule';
import type {StandardSchedule,ScheduledRunGateway,ScheduledRunNotifier} from '../../application/agent-run/standard-schedule';
import type {DatabasePort,TenantSession} from '../../application/ports/database.port';
import type {ToolExecutionAuthority} from '../../application/agent-run/tool-execution-authority';
import type {GetThreadDeps} from '../../application/chat/get-thread';
import {readAgentRun,type ReadAgentRunDeps} from '../../application/agent-run/read-run';
import {authorizeSubtaskParent} from '../../application/agent-run/authorize-subtask-parent';
import {resolveVisibility} from '../../application/chat/resolve-visibility';
import {AgentNotPublishedError,MessageThreadNotVisibleError,MessageNoWriteRoleError,MessageThreadArchivedError} from '../../application/chat/message-roundtrip';
import {toOrgId,type OrgId} from '../../domain/org-id';
import {withAuthorizedStandardToolRun} from './with-authorized-standard-tool-run';
import {PgBossScheduler,type ScheduleWake,SCHEDULE_QUEUE} from './pg-boss-scheduler';
import type {Job} from 'pg-boss';
interface Row {id:string;org_id:string;user_id:string;thread_id:string;agent_id:string;instruction:string;args_digest:string;status:'active'|'cancelled'|'completed'|'failed';revision:number;failure_code:'authorization_revoked'|'delivery_rejected'|null;notification_pending:boolean;last_occurrence_id:string|null;last_run_id:string|null;}
interface Deps {db:DatabasePort;authority:Pick<ToolExecutionAuthority,'check'>;visibility:GetThreadDeps&ReadAgentRunDeps;provider:PgBossScheduler;gateway:ScheduledRunGateway;notifier?:ScheduledRunNotifier;}
export class PgStandardSchedule implements StandardSchedule{
 constructor(private readonly deps:Deps){}
 async invoke(runId:string,raw:z.infer<typeof ScheduleToolRequest>):Promise<unknown>{
  const input=ScheduleToolRequest.parse(raw),args=SCHEDULE_TOOL_SCHEMAS[input.toolName].parse(input.toolArgs);
  this.deps.provider.assertAvailable();
  return withAuthorizedStandardToolRun(this.deps.db,this.deps.authority,this.deps.visibility,runId,{...input,toolArgs:args},async trusted=>{
   await authorizeSubtaskParent(this.deps.visibility,{orgId:trusted.orgId,userId:trusted.userId,runId,write:input.toolName!=='wx_schedule_list'});
   return this.deps.db.withTenant(trusted.orgId,session=>this.deps.provider.inTransaction(session,async()=>{
    if(input.toolName==='wx_schedule_list')return this.list(session,trusted.orgId,trusted.userId,ScheduleListInput.parse(args));
    if(input.toolName==='wx_schedule_cancel')return this.cancel(session,trusted.orgId,trusted.userId,ScheduleCancelInput.parse(args));
    if(!this.deps.notifier)throw new Error('schedule_notifier_unavailable');
    const current=await readAgentRun(this.deps.visibility,{orgId:trusted.orgId,userId:trusted.userId,runId});
    return this.create(session,{orgId:trusted.orgId,userId:trusted.userId,threadId:trusted.threadId,agentId:current.agentId},ScheduleCreateInput.parse(args));
   }));
  });
 }
 private async item(row:Row){
  const orgId=toOrgId(row.org_id);
  const thread=await this.deps.visibility.chat.findThreadFacts(orgId,row.thread_id);
  const visible=thread?await resolveVisibility(this.deps.visibility,{orgId,userId:row.user_id,threadId:row.thread_id,projectId:thread.projectId}):null;
  return ScheduleItem.parse({scheduleId:row.id,summary:visible?.kind==='allow'?row.instruction.slice(0,SCHEDULE_LIMITS.maxSummaryChars):'任务当前不可访问',nextRunAt:row.status==='active'?await this.deps.provider.next(row.id):null,status:row.status,revision:row.revision,failureCode:row.failure_code});
 }
 private async list(s:TenantSession,orgId:OrgId,userId:string,input:z.infer<typeof ScheduleListInput>){
  const rows=(await s.query<Row>(`SELECT * FROM standard_schedules WHERE org_id=$1 AND user_id=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4`,[orgId,userId,input.cursor??null,SCHEDULE_LIMITS.pageSize+1])).rows;
  const page=rows.slice(0,SCHEDULE_LIMITS.pageSize);
  return {schedules:await Promise.all(page.map(row=>this.item(row))),...(rows.length>SCHEDULE_LIMITS.pageSize?{cursor:page.at(-1)!.id}:{})};
 }
 private async create(s:TenantSession,scope:{orgId:OrgId;userId:string;threadId:string;agentId:string},input:z.infer<typeof ScheduleCreateInput>){
  await s.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`schedule:${scope.orgId}:${scope.userId}`]);
  const digest=createHash('sha256').update(JSON.stringify({scope,input})).digest('hex');
  const prior=(await s.query<Row>(`SELECT * FROM standard_schedules WHERE org_id=$1 AND user_id=$2 AND idempotency_key=$3::uuid`,[scope.orgId,scope.userId,input.idempotencyKey])).rows[0];
  if(prior){if(prior.args_digest!==digest)throw new Error('schedule_idempotency_conflict');return this.item(prior);}
  const count=(await s.query<{n:string}>(`SELECT count(*)::text n FROM standard_schedules WHERE org_id=$1 AND user_id=$2 AND status='active'`,[scope.orgId,scope.userId])).rows[0]!;
  if(Number(count.n)>=SCHEDULE_LIMITS.maxActivePerUser)throw new Error('schedule_limit_reached');
  if(input.trigger==='once'){
   const delta=Date.parse(input.scheduleSpec.at!)-Date.now();
   if(delta<=0||delta>SCHEDULE_LIMITS.maxFutureDays*86400000)throw new Error('schedule_time_out_of_range');
  }
  const id=randomUUID();
  const row=(await s.query<Row>(`INSERT INTO standard_schedules(id,org_id,user_id,thread_id,agent_id,instruction,idempotency_key,args_digest) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8) RETURNING *`,[id,scope.orgId,scope.userId,scope.threadId,scope.agentId,input.instruction,input.idempotencyKey,digest])).rows[0]!;
  await this.deps.provider.create(id,scope.orgId,input.trigger==='once'?{trigger:'once',at:input.scheduleSpec.at!}:{trigger:'cron',expression:input.scheduleSpec.expression!,timezone:input.timezone});
  return this.item(row);
 }
 private async cancel(s:TenantSession,orgId:OrgId,userId:string,input:z.infer<typeof ScheduleCancelInput>){
  const row=(await s.query<Row>(`SELECT * FROM standard_schedules WHERE org_id=$1 AND user_id=$2 AND id=$3::uuid FOR UPDATE`,[orgId,userId,input.scheduleId])).rows[0];
  if(!row)throw new Error('schedule_not_found');
  if(row.status==='cancelled')return {cancelled:true};
  if(row.status==='completed'||row.status==='failed')return {cancelled:false};
  if(input.expectedRevision!==undefined&&input.expectedRevision!==row.revision)throw new Error('schedule_revision_conflict');
  await this.deps.provider.cancel(row.id);
  await s.query(`UPDATE standard_schedules SET status='cancelled',revision=revision+1 WHERE org_id=$1 AND user_id=$2 AND id=$3::uuid`,[orgId,userId,row.id]);
  return {cancelled:true};
 }
 async deliver(job:Job<ScheduleWake>){
  const data=wake.parse(job.data),orgId=toOrgId(data.orgId);
  let kick=false;let notification:Row|undefined;
  await this.deps.db.withTenant(orgId,s=>this.deps.provider.inTransaction(s,async()=>{
   // The row lock is the cancellation linearization point. The real gateway must
   // share this DatabasePort; tests prove rollback and backend-pid identity.
   const row=(await s.query<Row>(`SELECT * FROM standard_schedules WHERE org_id=$1 AND id=$2::uuid FOR UPDATE`,[orgId,data.scheduleId])).rows[0];
   if(!row)return;
   if(row.notification_pending){notification=row;return;}
   if(row.status!=='active'){if(row.status==='completed'&&row.last_run_id)kick=true;return;}
   try{
    const accepted=await this.deps.gateway.dispatch({orgId,userId:row.user_id,threadId:row.thread_id,agentId:row.agent_id,instruction:row.instruction,occurrenceId:job.id});
    const recurring=(await this.deps.provider.boss.getSchedules(SCHEDULE_QUEUE,row.id)).length>0;
    await s.query(`UPDATE standard_schedules SET status=$3,last_occurrence_id=$4::uuid,last_run_id=$5 WHERE org_id=$1 AND id=$2::uuid`,[orgId,row.id,recurring?'active':'completed',job.id,accepted.runId]);
    kick=true;
   }catch(error){
    const code=error instanceof AgentNotPublishedError?'delivery_rejected':error instanceof MessageThreadNotVisibleError||error instanceof MessageNoWriteRoleError||error instanceof MessageThreadArchivedError?'authorization_revoked':null;
    if(!code)throw error;
    await this.deps.provider.boss.unschedule(SCHEDULE_QUEUE,row.id);
    notification=(await s.query<Row>(`UPDATE standard_schedules SET status='failed',revision=revision+1,failure_code=$3,notification_pending=true,last_occurrence_id=$4::uuid WHERE org_id=$1 AND id=$2::uuid RETURNING *`,[orgId,row.id,code,job.id])).rows[0];
   }
  }));
  if(kick)this.deps.gateway.kick(orgId);
  if(notification){
   if(!this.deps.notifier)throw new Error('schedule_notifier_unavailable');
   const result=await this.deps.notifier.publish({factId:notification.last_occurrence_id!,orgId,userId:notification.user_id,scheduleId:notification.id,code:notification.failure_code!});
   if(result.durablyAccepted!==true)throw new Error('schedule_notification_unconfirmed');
   await this.deps.db.withTenant(orgId,s=>s.query(`UPDATE standard_schedules SET notification_pending=false WHERE org_id=$1 AND id=$2::uuid AND last_occurrence_id=$3::uuid`,[orgId,notification!.id,notification!.last_occurrence_id]));
  }
 }
}
