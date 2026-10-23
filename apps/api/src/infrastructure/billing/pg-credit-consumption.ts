import {createHash} from "node:crypto";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import type {TokenUsageMeterPort,TokenUsageRecord} from "../../application/agent-run/ports";
import {CreditConsumptionError,creditDecimal,tokenCreditHundredths} from "../../application/billing/credit-consumption";
type Start=Parameters<NonNullable<TokenUsageMeterPort["startRequest"]>>[1];
type Payer={ownerType:"user"|"team";ownerId:string};
type Request={request_id:string;user_id:string;wallet_id:string;model_provider:string;model_id:string;run_id:string|null;start_facts:unknown;reserved_hundredths:string;tariff_version:string;native_unit:string|null;native_quantum:string|null;native_rate:string|null;state:string;usage_facts:unknown};
const facts=(value:unknown):string=>JSON.stringify(value,(_key,v)=>typeof v==="bigint"?v.toString():v && typeof v==="object" && !Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const limit=214748364700n;
function decimalHundredths(value:string):bigint {const [whole,fraction=""]=value.split(".");const negative=whole!.startsWith("-");return BigInt(whole!)*100n+(negative?-1n:1n)*BigInt(fraction.padEnd(2,"0"));}
/** Called inside the SAME transaction as durable starts and terminal usage receipts. */
export class PgCreditConsumption {
 constructor(private readonly db:DatabasePort){}
 private async payer(s:TenantSession,orgId:OrgId,userId:string):Promise<Payer>{
  const row=(await s.query<{kind:string}>(`SELECT o.kind FROM organizations o JOIN org_memberships m ON m.org_id=o.id WHERE o.id=$1 AND m.user_id=$2`,[orgId,userId])).rows[0];
  if(!row)throw new CreditConsumptionError("credit_accounting_unavailable","team",orgId,"credit_payer_provenance_missing");
  return row.kind==="personal-local"?{ownerType:"user",ownerId:userId}:{ownerType:"team",ownerId:orgId};
 }
 private error(p:Payer,message:string,code:"credit_required"|"credit_accounting_unavailable"="credit_accounting_unavailable"){return new CreditConsumptionError(code,p.ownerType,p.ownerId,message);}
 async reserveInSession(s:TenantSession,orgId:OrgId,input:Start):Promise<void>{
  const p=await this.payer(s,orgId,input.userId);
  await s.query(`INSERT INTO credit_wallets(owner_type,owner_id) VALUES($1,$2) ON CONFLICT(owner_type,owner_id) DO NOTHING`,[p.ownerType,p.ownerId]);
  const wallet=(await s.query<{wallet_id:string;balance:string;held_hundredths:string;unbounded_requests:string}>(`SELECT wallet_id,balance::text,held_hundredths::text,unbounded_requests::text FROM credit_wallets WHERE owner_type=$1 AND owner_id=$2 FOR UPDATE`,[p.ownerType,p.ownerId])).rows[0]!;
  const immutable={orgId,userId:input.userId,runId:input.runId,modelProvider:input.modelProvider,modelId:input.modelId,executionAttemptId:input.executionAttemptId,projectId:input.projectId,threadId:input.threadId??null,agentId:input.agentId??null,callPurpose:input.callPurpose??null};
  const old=(await s.query<Request>("SELECT * FROM credit_consumption_requests WHERE request_id=$1",[input.requestId])).rows[0];
  if(old){const prior=old.start_facts as Record<string,unknown>;const {maximumTokenBound,nativeMaximumBound,tokenBoundRequired,...identity}=prior;const boundInput=input as Start & {maximumTokens?:number|null;nativeMaximum?:{unit:string;quantity:bigint};tokenBoundRequired?:boolean};if(facts(identity)!==facts(immutable)||old.wallet_id!==wallet.wallet_id||(boundInput.maximumTokens!==undefined&&maximumTokenBound!==boundInput.maximumTokens)||(boundInput.nativeMaximum!==undefined&&facts(nativeMaximumBound)!==facts(boundInput.nativeMaximum))||(boundInput.tokenBoundRequired!==undefined&&tokenBoundRequired!==boundInput.tokenBoundRequired))throw this.error(p,"credit_start_replay_mismatch");return;}
  const enabled=(await s.query<{credit_preflight_enabled:boolean}>("SELECT credit_preflight_enabled FROM credit_consumption_settings WHERE singleton=true")).rows[0]?.credit_preflight_enabled;
  if(enabled===undefined)throw this.error(p,"credit_settings_missing");
  if(enabled&&BigInt(wallet.unbounded_requests)>0n)throw this.error(p,"credit_unbounded_usage_reconciliation_required");
  const admission=(await s.query<{maximum_tokens:string;billing_kind:string;native_unit:string|null;max_native_quantity:string|null}>("SELECT maximum_tokens::text,billing_kind,native_unit,max_native_quantity::text FROM ai_request_reservations WHERE id=$1 AND org_id=$2 AND user_id=$3",[input.requestId,orgId,input.userId])).rows[0];
  const extended=input as Start & {maximumTokens?:number|null;nativeMaximum?:{unit:string;quantity:bigint};tokenBoundRequired?:boolean};
  const native=extended.nativeMaximum??(admission?.billing_kind==="native"&&admission.native_unit&&admission.max_native_quantity?{unit:admission.native_unit,quantity:BigInt(admission.max_native_quantity)}:undefined);
  let reserved=0n,version="token-v1-1000-per-credit",quantum:bigint|null=null,rate:bigint|null=null;
  if(native){
   const tariff=(await s.query<{quantum:string;hundredths_per_quantum:string;version:string}>("SELECT quantum::text,hundredths_per_quantum::text,version FROM credit_native_tariffs WHERE org_id=$1 AND model_provider=$2 AND model_id=$3 AND unit=$4",[orgId,input.modelProvider,input.modelId,native.unit])).rows[0];
   if(!tariff||native.quantity<0n)throw this.error(p,"credit_native_tariff_missing");
   quantum=BigInt(tariff.quantum);rate=BigInt(tariff.hundredths_per_quantum);version=tariff.version;reserved=(native.quantity*rate+quantum-1n)/quantum;
   if(enabled&&extended.tokenBoundRequired&&(extended.maximumTokens==null||extended.maximumTokens<=0))throw this.error(p,"credit_request_bound_missing");
   if(extended.maximumTokens!=null){const tokenBound=tokenCreditHundredths(extended.maximumTokens);if(tokenBound>reserved)reserved=tokenBound;}
  }else{
   const maximum=extended.maximumTokens??(admission?Number(admission.maximum_tokens):null);
   if(maximum===null){if(enabled)throw this.error(p,"credit_request_bound_missing");}
   else reserved=tokenCreditHundredths(maximum);
   if(input.callPurpose==="native-image"||input.callPurpose==="native-asr")throw this.error(p,"credit_native_bound_missing");
  }
  if(reserved>limit)throw this.error(p,"credit_request_bound_unrepresentable");
  if(enabled&&(reserved===0n||decimalHundredths(wallet.balance)-BigInt(wallet.held_hundredths)<reserved))throw this.error(p,"insufficient_credit", "credit_required");
  await s.query(`INSERT INTO credit_consumption_requests(request_id,org_id,user_id,wallet_id,model_provider,model_id,run_id,start_facts,reserved_hundredths,tariff_version,native_unit,native_quantum,native_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,[input.requestId,orgId,input.userId,wallet.wallet_id,input.modelProvider,input.modelId,input.runId,facts({...immutable,maximumTokenBound:extended.maximumTokens??null,nativeMaximumBound:extended.nativeMaximum??null,tokenBoundRequired:extended.tokenBoundRequired??false}),reserved.toString(),version,native?.unit??null,quantum?.toString()??null,rate?.toString()??null]);
  await s.query("UPDATE credit_wallets SET held_hundredths=held_hundredths+$2,unbounded_requests=unbounded_requests+$3 WHERE wallet_id=$1",[wallet.wallet_id,reserved.toString(),reserved===0n?1:0]);
 }
 async settleInSession(s:TenantSession,orgId:OrgId,usage:TokenUsageRecord):Promise<void>{
  // A dispatched request retains its admitted payer even if membership is revoked.
  const admitted=(await s.query<Request>("SELECT * FROM credit_consumption_requests WHERE request_id=$1 AND org_id=$2",[usage.eventId??null,orgId])).rows[0];
  if(!admitted)throw new CreditConsumptionError("credit_accounting_unavailable","team",orgId,"credit_request_identity_missing");
  // Wallet then request is the lock order shared with admission, preventing deadlocks.
  const wallet=(await s.query<{wallet_id:string;balance:string;owner_type:"user"|"team";owner_id:string}>("SELECT wallet_id,balance::text,owner_type,owner_id FROM credit_wallets WHERE wallet_id=$1 FOR UPDATE",[admitted.wallet_id])).rows[0];
  const p:Payer=wallet?{ownerType:wallet.owner_type,ownerId:wallet.owner_id}:{ownerType:"team",ownerId:orgId};
  const row=(await s.query<Request>("SELECT * FROM credit_consumption_requests WHERE request_id=$1 AND org_id=$2 FOR UPDATE",[usage.eventId,orgId])).rows[0];
  if(!wallet||!row||row.wallet_id!==wallet.wallet_id||row.user_id!==usage.userId||row.model_provider!==usage.modelProvider||row.model_id!==usage.modelId||row.run_id!==usage.runId)throw this.error(p,"credit_receipt_provenance_mismatch");
  const receipt={tokens:usage.tokensTotal,source:usage.totalSource??"legacy",native:usage.nativeUsage??null,prompt:usage.promptTokens,completion:usage.completionTokens,outcome:usage.outcome};
  if(row.state==="settled"){
   const prior=row.usage_facts as typeof receipt;
   // Missing diagnostic dimensions may arrive after the authoritative total.
   // Never change the already charged billable facts or reinterpret a native debit.
   if(prior.tokens!==receipt.tokens||prior.source!==receipt.source||prior.outcome!==receipt.outcome||facts(prior.native)!==facts(receipt.native))throw this.error(p,"credit_receipt_replay_mismatch");
   const enriched={...prior};
   for(const key of ["prompt","completion"] as const){
    const incoming=receipt[key],known=prior[key];
    if(incoming!==null&&(!Number.isSafeInteger(incoming)||incoming<0||known!==null&&known!==incoming))throw this.error(p,"credit_receipt_replay_mismatch");
    enriched[key]=known??incoming;
   }
   if(facts(enriched)!==facts(prior))await s.query("UPDATE credit_consumption_requests SET usage_facts=$2::jsonb WHERE request_id=$1",[usage.eventId,facts(enriched)]);
   return;
  }
  let debit:bigint|null=null;
  if(usage.totalSource==="reported")debit=tokenCreditHundredths(usage.tokensTotal);
  else if(row.native_unit){
   const n=usage.nativeUsage;if(n&&n.unit!==row.native_unit)throw this.error(p,"credit_native_unit_mismatch");
   if(n?.source==="reported"&&n.quantity!==null){if(n.quantity<0n)throw this.error(p,"credit_native_quantity_invalid");const q=BigInt(row.native_quantum!),r=BigInt(row.native_rate!);debit=(n.quantity*r+q-1n)/q;}
  }else if(usage.totalSource!=="unknown"&&usage.totalSource!=="not-applicable"&&!usage.nativeUsage)debit=tokenCreditHundredths(usage.tokensTotal);
  if(debit===null){await s.query("UPDATE credit_consumption_requests SET state='pending',usage_facts=$2::jsonb WHERE request_id=$1",[usage.eventId,facts(receipt)]);return;}
  const balance=decimalHundredths(wallet.balance)-debit;
  if(debit>limit||balance < -limit||balance>limit)throw this.error(p,"credit_balance_unrepresentable");
  if(debit>0n)await s.query(`INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id,operator_id,reason) VALUES($1,'consume',-1,$2,$3,'model_request',$4,$5,$6)`,[wallet.wallet_id,creditDecimal(debit),creditDecimal(balance),usage.eventId,usage.userId,`model:${usage.modelProvider}/${usage.modelId};tariff:${row.tariff_version};receipt:${createHash("sha256").update(facts(receipt)).digest("hex")}`]);
  await s.query("UPDATE credit_wallets SET balance=$2,held_hundredths=held_hundredths-$3,unbounded_requests=unbounded_requests-$4,updated_at=now() WHERE wallet_id=$1",[wallet.wallet_id,creditDecimal(balance),row.reserved_hundredths,BigInt(row.reserved_hundredths)===0n?1:0]);
  await s.query("UPDATE credit_consumption_requests SET state='settled',usage_facts=$2::jsonb,debited_hundredths=$3,settled_at=now() WHERE request_id=$1",[usage.eventId,facts(receipt),debit.toString()]);
 }
 /** Reconcile only authoritative receipts; never expire uncertain holds on a timer. */
 async reconcile(orgId:OrgId,usage:TokenUsageRecord):Promise<void>{await this.db.withTenant(orgId,s=>this.settleInSession(s,orgId,usage));}
}
