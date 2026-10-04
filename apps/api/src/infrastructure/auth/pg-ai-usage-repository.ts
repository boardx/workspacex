import type { DatabasePort,TenantSession } from "../../application/ports/database.port";
import type { AiUsageQuery,AiUsageRepository } from "../../application/auth/ai-usage-ports";
import type { OrgId } from "../../domain/org-id";
import { aiUsage as C } from "@repo/contracts";
const scoped=`org_id=$1 AND ($2::text IS NULL OR user_id=$2) AND ($3::text IS NULL OR model_provider=$3)
 AND ($4::text IS NULL OR model_id=$4) AND ($5::text IS NULL OR project_id=$5)
 AND (NOT $6::boolean OR project_id IS NULL) AND ($7::text IS NULL OR run_id=$7)
 AND ($8::text IS NULL OR thread_id=$8) AND ($9::text IS NULL OR agent_id=$9)
 AND occurred_at<=$13::timestamptz`;
const eventTime="COALESCE(request_started_at,occurred_at)";
const stats=(relation:string)=>`(SELECT jsonb_build_object('inputTokens',COALESCE(sum(tokens_prompt),0)::text,
 'outputTokens',COALESCE(sum(tokens_completion),0)::text,'totalTokens',COALESCE(sum(tokens_total),0)::text,
 'callCount',count(*),'failedCalls',count(*) FILTER(WHERE outcome='failed'),
 'reportedCalls',count(*) FILTER(WHERE total_source='reported'),'legacyCalls',count(*) FILTER(WHERE total_source='legacy'),
 'unknownCalls',count(*) FILTER(WHERE total_source='unknown'),'unknownInputCalls',count(*) FILTER(WHERE total_source<>'not-applicable' AND tokens_prompt IS NULL),
 'unknownOutputCalls',count(*) FILTER(WHERE total_source<>'not-applicable' AND tokens_completion IS NULL),'nativeCalls',count(*) FILTER(WHERE total_source='not-applicable')) FROM ${relation})`;
/** Metadata-only same-ledger read; authorized scope is resolved before this repository. */
export class PgAiUsageRepository implements AiUsageRepository {
 constructor(private readonly db:DatabasePort){}
 private async parameters(s:TenantSession,orgId:OrgId,q:AiUsageQuery){
  const now=(await s.query<{now:Date}>("SELECT now() AS now")).rows[0]!.now;
  const asOf=q.asOf?new Date(Math.min(Date.parse(q.asOf),now.getTime())).toISOString():now.toISOString();
  const previousStart=new Date(2*Date.parse(q.start)-Date.parse(q.end)).toISOString();
  return {asOf,values:[orgId,q.userId??null,q.modelProvider??null,q.modelId??null,q.projectId??null,q.unassignedProject==="true",
   q.runId??null,q.threadId??null,q.agentId??null,q.start,q.end,previousStart,asOf,q.timezone]};
 }
 async summary(orgId:OrgId,q:AiUsageQuery){return this.db.withTenant(orgId,async s=>{
  const {asOf,values}=await this.parameters(s,orgId,q);
  const result=await s.query<{result:unknown}>(`WITH base AS MATERIALIZED (SELECT *,${eventTime} AS event_time
    FROM effective_token_usage($13::timestamptz) WHERE ${scoped} AND ${eventTime}>=$12::timestamptz AND ${eventTime}<$11::timestamptz),
   period_current AS MATERIALIZED(SELECT * FROM base WHERE event_time>=$10::timestamptz),
   period_previous AS MATERIALIZED(SELECT * FROM base WHERE event_time<$10::timestamptz),
   members AS(SELECT user_id,COALESCE(sum(tokens_total),0) AS tokens,count(*) AS calls FROM period_current GROUP BY user_id),
   models AS(SELECT model_provider,model_id,COALESCE(sum(tokens_total),0) AS tokens,count(*) AS calls FROM period_current GROUP BY model_provider,model_id),
   matrix AS(SELECT user_id,model_provider,model_id,COALESCE(sum(tokens_total),0) AS tokens,count(*) AS calls FROM period_current GROUP BY user_id,model_provider,model_id),
   projects AS(SELECT project_id,COALESCE(sum(tokens_total),0) AS tokens,count(*) AS calls FROM period_current GROUP BY project_id),
   trend AS(SELECT (event_time AT TIME ZONE $14)::date AS day,COALESCE(sum(tokens_total),0) AS tokens,count(*) AS calls FROM period_current GROUP BY day)
   SELECT jsonb_build_object('dispatchIntents',(SELECT count(*) FROM model_request_starts WHERE ${scoped} AND started_at>=$10::timestamptz AND started_at<$11::timestamptz),
    'unsettledDispatchIntents',(SELECT count(*) FROM model_request_starts s WHERE ${scoped} AND started_at>=$10::timestamptz AND started_at<$11::timestamptz AND NOT EXISTS(SELECT 1 FROM effective_token_usage($13::timestamptz) e WHERE e.id=s.id AND e.org_id=s.org_id AND e.occurred_at<=$13::timestamptz)),
    'nativeUnits',COALESCE((SELECT jsonb_agg(jsonb_build_object('unit',native_unit,'reportedQuantity',reported_quantity::text,'estimatedQuantity',estimated_quantity::text,'reportedCalls',reported_calls,'estimatedCalls',estimated_calls,'unknownCalls',unknown_calls) ORDER BY native_unit)
     FROM(SELECT native_unit,COALESCE(sum(native_quantity) FILTER(WHERE native_source='reported'),0) AS reported_quantity,
      COALESCE(sum(native_quantity) FILTER(WHERE native_source='estimated'),0) AS estimated_quantity,
      count(*) FILTER(WHERE native_source='reported') AS reported_calls,count(*) FILTER(WHERE native_source='estimated') AS estimated_calls,
      count(*) FILTER(WHERE native_source='unknown') AS unknown_calls FROM period_current WHERE native_unit IS NOT NULL GROUP BY native_unit) native),'[]'::jsonb),
    'current',${stats("period_current")},'previous',${stats("period_previous")},
    'trend',COALESCE((SELECT jsonb_agg(jsonb_build_object('day',day::text,'totalTokens',tokens::text,'callCount',calls) ORDER BY day) FROM trend),'[]'::jsonb),
    'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,'totalTokens',tokens::text,'callCount',calls) ORDER BY tokens DESC,user_id) FROM (SELECT * FROM members ORDER BY tokens DESC,user_id LIMIT 200) x),'[]'::jsonb),
    'models',COALESCE((SELECT jsonb_agg(jsonb_build_object('modelProvider',model_provider,'modelId',model_id,'totalTokens',tokens::text,'callCount',calls) ORDER BY tokens DESC,model_provider,model_id) FROM (SELECT * FROM models ORDER BY tokens DESC,model_provider,model_id LIMIT 100) x),'[]'::jsonb),
    'matrix',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',user_id,'modelProvider',model_provider,'modelId',model_id,'totalTokens',tokens::text,'callCount',calls) ORDER BY tokens DESC,user_id,model_provider,model_id) FROM (SELECT * FROM matrix ORDER BY tokens DESC,user_id,model_provider,model_id LIMIT 1000) x),'[]'::jsonb),
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('projectId',project_id,'totalTokens',tokens::text,'callCount',calls) ORDER BY tokens DESC,project_id) FROM (SELECT * FROM projects ORDER BY tokens DESC,project_id LIMIT 100) x),'[]'::jsonb),
    'truncated',jsonb_build_object('members',(SELECT count(*)>200 FROM members),'models',(SELECT count(*)>100 FROM models),
     'matrix',(SELECT count(*)>1000 FROM matrix),'projects',(SELECT count(*)>100 FROM projects))) AS result`,values);
  return C.Summary.parse({...(result.rows[0]!.result as Record<string,unknown>),asOf,start:q.start,end:q.end,timezone:q.timezone,coverage:"partial"});
 });}
 async calls(orgId:OrgId,q:AiUsageQuery){return this.db.withTenant(orgId,async s=>{
  const {asOf,values}=await this.parameters(s,orgId,q);
  const result=await s.query<Record<string,unknown>>(`SELECT id,subtask_id AS "subtaskId",user_id AS "userId",run_id AS "runId",project_id AS "projectId",
   thread_id AS "threadId",agent_id AS "agentId",model_provider AS "modelProvider",model_id AS "modelId",
   to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt",
   to_char(request_started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "startedAt",
   to_char(request_ended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "endedAt",execution_attempt_id AS "executionAttemptId",
   tokens_total::text AS "totalTokens",tokens_prompt::text AS "inputTokens",tokens_completion::text AS "outputTokens",
   tokens_cache_input::text AS "cacheInputTokens",tokens_reasoning_output::text AS "reasoningOutputTokens",
   CASE WHEN native_unit IS NULL THEN NULL ELSE jsonb_build_object('unit',native_unit,'quantity',native_quantity::text,'source',native_source) END AS "nativeUsage",
   total_source AS "totalSource",outcome,call_purpose AS "callPurpose",cost_micros::text AS "costMicros",currency,price_version AS "priceVersion"
   FROM effective_token_usage($13::timestamptz) WHERE ${scoped} AND ${eventTime}>=$10::timestamptz AND ${eventTime}<$11::timestamptz
   AND $12::timestamptz IS NOT NULL AND $14::text IS NOT NULL
   AND ($15::timestamptz IS NULL OR (occurred_at,id)<($15::timestamptz,$16::text))
   ORDER BY occurred_at DESC,id DESC LIMIT $17`,[...values,q.cursorTime??null,q.cursorId??null,q.limit+1]);
  const rows=result.rows.slice(0,q.limit).map(row=>C.Call.parse(row));
  const last=rows.at(-1);
  return C.Calls.parse({asOf,coverage:"partial",calls:rows,nextCursor:result.rows.length>q.limit&&last?{occurredAt:last.occurredAt,id:last.id}:null});
 });}
}
