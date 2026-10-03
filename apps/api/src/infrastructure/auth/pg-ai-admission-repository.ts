import type { DatabasePort } from "../../application/ports/database.port";
import type { AiAdmissionPort, AiReservationInput } from "../../application/agent-run/ai-admission-ports";
import type { OrgId } from "../../domain/org-id";
import { decideAiAdmission } from "../../domain/agent-run/ai-budget";

/** Shared PostgreSQL admission foundation, deliberately not composed into production yet. */
export class PgAiAdmissionRepository implements AiAdmissionPort {
 constructor(private readonly db: DatabasePort) {}
 async reserve(orgId: OrgId, input: AiReservationInput) {
  if (!input.requestId || !input.userId || input.maximumTokens < 0n || input.maximumCostMicros < 0n
   || !Number.isFinite(Date.parse(input.windowStart)) || !Number.isFinite(Date.parse(input.windowEnd)) || Date.parse(input.windowEnd)<=Date.parse(input.windowStart)) throw new Error("INVALID_AI_RESERVATION");
  return this.db.withTenant(orgId, async s => {
   // Plan lock serializes entitlement changes with admission, including first-ever plan assignment.
   const org=await s.query("SELECT id FROM organizations WHERE id=$1 AND kind='organization' FOR SHARE",[orgId]);
   if(!org.rows[0]) return {decision:"PLAN_UNCONFIGURED" as const,replay:false};
   // All admission/settlement/configuration writers must use this same canonical budget lock.
   await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify([String(orgId),input.userId,new Date(input.windowStart).toISOString(),new Date(input.windowEnd).toISOString()])]);
   const policy=await s.query<{token_limit:string|null;cost_limit_micros:string;currency:string;price_version:string}>(
    `SELECT token_limit,cost_limit_micros,currency,price_version FROM ai_budget_windows
      WHERE org_id=$1 AND user_id=$2 AND window_start=$3 AND window_end=$4`,
    [orgId,input.userId,input.windowStart,input.windowEnd]);
   const existing=await s.query<{user_id:string;window_start:Date;window_end:Date;maximum_tokens:string;maximum_cost_micros:string;model_provider:string;model_id:string;currency:string;price_version:string;state:"held"|"settled"}>(
    "SELECT user_id,window_start,window_end,maximum_tokens,maximum_cost_micros,model_provider,model_id,currency,price_version,state FROM ai_request_reservations WHERE id=$1",[input.requestId]);
   const replay=existing.rows[0];
   if(replay){
    if(replay.user_id!==input.userId || replay.window_start.toISOString()!==new Date(input.windowStart).toISOString()
      || replay.window_end.toISOString()!==new Date(input.windowEnd).toISOString() || BigInt(replay.maximum_tokens)!==input.maximumTokens
      || BigInt(replay.maximum_cost_micros)!==input.maximumCostMicros || replay.model_provider!==input.modelProvider || replay.model_id!==input.modelId || replay.currency!==input.currency || replay.price_version!==input.priceVersion) throw new Error("AI_RESERVATION_REPLAY_MISMATCH");
    return {decision:"allowed" as const,replay:true,reservationState:replay.state};
   }
   const active=await s.query<{active:boolean}>("SELECT now()>=$1::timestamptz AND now()<$2::timestamptz AS active",[input.windowStart,input.windowEnd]);
   if(!active.rows[0]?.active) return {decision:"BUDGET_WINDOW_INACTIVE" as const,replay:false};
   const planRow=await s.query<{plan:"ordinary"|"enterprise"}>("SELECT plan FROM organization_plans WHERE org_id=$1",[orgId]);
   const plan=planRow.rows[0]?.plan ?? null;
   if(plan===null) return {decision:"PLAN_UNCONFIGURED" as const,replay:false};
   const budget=policy.rows[0];
   if(!budget) return {decision:"COST_LIMIT_UNCONFIGURED" as const,replay:false};
   if(input.currency!==budget.currency || input.priceVersion!==budget.price_version) throw new Error("AI_PRICE_POLICY_MISMATCH");
   // Known totals come only from the same immutable usage ledger. Unknown/pending requests retain holds.
   const used=await s.query<{tokens:string;cost:string;unknown_tokens:string;unknown_cost:string}>(`SELECT
      COALESCE(sum(e.tokens_total) FILTER(WHERE e.total_source<>'unknown' AND NOT EXISTS(SELECT 1 FROM ai_request_reservations r WHERE r.id=e.id AND r.org_id=e.org_id AND r.state='held')),0)::text AS tokens,
      COALESCE(sum(e.cost_micros) FILTER(WHERE e.currency=$5 AND NOT EXISTS(SELECT 1 FROM ai_request_reservations r WHERE r.id=e.id AND r.org_id=e.org_id AND r.state='held')),0)::text AS cost,
      count(*) FILTER(WHERE e.total_source='unknown' AND NOT EXISTS(SELECT 1 FROM ai_request_reservations r WHERE r.id=e.id AND r.org_id=e.org_id AND r.state='held'))::text AS unknown_tokens,
      count(*) FILTER(WHERE ((e.currency IS DISTINCT FROM $5 AND e.cost_micros IS NOT NULL) OR (e.cost_micros IS NULL AND NOT EXISTS(SELECT 1 FROM ai_request_reservations r WHERE r.id=e.id AND r.org_id=e.org_id AND r.state='held'))))::text AS unknown_cost
     FROM token_usage_events e WHERE e.org_id=$1 AND e.user_id=$2
      AND COALESCE(e.request_started_at,e.occurred_at)>=$3 AND COALESCE(e.request_started_at,e.occurred_at)<$4`,
     [orgId,input.userId,input.windowStart,input.windowEnd,input.currency]);
   if(BigInt(used.rows[0]!.unknown_cost)>0n) return {decision:"COST_LIMIT_UNCONFIGURED" as const,replay:false};
   if(plan==="ordinary" && BigInt(used.rows[0]!.unknown_tokens)>0n) return {decision:"TOKEN_LIMIT_UNCONFIGURED" as const,replay:false};
   const held=await s.query<{tokens:string;cost:string}>(`SELECT
      COALESCE(sum(GREATEST(r.maximum_tokens,COALESCE(e.tokens_total,0))) FILTER(WHERE r.state='held'),0)::text AS tokens,
      COALESCE(sum(GREATEST(r.maximum_cost_micros,CASE WHEN e.currency=r.currency THEN COALESCE(e.cost_micros,0) ELSE 0 END)) FILTER(WHERE r.state='held'),0)::text AS cost
     FROM ai_request_reservations r LEFT JOIN token_usage_events e ON e.id=r.id AND e.org_id=r.org_id
      WHERE r.org_id=$1 AND r.user_id=$2 AND r.window_start=$3 AND r.window_end=$4`,
     [orgId,input.userId,input.windowStart,input.windowEnd]);
   const totals=held.rows[0]!;
   const decision=decideAiAdmission({plan,tokenLimit:budget.token_limit===null?null:BigInt(budget.token_limit),
    costLimitMicros:BigInt(budget.cost_limit_micros),usedTokens:BigInt(used.rows[0]!.tokens),heldTokens:BigInt(totals.tokens),
    usedCostMicros:BigInt(used.rows[0]!.cost),heldCostMicros:BigInt(totals.cost)},input.maximumTokens,input.maximumCostMicros);
   if(decision!=="allowed") return {decision,replay:false};
   await s.query(`INSERT INTO ai_request_reservations(id,org_id,user_id,window_start,window_end,
    maximum_tokens,maximum_cost_micros,model_provider,model_id,currency,price_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[input.requestId,orgId,input.userId,input.windowStart,input.windowEnd,
     input.maximumTokens.toString(),input.maximumCostMicros.toString(),input.modelProvider,input.modelId,input.currency,input.priceVersion]);
   return {decision,replay:false,reservationState:"held" as const};
  });
 }
 async settle(orgId:OrgId,requestId:string,usage:{readonly tokens:bigint|null;readonly costMicros:bigint|null}):Promise<void>{
  if((usage.tokens!==null && usage.tokens<0n)||(usage.costMicros!==null && usage.costMicros<0n)) throw new Error("INVALID_AI_SETTLEMENT");
  await this.db.withTenant(orgId,async s=>{
   // Discover the budget key without taking reservation lock; use consistent budget -> reservation order.
   const key=await s.query<{user_id:string;window_start:Date;window_end:Date}>("SELECT user_id,window_start,window_end FROM ai_request_reservations WHERE id=$1",[requestId]);
   if(!key.rows[0]) throw new Error("AI_RESERVATION_NOT_FOUND");
   const k=key.rows[0];
   await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[JSON.stringify([String(orgId),k.user_id,k.window_start.toISOString(),k.window_end.toISOString()])]);
   const row=await s.query<{state:string;settled_tokens:string|null;settled_cost_micros:string|null;currency:string;price_version:string;model_provider:string;model_id:string}>("SELECT state,settled_tokens,settled_cost_micros,currency,price_version,model_provider,model_id FROM ai_request_reservations WHERE id=$1 FOR UPDATE",[requestId]);
   if(row.rows[0]!.state==="settled"){
    if(usage.tokens!==null && usage.costMicros!==null && (BigInt(row.rows[0]!.settled_tokens!)!==usage.tokens||BigInt(row.rows[0]!.settled_cost_micros!)!==usage.costMicros)) throw new Error("AI_SETTLEMENT_REPLAY_MISMATCH");
    return;
   }
   if(usage.tokens===null || usage.costMicros===null) return; // Retain conservative hold, never invent a free failed request.
   // Settlement requires a matching authoritative ledger terminal; otherwise releasing tokens could oversell.
   const receipt=await s.query<{tokens_total:string;total_source:string;cost_micros:string|null;currency:string;price_version:string;user_id:string;model_provider:string;model_id:string;request_time:Date}>("SELECT tokens_total,total_source,cost_micros,currency,price_version,user_id,model_provider,model_id,COALESCE(request_started_at,occurred_at) AS request_time FROM token_usage_events WHERE id=$1 AND org_id=$2",[requestId,orgId]);
   if(!receipt.rows[0] || receipt.rows[0].total_source!=="reported" || BigInt(receipt.rows[0].tokens_total)!==usage.tokens || receipt.rows[0].cost_micros===null
     || BigInt(receipt.rows[0].cost_micros)!==usage.costMicros || receipt.rows[0].user_id!==k.user_id || receipt.rows[0].currency!==row.rows[0]!.currency
     || receipt.rows[0].price_version!==row.rows[0]!.price_version
     || receipt.rows[0].model_provider!==row.rows[0]!.model_provider || receipt.rows[0].model_id!==row.rows[0]!.model_id
     || receipt.rows[0].request_time<k.window_start || receipt.rows[0].request_time>=k.window_end) throw new Error("AI_SETTLEMENT_RECEIPT_MISSING_OR_MISMATCH");
   await s.query("UPDATE ai_request_reservations SET state='settled',settled_tokens=$2,settled_cost_micros=$3,settled_at=now() WHERE id=$1",[requestId,usage.tokens.toString(),usage.costMicros.toString()]);
  });
 }
}
