import {assertMemberCreditQuota,enterpriseCreditPlan} from "./member-credit-quota";
import {resolveNativeCreditTariff} from './resolve-native-credit-tariff';
import {lockTeamFinancialOwner} from "./team-financial-owner";
import {prepareTeamCreditAdmission} from "./team-credit-admission";
import {isLocalOrg} from "../../domain/identity/local-org";
import type {DatabasePort,TenantSession} from "../../application/ports/database.port";
import type {OrgId} from "../../domain/org-id";
import type {TokenUsageMeterPort,TokenUsageRecord} from "../../application/agent-run/ports";
import {CreditConsumptionError,creditFacts as facts,creditHundredths,tokenCreditHundredths} from "../../application/billing/credit-consumption";
import {grantDuePersonalTerms} from "./personal-credit-terms";
import {normalizeCreditPeriods} from "./pg-credit-periods";
import {settleCreditReceipt} from "./pg-credit-receipt";
type Start=Parameters<NonNullable<TokenUsageMeterPort["startRequest"]>>[1];
type Payer={ownerType:"user"|"team";ownerId:string};
type Request={request_id:string;user_id:string;wallet_id:string;model_provider:string;model_id:string;run_id:string|null;start_facts:unknown;reserved_hundredths:string;tariff_version:string;native_unit:string|null;native_quantum:string|null;native_rate:string|null;state:string;usage_facts:unknown};
const limit=214748364700n;
/** Called inside the SAME transaction as durable starts and terminal usage receipts. */
export class PgCreditConsumption {
 constructor(private readonly db:DatabasePort,private readonly clock:()=>Date=()=>new Date()){}
 /** Resolve wallet identity from the same audited membership metadata as admission. */
 async resolvePayer(orgId:OrgId,userId:string):Promise<Payer>{return this.db.withTenant(orgId,s=>this.payer(s,orgId,userId));}
 private async payer(s:TenantSession,orgId:OrgId,userId:string):Promise<Payer>{
  const row=(await s.query<{kind:string}>(`SELECT o.kind FROM organizations o JOIN org_memberships m ON m.org_id=o.id WHERE o.id=$1 AND m.user_id=$2`,[orgId,userId])).rows[0];
  if(!row)throw new CreditConsumptionError("credit_accounting_unavailable","team",orgId,"credit_payer_provenance_missing");
  return !isLocalOrg(row.kind)&&await enterpriseCreditPlan(s,orgId)?{ownerType:"team",ownerId:orgId}:{ownerType:"user",ownerId:userId};
 }
 private error(p:Payer,message:string,code:"credit_required"|"credit_accounting_unavailable"="credit_accounting_unavailable"){return new CreditConsumptionError(code,p.ownerType,p.ownerId,message);}
 async reserveInSession(s:TenantSession,orgId:OrgId,input:Start):Promise<void>{
  const at=this.clock();
  // Every financial path takes the organization before wallets, including personal fallback.
  await lockTeamFinancialOwner(s,orgId);
  let p=await this.payer(s,orgId,input.userId);
  const immutable={orgId,userId:input.userId,runId:input.runId,modelProvider:input.modelProvider,modelId:input.modelId,executionAttemptId:input.executionAttemptId,projectId:input.projectId,threadId:input.threadId??null,agentId:input.agentId??null,callPurpose:input.callPurpose??null};
  const old=(await s.query<Request>("SELECT * FROM credit_consumption_requests WHERE request_id=$1",[input.requestId])).rows[0];
  if(old){
   const prior=old.start_facts as Record<string,unknown>;
   const {maximumTokenBound,nativeMaximumBound,tokenBoundRequired,...identity}=prior;
   const boundInput=input as Start & {maximumTokens?:number|null;nativeMaximum?:{unit:string;quantity:bigint};tokenBoundRequired?:boolean};
   if(facts(identity)!==facts(immutable)||(boundInput.maximumTokens!==undefined&&maximumTokenBound!==boundInput.maximumTokens)||(boundInput.nativeMaximum!==undefined&&facts(nativeMaximumBound)!==facts(boundInput.nativeMaximum))||(boundInput.tokenBoundRequired!==undefined&&tokenBoundRequired!==boundInput.tokenBoundRequired))throw this.error(p,"credit_start_replay_mismatch");
   // The persisted request owns its payer; current balance or license cannot select it again.
   const fixed=(await s.query<{owner_type:string;owner_id:string}>("SELECT owner_type,owner_id FROM credit_wallets WHERE wallet_id=$1",[old.wallet_id])).rows[0];
   if(!fixed||!((fixed.owner_type==="team"&&fixed.owner_id===orgId)||(fixed.owner_type==="user"&&fixed.owner_id===input.userId)))throw this.error(p,"credit_start_replay_mismatch");
   return;
  }
  const loadWallet=async (payer:Payer)=>{
   await s.query(`INSERT INTO credit_wallets(owner_type,owner_id) VALUES($1,$2) ON CONFLICT(owner_type,owner_id) DO NOTHING`,[payer.ownerType,payer.ownerId]);
   const wallet=(await s.query<{wallet_id:string;balance:string;held_hundredths:string;remaining_held_hundredths:string;unbounded_requests:string}>(`SELECT wallet_id,balance::text,held_hundredths::text,remaining_held_hundredths::text,unbounded_requests::text FROM credit_wallets WHERE owner_type=$1 AND owner_id=$2 FOR UPDATE`,[payer.ownerType,payer.ownerId])).rows[0]!;
   await normalizeCreditPeriods(s,wallet.wallet_id,at);
   wallet.balance=(await s.query<{balance:string}>("SELECT balance::text FROM credit_wallets WHERE wallet_id=$1",[wallet.wallet_id])).rows[0]!.balance;
   return wallet;
  };
  let wallet:Awaited<ReturnType<typeof loadWallet>>|undefined;
  if(p.ownerType==="team"){
   let eligibility:Awaited<ReturnType<typeof prepareTeamCreditAdmission>>;
   try{eligibility=await prepareTeamCreditAdmission(s,orgId,at);}catch{throw this.error(p,"team_license_accounting_unavailable");}
   if(eligibility.decision==="unavailable")throw this.error(p,"team_license_accounting_unavailable");
   if(eligibility.decision==="allowed")wallet=await loadWallet(p);
   if(eligibility.decision==="subscription_required"||(!eligibility.allowOverdraft&&wallet&&creditHundredths(wallet.balance)<=0n)){
    p={ownerType:"user",ownerId:input.userId};wallet=undefined;
   }
  }
  if(p.ownerType==="user"){
   // Personal monthly grants take their advisory lock before the personal wallet.
   await grantDuePersonalTerms(s,p.ownerId);
   wallet=await loadWallet(p);
   if(creditHundredths(wallet.balance)<0n)throw this.error(p,"insufficient_credit","credit_required");
  }
  if(!wallet)throw this.error(p,"credit_wallet_unavailable");
  const admission=(await s.query<{maximum_tokens:string;billing_kind:string;native_unit:string|null;max_native_quantity:string|null}>("SELECT maximum_tokens::text,billing_kind,native_unit,max_native_quantity::text FROM ai_request_reservations WHERE id=$1 AND org_id=$2 AND user_id=$3",[input.requestId,orgId,input.userId])).rows[0];
  const extended=input as Start & {maximumTokens?:number|null;nativeMaximum?:{unit:string;quantity:bigint};tokenBoundRequired?:boolean};
  const native=extended.nativeMaximum??(admission?.billing_kind==="native"&&admission.native_unit&&admission.max_native_quantity?{unit:admission.native_unit,quantity:BigInt(admission.max_native_quantity)}:undefined);
  let reserved=0n,version="token-v1-1000-per-credit",quantum:bigint|null=null,rate:bigint|null=null;
  if(native){
   const tariff=await resolveNativeCreditTariff(s,orgId,input.modelProvider,input.modelId,native.unit);
   if(!tariff||native.quantity<0n)throw this.error(p,"credit_native_tariff_missing");
   quantum=BigInt(tariff.quantum);rate=BigInt(tariff.hundredths_per_quantum);version=tariff.version;reserved=(native.quantity*rate+quantum-1n)/quantum;
   if(extended.maximumTokens!=null){const tokenBound=tokenCreditHundredths(extended.maximumTokens);if(tokenBound>reserved)reserved=tokenBound;}
  }else{
   const maximum=extended.maximumTokens??(admission?Number(admission.maximum_tokens):null);
   if(maximum!==null)reserved=tokenCreditHundredths(maximum);
   if(input.callPurpose==="native-image"||input.callPurpose==="native-asr")throw this.error(p,"credit_native_bound_missing");
  }
  if(reserved>limit)throw this.error(p,"credit_request_bound_unrepresentable");
  const hasTokenBound=extended.maximumTokens!=null||admission?.maximum_tokens!=null;
  const hasCreditBound=(native!==undefined||hasTokenBound)&&(!extended.tokenBoundRequired||hasTokenBound);
  if(p.ownerType==="team"){
   try { reserved=await assertMemberCreditQuota(s,orgId,input.userId,reserved,hasCreditBound); }
   catch(error){
    if(!(error instanceof CreditConsumptionError)||error.code!=="credit_required"||error.reason!=="member_monthly_limit")throw error;
    p={ownerType:"user",ownerId:input.userId};
    await grantDuePersonalTerms(s,p.ownerId);wallet=await loadWallet(p);
   }
  }
  if(p.ownerType==="user"){
   const available=creditHundredths(wallet.balance)-BigInt(wallet.remaining_held_hundredths);
   if(BigInt(wallet.unbounded_requests)>0n||available<=0n||(hasCreditBound&&reserved>available))throw this.error(p,"insufficient_credit","credit_required");
   // Unknown-cost requests hold remaining spending capacity, never fabricated usage.
   if(!hasCreditBound)reserved=available;
  }
  const inserted=await s.query(`INSERT INTO credit_consumption_requests(request_id,org_id,user_id,wallet_id,model_provider,model_id,run_id,start_facts,reserved_hundredths,tariff_version,native_unit,native_quantum,native_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13) ON CONFLICT(request_id) DO NOTHING RETURNING request_id`,[input.requestId,orgId,input.userId,wallet.wallet_id,input.modelProvider,input.modelId,input.runId,facts({...immutable,maximumTokenBound:extended.maximumTokens??null,nativeMaximumBound:extended.nativeMaximum??null,tokenBoundRequired:extended.tokenBoundRequired??false}),reserved.toString(),version,native?.unit??null,quantum?.toString()??null,rate?.toString()??null]);
  if(!inserted.rows.length)throw this.error(p,"credit_start_replay_mismatch");
  await s.query("UPDATE credit_wallets SET held_hundredths=held_hundredths+$2,unbounded_requests=unbounded_requests+$3 WHERE wallet_id=$1",[wallet.wallet_id,reserved.toString(),reserved===0n?1:0]);
 }
 async settleInSession(s:TenantSession,orgId:OrgId,usage:TokenUsageRecord):Promise<void>{
  // Replay/settlement uses the immutable admitted payer, without rechecking membership or licensing.
  const owner=(await s.query<{owner_type:"user"|"team"}>("SELECT w.owner_type FROM credit_consumption_requests r JOIN credit_wallets w ON w.wallet_id=r.wallet_id WHERE r.request_id=$1 AND r.org_id=$2",[usage.eventId??null,orgId])).rows[0];
  if(owner)await lockTeamFinancialOwner(s,orgId);
  await settleCreditReceipt(s,orgId,usage);
 }
 /** Reconcile only authoritative receipts; never expire uncertain holds on a timer. */
 async reconcile(orgId:OrgId,usage:TokenUsageRecord):Promise<void>{await this.db.withTenant(orgId,s=>this.settleInSession(s,orgId,usage));}
}
